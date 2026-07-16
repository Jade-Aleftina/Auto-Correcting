import { GradingEngine } from './engines/GradingEngine.js';

export const VALID_ANSWERS = ['a', 'b', 'c'];

export class RuleBasedGradingEngine extends GradingEngine {
  grade(test, finalAnswers, ocrItems = []) {
    const answerKey = test.answerKey || {};
    const points = test.points || {};
    const questionCount = Number(test.questionCount || 0);
    const details = [];

    for (let number = 1; number <= questionCount; number += 1) {
      const correct = normalizeChoice(answerKey[number]);
      const finalAnswer = normalizeChoice(finalAnswers[number]);
      const maxScore = Number(points[number] || 0);
      const isBlank = finalAnswer === '';
      const isCorrect = !isBlank && finalAnswer === correct;
      const ocrItem = ocrItems.find(item => item.number === number) || {};

      details.push({
        number,
        ocrAnswer: normalizeChoice(ocrItem.answer),
        ocrConfidence: Number(ocrItem.confidence || 0),
        finalAnswer,
        correct,
        isBlank,
        isCorrect,
        score: isCorrect ? maxScore : 0,
        maxScore,
        status: ocrItem.status || 'manual',
        manuallyChanged: normalizeChoice(ocrItem.answer) !== finalAnswer
      });
    }

    const totalScore = details.reduce((sum, item) => sum + item.score, 0);
    const maxScore = details.reduce((sum, item) => sum + item.maxScore, 0);
    const correctCount = details.filter(item => item.isCorrect).length;
    const blankCount = details.filter(item => item.isBlank).length;
    const wrongNumbers = details.filter(item => !item.isCorrect && !item.isBlank).map(item => item.number);
    const manualNumbers = details.filter(item => item.manuallyChanged).map(item => item.number);

    return {
      totalScore,
      maxScore,
      correctCount,
      wrongCount: wrongNumbers.length,
      blankCount,
      wrongNumbers,
      manualNumbers,
      details
    };
  }
}

export function normalizeChoice(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/[ⓐⒶ①]/g, 'a')
    .replace(/[ⓑⒷ②]/g, 'b')
    .replace(/[ⓒⒸ③]/g, 'c')
    .replace(/[4@]/g, 'a')
    .replace(/[68]/g, 'b')
    .replace(/[(<]/g, 'c')
    .replace(/[^abc]/g, '');

  if (!text) return '';
  if (text.length === 1 && VALID_ANSWERS.includes(text)) return text;
  return text;
}

export function classifyOcr(rawText, confidence) {
  const cleaned = normalizeChoice(rawText);
  const numericConfidence = Number(confidence || 0);

  if (!cleaned) {
    return { answer: '', status: 'blank', needsReview: true, label: '未回答または読み取り不能' };
  }

  if (cleaned.length > 1) {
    return { answer: cleaned[0], status: 'multiple', needsReview: true, label: '複数文字の可能性' };
  }

  if (!VALID_ANSWERS.includes(cleaned)) {
    return { answer: '', status: 'invalid', needsReview: true, label: 'a/b/c以外' };
  }

  if (numericConfidence < 72) {
    return { answer: cleaned, status: 'low-confidence', needsReview: true, label: '確信度が低い' };
  }

  return { answer: cleaned, status: 'accepted', needsReview: false, label: '自動認識' };
}
