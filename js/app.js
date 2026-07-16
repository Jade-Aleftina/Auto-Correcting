import { TesseractOcrEngine } from './ocr.js';
import { RuleBasedGradingEngine, normalizeChoice } from './grading.js';
import { TemplateEditor } from './templateEditor.js';
import { applyAdjustments, copyCanvas, cropByRatio, detectBlur, drawImageToCanvas, loadImageFromFile, rotateCanvas } from './imageProcessor.js';
import { createId, exportAllData, getAll, getItem, importAllData, putItem } from './storage.js';
import { downloadCsv, downloadJson, resultToCsvRows, formatDateTime } from './export.js';

const elements = {
  message: document.querySelector('#message'),
  steps: document.querySelectorAll('.step'),
  panels: document.querySelectorAll('.wizard-panel'),
  testSelect: document.querySelector('#testSelect'),
  historyTestSelect: document.querySelector('#historyTestSelect'),
  testName: document.querySelector('#testName'),
  questionCount: document.querySelector('#questionCount'),
  answerKey: document.querySelector('#answerKey'),
  saveImages: document.querySelector('#saveImages'),
  cameraInput: document.querySelector('#cameraInput'),
  fileInput: document.querySelector('#fileInput'),
  mainCanvas: document.querySelector('#mainCanvas'),
  templateCanvas: document.querySelector('#templateCanvas'),
  blurWarning: document.querySelector('#blurWarning'),
  brightness: document.querySelector('#brightness'),
  contrast: document.querySelector('#contrast'),
  threshold: document.querySelector('#threshold'),
  activeQuestion: document.querySelector('#activeQuestion'),
  areaModeButton: document.querySelector('#areaModeButton'),
  singleModeButton: document.querySelector('#singleModeButton'),
  areaPanel: document.querySelector('#areaPanel'),
  areaStart: document.querySelector('#areaStart'),
  areaCount: document.querySelector('#areaCount'),
  areaColumns: document.querySelector('#areaColumns'),
  areaPadding: document.querySelector('#areaPadding'),
  areaOrder: document.querySelector('#areaOrder'),
  boxProgress: document.querySelector('#boxProgress'),
  boxList: document.querySelector('#boxList'),
  ocrProgress: document.querySelector('#ocrProgress'),
  ocrProgressText: document.querySelector('#ocrProgressText'),
  cropPreview: document.querySelector('#cropPreview'),
  reviewList: document.querySelector('#reviewList'),
  scoreSummary: document.querySelector('#scoreSummary'),
  resultStats: document.querySelector('#resultStats'),
  studentId: document.querySelector('#studentId'),
  historyList: document.querySelector('#historyList'),
  fromDate: document.querySelector('#fromDate'),
  toDate: document.querySelector('#toDate'),
  restoreInput: document.querySelector('#restoreInput')
};

const state = {
  tests: [],
  currentTest: null,
  sourceCanvas: document.createElement('canvas'),
  adjustedCanvas: document.createElement('canvas'),
  templateEditor: null,
  boxes: [],
  ocrItems: [],
  finalAnswers: {},
  currentGrade: null,
  currentSavedResult: null
};

const ocrEngine = new TesseractOcrEngine();
const gradingEngine = new RuleBasedGradingEngine();

window.addEventListener('load', init);

async function init() {
  state.templateEditor = new TemplateEditor(elements.templateCanvas);
  state.templateEditor.onChange = boxes => {
    state.boxes = boxes;
    renderBoxList();
  };

  bindEvents();
  await loadTests();
  await restoreDraft();
  renderAnswerKey();
  renderQuestionSelectors();
  showStep('setup');
}

function bindEvents() {
  document.querySelectorAll('[data-next]').forEach(button => {
    button.addEventListener('click', () => showStep(button.dataset.next));
  });
  document.querySelectorAll('[data-back]').forEach(button => {
    button.addEventListener('click', () => showStep(button.dataset.back));
  });
  elements.steps.forEach(button => {
    button.addEventListener('click', () => showStep(button.dataset.stepTarget));
  });

  document.querySelector('#newTestButton').addEventListener('click', newTest);
  document.querySelector('#saveTestButton').addEventListener('click', saveTest);
  elements.testSelect.addEventListener('change', selectTest);
  elements.questionCount.addEventListener('change', () => {
    renderAnswerKey();
    renderQuestionSelectors();
  });
  elements.cameraInput.addEventListener('change', handleImageInput);
  elements.fileInput.addEventListener('change', handleImageInput);
  document.querySelector('#rotateLeftButton').addEventListener('click', () => rotateImage('left'));
  document.querySelector('#rotateRightButton').addEventListener('click', () => rotateImage('right'));
  [elements.brightness, elements.contrast, elements.threshold].forEach(input => {
    input.addEventListener('input', refreshAdjustedImage);
  });

  elements.areaModeButton.addEventListener('click', () => setTemplateMode('area'));
  elements.singleModeButton.addEventListener('click', () => setTemplateMode('single'));
  elements.activeQuestion.addEventListener('change', () => {
    state.templateEditor.setActiveNumber(Number(elements.activeQuestion.value));
  });
  [elements.areaStart, elements.areaCount, elements.areaColumns, elements.areaPadding, elements.areaOrder].forEach(input => {
    input.addEventListener('input', syncAreaOptionsFromUi);
    input.addEventListener('change', syncAreaOptionsFromUi);
  });

  document.querySelector('#loadTemplateButton').addEventListener('click', loadTemplateForCurrentTest);
  document.querySelector('#clearBoxesButton').addEventListener('click', () => state.templateEditor.clear());
  document.querySelector('#saveTemplateButton').addEventListener('click', saveTemplate);
  document.querySelector('#startOcrButton').addEventListener('click', runOcr);
  document.querySelector('#confirmResultButton').addEventListener('click', saveCurrentResult);
  document.querySelector('#exportCurrentCsvButton').addEventListener('click', exportCurrentCsv);
  document.querySelector('#exportFilteredCsvButton').addEventListener('click', exportFilteredCsv);
  document.querySelector('#backupButton').addEventListener('click', backupJson);
  elements.restoreInput.addEventListener('change', restoreJson);
  [elements.fromDate, elements.toDate, elements.historyTestSelect].forEach(input => {
    input.addEventListener('change', renderHistory);
  });
}

async function loadTests() {
  state.tests = await getAll('tests');
  if (!state.tests.length) {
    const sample = createDefaultTest();
    await putItem('tests', sample);
    state.tests = [sample];
  }
  renderTestSelects();
  state.currentTest = state.tests[0];
  fillTestForm(state.currentTest);
}

function renderTestSelects() {
  const options = state.tests.map(test => `<option value="${test.id}">${escapeHtml(test.name)}</option>`).join('');
  elements.testSelect.innerHTML = options;
  elements.historyTestSelect.innerHTML = `<option value="">すべて</option>${options}`;
}

function createDefaultTest() {
  const answerKey = {};
  const points = {};
  for (let number = 1; number <= 20; number += 1) {
    answerKey[number] = 'a';
    points[number] = 1;
  }
  return {
    id: createId('test'),
    name: '英語小テスト',
    questionCount: 20,
    answerKey,
    points,
    saveImages: false,
    updatedAt: new Date().toISOString()
  };
}

function newTest() {
  const test = createDefaultTest();
  test.name = `新しいテスト ${state.tests.length + 1}`;
  state.currentTest = test;
  fillTestForm(test);
  showMessage('新しいテスト設定を入力してください。');
}

function fillTestForm(test) {
  elements.testSelect.value = test.id;
  elements.testName.value = test.name || '';
  elements.questionCount.value = test.questionCount || 20;
  elements.saveImages.checked = Boolean(test.saveImages);
  renderAnswerKey();
  renderQuestionSelectors();
}

function selectTest() {
  state.currentTest = state.tests.find(test => test.id === elements.testSelect.value) || state.tests[0];
  fillTestForm(state.currentTest);
  loadTemplateForCurrentTest();
}

function readTestForm() {
  const questionCount = Number(elements.questionCount.value || 20);
  const answerKey = {};
  const points = {};
  document.querySelectorAll('[data-answer-number]').forEach(row => {
    const number = Number(row.dataset.answerNumber);
    const selected = row.querySelector('.answer-choice .is-selected');
    const pointInput = row.querySelector('input');
    answerKey[number] = selected ? selected.dataset.value : 'a';
    points[number] = Number(pointInput.value || 1);
  });
  return {
    id: state.currentTest?.id || createId('test'),
    name: elements.testName.value.trim() || '無題のテスト',
    questionCount,
    answerKey,
    points,
    saveImages: elements.saveImages.checked,
    updatedAt: new Date().toISOString()
  };
}

function renderAnswerKey() {
  const count = Number(elements.questionCount.value || 20);
  const current = state.currentTest || {};
  const rows = [];
  for (let number = 1; number <= count; number += 1) {
    const answer = normalizeChoice(current.answerKey?.[number]) || 'a';
    const point = current.points?.[number] ?? 1;
    rows.push(`
      <div class="answer-row" data-answer-number="${number}">
        <strong>問${number}</strong>
        <div class="answer-choice">
          ${['a', 'b', 'c'].map(choice => `<button type="button" class="${choice === answer ? 'is-selected' : ''}" data-value="${choice}">${choice}</button>`).join('')}
        </div>
        <input type="number" min="0" step="0.5" value="${point}" aria-label="配点">
      </div>
    `);
  }
  elements.answerKey.innerHTML = rows.join('');
  elements.answerKey.querySelectorAll('.answer-choice button').forEach(button => {
    button.addEventListener('click', () => {
      button.parentElement.querySelectorAll('button').forEach(item => item.classList.remove('is-selected'));
      button.classList.add('is-selected');
    });
  });
}

function renderQuestionSelectors() {
  const count = Number(elements.questionCount.value || 20);
  const options = [];
  for (let number = 1; number <= count; number += 1) {
    options.push(`<option value="${number}">問${number}</option>`);
  }
  elements.activeQuestion.innerHTML = options.join('');
  elements.activeQuestion.value = Math.min(Number(elements.activeQuestion.value || 1), count);
  elements.areaStart.max = String(count);
  elements.areaCount.max = String(count);
  elements.areaCount.value = String(count);
  state.templateEditor.setQuestionCount(count);
  state.templateEditor.setActiveNumber(Number(elements.activeQuestion.value || 1));
  syncAreaOptionsFromUi();
  renderBoxList();
}

async function saveTest() {
  const test = readTestForm();
  await putItem('tests', test);
  state.currentTest = test;
  state.tests = await getAll('tests');
  renderTestSelects();
  elements.testSelect.value = test.id;
  showMessage('テスト設定を保存しました。', 'ok');
}

async function handleImageInput(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const image = await loadImageFromFile(file);
    drawImageToCanvas(image, state.sourceCanvas);
    refreshAdjustedImage();
    state.templateEditor.setImage(state.adjustedCanvas);
    await saveDraft();
    showMessage('答案画像を読み込みました。撮影済み画像でもこのまま使えます。', 'ok');
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    event.target.value = '';
  }
}

function rotateImage(direction) {
  if (!state.sourceCanvas.width) {
    showMessage('先に画像を選択してください。', 'error');
    return;
  }
  rotateCanvas(state.sourceCanvas, direction);
  refreshAdjustedImage();
  state.templateEditor.setImage(state.adjustedCanvas);
}

function refreshAdjustedImage() {
  if (!state.sourceCanvas.width) return;
  applyAdjustments(state.sourceCanvas, state.adjustedCanvas, getImageSettings());
  copyCanvas(state.adjustedCanvas, elements.mainCanvas);
  if (state.templateEditor) state.templateEditor.setImage(state.adjustedCanvas);
  elements.blurWarning.classList.toggle('hidden', detectBlur(state.adjustedCanvas) >= 80);
}

function getImageSettings() {
  return {
    brightness: Number(elements.brightness.value || 0),
    contrast: Number(elements.contrast.value || 0),
    threshold: Number(elements.threshold.value || 0)
  };
}

function setTemplateMode(mode) {
  const isArea = mode !== 'single';
  state.templateEditor.setMode(isArea ? 'area' : 'single');
  elements.areaModeButton.classList.toggle('is-selected', isArea);
  elements.singleModeButton.classList.toggle('is-selected', !isArea);
  elements.areaPanel.classList.toggle('hidden', !isArea);
  showMessage(isArea ? '回答が書かれている範囲全体を大きく囲んでください。' : '修正したい問題を選び、その問題の回答欄だけを囲んでください。');
}

function syncAreaOptionsFromUi() {
  state.templateEditor.setAreaOptions({
    start: Number(elements.areaStart.value || 1),
    count: Number(elements.areaCount.value || 1),
    columns: Number(elements.areaColumns.value || 1),
    padding: Number(elements.areaPadding.value || 0),
    order: elements.areaOrder.value
  });
}

async function saveTemplate() {
  const test = readTestForm();
  const missing = getMissingBoxNumbers(test);
  if (missing.length) {
    showMessage(`未指定の回答欄があります: ${missing.join(', ')}`, 'error');
    return;
  }
  await putItem('templates', {
    id: test.id,
    testId: test.id,
    boxes: state.boxes,
    imageWidth: state.adjustedCanvas.width,
    imageHeight: state.adjustedCanvas.height,
    updatedAt: new Date().toISOString()
  });
  showMessage('回答範囲を保存しました。', 'ok');
}

async function loadTemplateForCurrentTest() {
  const test = readTestForm();
  const template = await getItem('templates', test.id);
  if (template?.boxes?.length) {
    state.templateEditor.setBoxes(template.boxes);
    showMessage('保存済みの回答範囲を表示しました。必要なら個別修正で上書きできます。', 'ok');
  } else {
    showMessage('このテストの保存済み回答範囲はありません。');
  }
}

function renderBoxList() {
  const count = Number(elements.questionCount.value || 20);
  const found = new Set(state.boxes.map(box => box.number));
  const missing = [];
  const rows = [];
  for (let number = 1; number <= count; number += 1) {
    const isFound = found.has(number);
    if (!isFound) missing.push(number);
    rows.push(`
      <div class="box-row ${isFound ? 'is-done' : ''}">
        <strong>問${number}</strong>
        <span>${isFound ? '指定済み' : '未指定'}</span>
        <div class="box-actions">
          <button class="secondary" type="button" data-select-box="${number}">修正</button>
          <button class="secondary" type="button" data-remove-box="${number}">削除</button>
        </div>
      </div>
    `);
  }
  elements.boxList.innerHTML = rows.join('');
  elements.boxProgress.textContent = missing.length
    ? `指定済み ${count - missing.length}/${count}。未指定: ${missing.join(', ')}`
    : 'すべての回答欄を指定済みです。';
  elements.boxProgress.className = missing.length ? 'message warn' : 'message ok';

  elements.boxList.querySelectorAll('[data-select-box]').forEach(button => {
    button.addEventListener('click', () => {
      const number = Number(button.dataset.selectBox);
      elements.activeQuestion.value = String(number);
      state.templateEditor.setActiveNumber(number);
      setTemplateMode('single');
    });
  });
  elements.boxList.querySelectorAll('[data-remove-box]').forEach(button => {
    button.addEventListener('click', () => state.templateEditor.removeBox(Number(button.dataset.removeBox)));
  });
}

function getMissingBoxNumbers(test) {
  const found = new Set(state.boxes.map(box => box.number));
  const missing = [];
  for (let number = 1; number <= test.questionCount; number += 1) {
    if (!found.has(number)) missing.push(number);
  }
  return missing;
}

async function runOcr() {
  try {
    const test = readTestForm();
    state.currentTest = test;
    await putItem('tests', test);

    if (!state.adjustedCanvas.width) {
      showMessage('先に答案画像を選択してください。', 'error');
      return;
    }
    const missing = getMissingBoxNumbers(test);
    if (missing.length) {
      showMessage(`未指定の回答欄があります: ${missing.join(', ')}`, 'error');
      return;
    }

    showStep('ocr');
    elements.ocrProgress.value = 0;
    elements.cropPreview.innerHTML = '';
    state.ocrItems = [];

    await ocrEngine.initialize(progress => {
      elements.ocrProgressText.textContent = `OCR準備中: ${progress.status} ${progress.progress}%`;
    });

    const boxes = state.boxes.slice().filter(box => box.number <= test.questionCount).sort((a, b) => a.number - b.number);
    for (let index = 0; index < boxes.length; index += 1) {
      const box = boxes[index];
      const crop = cropByRatio(state.adjustedCanvas, box, 0.03);
      const result = await ocrEngine.recognizeAnswerImage(crop, {
        onProgress: progress => {
          elements.ocrProgressText.textContent = `問${box.number}を読み取り中: ${progress.progress}%`;
        }
      });
      const item = { number: box.number, cropDataUrl: crop.toDataURL('image/png'), ...result };
      state.ocrItems.push(item);
      renderCropCard(item);
      elements.ocrProgress.value = Math.round(((index + 1) / boxes.length) * 100);
      await saveDraft();
    }

    state.finalAnswers = Object.fromEntries(state.ocrItems.map(item => [item.number, item.answer || '']));
    gradeAndRender();
    showMessage('OCRが完了しました。確認画面で結果を確認してください。', 'ok');
    showStep('review');
  } catch (error) {
    showMessage(error.message || 'OCR処理でエラーが発生しました。', 'error');
  }
}

function renderCropCard(item) {
  const card = document.createElement('div');
  card.className = 'crop-card';
  card.innerHTML = `<strong>問${item.number}</strong><p>${escapeHtml(item.answer || '未回答')} / ${Math.round(item.confidence)}% / ${escapeHtml(item.variantName || '')}</p>`;
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    card.appendChild(canvas);
  };
  image.src = item.cropDataUrl;
  elements.cropPreview.appendChild(card);
}

function gradeAndRender() {
  state.currentGrade = gradingEngine.grade(state.currentTest, state.finalAnswers, state.ocrItems);
  elements.scoreSummary.textContent = `${state.currentGrade.totalScore} / ${state.currentGrade.maxScore}`;
  elements.resultStats.innerHTML = [
    ['正答数', state.currentGrade.correctCount],
    ['誤答数', state.currentGrade.wrongCount],
    ['未回答数', state.currentGrade.blankCount],
    ['誤答番号', state.currentGrade.wrongNumbers.join(', ') || 'なし']
  ].map(([label, value]) => `<div class="stat">${label}: ${escapeHtml(value)}</div>`).join('');

  const reviewItems = state.currentGrade.details.slice().sort((a, b) => {
    const aNeeds = needsReview(a);
    const bNeeds = needsReview(b);
    if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
    return a.number - b.number;
  });

  elements.reviewList.innerHTML = reviewItems.map(item => renderReviewCard(item)).join('');
  elements.reviewList.querySelectorAll('[data-manual-answer]').forEach(button => {
    button.addEventListener('click', () => {
      state.finalAnswers[Number(button.dataset.number)] = button.dataset.manualAnswer;
      gradeAndRender();
      saveDraft();
    });
  });
}

function renderReviewCard(item) {
  const ocr = state.ocrItems.find(entry => entry.number === item.number) || {};
  const choices = ['a', 'b', 'c', ''].map(choice => {
    const label = choice || '未回答';
    return `<button type="button" class="${item.finalAnswer === choice ? 'is-selected' : ''}" data-number="${item.number}" data-manual-answer="${choice}">${label}</button>`;
  }).join('');
  return `
    <article class="review-card ${needsReview(item) ? 'needs-review' : ''}">
      <strong>問${item.number}</strong>
      <img src="${ocr.cropDataUrl || ''}" alt="問${item.number}の回答欄" style="width:100%;border:1px solid #d8d1c4;border-radius:6px;background:#fff;margin-top:8px;">
      <div class="review-meta">
        <span>OCR: ${escapeHtml(item.ocrAnswer || '未回答')}</span>
        <span>確信度: ${Math.round(item.ocrConfidence)}%</span>
        <span>正答: ${escapeHtml(item.correct)}</span>
        <span>${item.isCorrect ? '正解' : item.isBlank ? '未回答' : '不正解'}</span>
        <span>前処理: ${escapeHtml(ocr.variantName || '標準')}</span>
        <span>黒画素: ${Math.round((ocr.inkRatio || 0) * 1000) / 10}%</span>
      </div>
      ${ocr.processedDataUrl ? `<img src="${ocr.processedDataUrl}" alt="問${item.number}のOCR用補正画像" style="width:100%;border:1px solid #d8d1c4;border-radius:6px;background:#fff;margin-top:8px;">` : ''}
      <div class="manual-choice">${choices}</div>
    </article>
  `;
}

function needsReview(item) {
  return item.ocrConfidence < 72 || ['blank', 'multiple', 'invalid', 'low-confidence'].includes(item.status);
}

async function saveCurrentResult() {
  if (!state.currentGrade) {
    showMessage('採点結果がありません。', 'error');
    return;
  }
  const result = {
    id: createId('result'),
    gradedAt: new Date().toISOString(),
    testId: state.currentTest.id,
    testName: state.currentTest.name,
    studentId: elements.studentId.value.trim(),
    imageDataUrl: state.currentTest.saveImages ? state.adjustedCanvas.toDataURL('image/jpeg', 0.8) : '',
    ...state.currentGrade
  };
  await putItem('results', result);
  state.currentSavedResult = result;
  await saveDraft();
  await renderHistory();
  showMessage('採点結果を保存しました。定期的なCSVまたはJSONバックアップをおすすめします。', 'ok');
  showStep('history');
}

async function renderHistory() {
  const results = await getFilteredResults();
  elements.historyList.innerHTML = results.map(result => `
    <article class="history-row">
      <time class="history-date">${escapeHtml(formatDateTime(result.gradedAt))}</time>
      <div class="history-title">${escapeHtml(result.testName)}</div>
      <div class="history-student">識別番号: ${escapeHtml(result.studentId || 'なし')}</div>
      <div class="history-score">${result.totalScore}/${result.maxScore}</div>
    </article>
  `).join('') || '<p class="subtext">保存済みの結果はありません。</p>';
}

async function getFilteredResults() {
  const results = await getAll('results');
  const from = elements.fromDate.value ? new Date(`${elements.fromDate.value}T00:00:00`) : null;
  const to = elements.toDate.value ? new Date(`${elements.toDate.value}T23:59:59`) : null;
  const testId = elements.historyTestSelect.value;
  return results
    .filter(result => !testId || result.testId === testId)
    .filter(result => !from || new Date(result.gradedAt) >= from)
    .filter(result => !to || new Date(result.gradedAt) <= to)
    .sort((a, b) => new Date(b.gradedAt) - new Date(a.gradedAt));
}

function exportCurrentCsv() {
  if (!state.currentSavedResult) {
    showMessage('先に採点結果を保存してください。', 'error');
    return;
  }
  downloadCsv('採点結果_今回分.csv', resultToCsvRows([state.currentSavedResult]));
}

async function exportFilteredCsv() {
  const results = await getFilteredResults();
  if (!results.length) {
    showMessage('出力できる採点結果がありません。', 'error');
    return;
  }
  downloadCsv('採点結果_一括.csv', resultToCsvRows(results));
}

async function backupJson() {
  downloadJson('自動採点バックアップ.json', await exportAllData());
}

async function restoreJson(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await importAllData(JSON.parse(await file.text()));
    await loadTests();
    await renderHistory();
    showMessage('JSONバックアップを復元しました。', 'ok');
  } catch (error) {
    showMessage(error.message || '復元できませんでした。', 'error');
  }
}

async function saveDraft() {
  await putItem('drafts', {
    id: 'current',
    step: document.querySelector('.wizard-panel.is-active')?.id || 'setup',
    testId: state.currentTest?.id || '',
    boxes: state.boxes,
    ocrItems: state.ocrItems,
    finalAnswers: state.finalAnswers,
    savedAt: new Date().toISOString()
  });
}

async function restoreDraft() {
  const draft = await getItem('drafts', 'current');
  if (!draft) return;
  state.ocrItems = draft.ocrItems || [];
  state.finalAnswers = draft.finalAnswers || {};
  if (draft.boxes?.length) state.templateEditor.setBoxes(draft.boxes);
  if (draft.ocrItems?.length) showMessage('前回の途中状態を復元しました。画像は必要に応じて再選択してください。');
}

function showStep(stepId) {
  elements.panels.forEach(panel => panel.classList.toggle('is-active', panel.id === stepId));
  elements.steps.forEach(step => step.classList.toggle('is-active', step.dataset.stepTarget === stepId));
  if (stepId === 'template') {
    renderQuestionSelectors();
    setTemplateMode('area');
    if (state.adjustedCanvas.width) state.templateEditor.setImage(state.adjustedCanvas);
  }
  if (stepId === 'history') renderHistory();
  saveDraft();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showMessage(text, type = '') {
  elements.message.textContent = text;
  elements.message.className = `message ${type}`.trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
