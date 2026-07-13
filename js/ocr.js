import { OcrEngine } from './engines/OcrEngine.js';
import { classifyOcr } from './grading.js';

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

    // 読み取り対象を a/b/c/A/B/C に限定します。
    await this.worker.setParameters({
      tessedit_char_whitelist: 'abcABC',
      preserve_interword_spaces: '0',
      tessedit_pageseg_mode: '10'
    });
  }

  async recognizeAnswerImage(canvas, options = {}) {
    await this.initialize(options.onProgress);
    const result = await this.worker.recognize(canvas);
    const rawText = result.data.text || '';
    const confidence = result.data.confidence || 0;
    const classified = classifyOcr(rawText, confidence);

    return {
      rawText,
      answer: classified.answer,
      confidence,
      status: classified.status,
      needsReview: classified.needsReview,
      label: classified.label
    };
  }

  async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}
