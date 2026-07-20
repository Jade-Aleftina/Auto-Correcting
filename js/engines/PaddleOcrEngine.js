import { OcrEngine } from './OcrEngine.js';

export class PaddleOcrEngine extends OcrEngine {
  constructor(settingsProvider) {
    super();
    this.settingsProvider = settingsProvider;
  }

  async initialize() {}

  async healthCheck() {
    const settings = this.getSettings();
    if (!settings.serverUrl) {
      throw new Error('PaddleOCRサーバーURLが未設定です。例: http://127.0.0.1:8008');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(`${settings.serverUrl}/api/health`, {
        method: 'GET',
        mode: 'cors',
        signal: controller.signal
      });
    } catch (error) {
      const timeoutMessage = error.name === 'AbortError' ? '接続確認が時間切れになりました。' : '';
      throw new Error(
        timeoutMessage +
        '採点サーバーに接続できませんでした。サーバーURL、起動状態、CORS設定を確認してください。' +
        'ローカル確認ではALLOWED_ORIGINSにWebアプリのURLを追加します。'
      );
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      throw new Error('採点サーバーに接続できませんでした。サーバーが起動しているか確認してください。');
    }
    return response.json();
  }

  async recognizeAnswerImage(canvas, options = {}) {
    const results = await this.recognizeAnswerImages([{ number: 1, canvas }], options);
    return results[0];
  }

  async recognizeAnswerImages(items, options = {}) {
    const settings = this.getSettings();
    if (!settings.serverUrl) {
      throw new Error('PaddleOCRサーバーURLが未設定です。テスト設定画面で入力してください。');
    }

    const started = performance.now();
    const response = await fetch(`${settings.serverUrl}/api/ocr/batch`, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.deviceToken ? { 'X-Device-Token': settings.deviceToken } : {})
      },
      body: JSON.stringify({
        images: items.map(item => ({
          number: item.number,
          image_data_url: item.canvas.toDataURL('image/png')
        }))
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(toUserMessage(response.status, text));
    }

    const payload = await response.json();
    if (options.onProgress) {
      options.onProgress({ status: 'PaddleOCR処理完了', progress: 100 });
    }

    return (payload.results || []).map(result => normalizeServerResult(result, started));
  }

  getSettings() {
    const settings = this.settingsProvider ? this.settingsProvider() : {};
    return {
      serverUrl: String(settings.serverUrl || '').replace(/\/+$/, ''),
      deviceToken: String(settings.deviceToken || '')
    };
  }
}

function normalizeServerResult(result, started) {
  const answer = String(result.answer || result.normalized_answer || '').toLowerCase();
  const confidence = Math.round(Number(result.confidence || 0) * 100);
  return {
    number: result.number,
    rawText: result.raw_text || '',
    answer,
    confidence,
    status: result.status || 'low-confidence',
    needsReview: Boolean(result.needs_review),
    label: statusLabel(result.status),
    variantName: `PaddleOCR / ${result.preprocessing || 'standard'}`,
    processedDataUrl: '',
    inkRatio: 0,
    elapsedMs: result.elapsed_ms || Math.round(performance.now() - started),
    candidates: (result.candidates || []).map(candidate => ({
      answer: candidate.answer,
      confidence: Math.round(Number(candidate.score || 0) * 100)
    })),
    warnings: [
      result.blank_suspected ? '未回答の疑い' : '',
      result.multiple_suspected ? '複数回答の疑い' : '',
      result.erasure_suspected ? '消し跡の疑い' : ''
    ].filter(Boolean)
  };
}

function statusLabel(status) {
  if (status === 'accepted') return '自動認識';
  if (status === 'blank') return '未回答の疑い';
  if (status === 'multiple') return '複数回答の疑い';
  if (status === 'unreadable') return '読み取り不能';
  return '確認が必要';
}

function toUserMessage(status, text) {
  if (status === 403) return 'この端末からは採点サーバーを利用できません。端末トークンを確認してください。';
  if (status === 503) return '採点サーバーは起動していますが、PaddleOCRを準備できていません。サーバー側の表示を確認してください。';
  if (status === 413) return '画像が大きすぎます。撮り直すか、画像を小さくしてください。';
  try {
    const parsed = JSON.parse(text);
    if (parsed.detail) return parsed.detail;
  } catch (_error) {
    // JSONでないエラー本文は下の共通メッセージへ流します。
  }
  if (status >= 500) return '採点サーバーで処理に失敗しました。PowerShell側のエラー表示を確認してください。';
  return '採点サーバーへの送信に失敗しました。';
}
