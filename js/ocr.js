import { OcrEngine } from './engines/OcrEngine.js';
import { classifyOcr } from './grading.js';
import { createOcrVariants } from './imageProcessor.js';

export class TesseractOcrEngine extends OcrEngine {
  constructor() {
    super();
    this.worker = null;
  }

  async initialize(onProgress) {
    if (this.worker) return;
    if (!window.Tesseract) {
      throw new Error('Tesseract.jsを読み込めませんでした。インターネット接続を確認してください。');
    }

    this.worker = await window.Tesseract.createWorker('eng', 1, {
      logger: event => {
        if (onProgress && event.status) {
          onProgress({
            status: event.status,
            progress: Math.round((event.progress || 0) * 100)
          });
        }
      }
    });

    await this.worker.setParameters({
      tessedit_char_whitelist: 'abcABC',
      preserve_interword_spaces: '0',
      tessedit_pageseg_mode: '10'
    });
  }

  async recognizeAnswerImage(canvas, options = {}) {
    await this.initialize(options.onProgress);
    const variants = createOcrVariants(canvas);
    const candidates = [];

    for (let index = 0; index < variants.length; index += 1) {
      const variant = variants[index];
      if (options.onProgress) {
        options.onProgress({
          status: `${variant.name}で読み取り中`,
          progress: Math.round((index / variants.length) * 100)
        });
      }

      const result = await this.worker.recognize(variant.canvas);
      const rawText = result.data.text || '';
      const confidence = Number(result.data.confidence || 0);
      const classified = classifyOcr(rawText, confidence);
      candidates.push({
        rawText,
        answer: classified.answer,
        confidence,
        status: classified.status,
        needsReview: classified.needsReview,
        label: classified.label,
        variantName: variant.name,
        processedDataUrl: variant.canvas.toDataURL('image/png'),
        inkRatio: variant.inkRatio,
        score: scoreCandidate(classified, confidence, variant.inkRatio)
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0] || blankResult();
    return {
      rawText: best.rawText,
      answer: best.answer,
      confidence: best.confidence,
      status: best.status,
      needsReview: best.needsReview,
      label: best.label,
      variantName: best.variantName,
      processedDataUrl: best.processedDataUrl,
      inkRatio: best.inkRatio,
      candidates: candidates.map(({ score, ...candidate }) => candidate)
    };
  }

  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

function scoreCandidate(classified, confidence, inkRatio) {
  const numericConfidence = Number(confidence || 0);
  if (classified.status === 'accepted') return 200 + numericConfidence;
  if (classified.status === 'low-confidence') return 130 + numericConfidence;
  if (classified.status === 'multiple') return 80 + numericConfidence;
  if (classified.status === 'blank' && inkRatio < 0.008) return 70;
  if (classified.status === 'blank') return 20;
  return numericConfidence;
}

function blankResult() {
  return {
    rawText: '',
    answer: '',
    confidence: 0,
    status: 'blank',
    needsReview: true,
    label: '未回答または読み取り不能',
    variantName: '',
    processedDataUrl: '',
    inkRatio: 0,
    candidates: []
  };
}
