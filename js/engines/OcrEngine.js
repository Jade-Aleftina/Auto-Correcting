/**
 * OCRエンジンの共通インターフェースです。
 * 将来AIや別のOCRへ置き換える場合も、recognizeAnswerImage を同じ形で返せば画面側を流用できます。
 */
export class OcrEngine {
  async initialize() {
    throw new Error('initialize が実装されていません。');
  }

  async recognizeAnswerImage(_canvas, _options) {
    throw new Error('recognizeAnswerImage が実装されていません。');
  }

  async terminate() {}
}
