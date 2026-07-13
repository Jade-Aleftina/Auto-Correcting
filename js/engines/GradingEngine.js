/**
 * 採点エンジンの共通インターフェースです。
 * AI採点に置き換える場合は、このクラスと同じ grade メソッドを持つ実装を追加します。
 */
export class GradingEngine {
  grade(_test, _answers) {
    throw new Error('grade が実装されていません。');
  }
}
