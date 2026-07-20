import { TesseractOcrEngine } from './ocr.js';
import { PaddleOcrEngine } from './engines/PaddleOcrEngine.js';
import { RuleBasedGradingEngine, normalizeChoice } from './grading.js';
import { TemplateEditor } from './templateEditor.js';
import { detectAnswerBoxesFromLines } from './answerBoxDetector.js';
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
  ocrMode: document.querySelector('#ocrMode'),
  ocrServerUrl: document.querySelector('#ocrServerUrl'),
  ocrDeviceToken: document.querySelector('#ocrDeviceToken'),
  saveOcrSettingsButton: document.querySelector('#saveOcrSettingsButton'),
  testOcrServerButton: document.querySelector('#testOcrServerButton'),
  ocrServerStatus: document.querySelector('#ocrServerStatus'),
  cameraInput: document.querySelector('#cameraInput'),
  fileInput: document.querySelector('#fileInput'),
  mainCanvas: document.querySelector('#mainCanvas'),
  templateCanvas: document.querySelector('#templateCanvas'),
  blurWarning: document.querySelector('#blurWarning'),
  brightness: document.querySelector('#brightness'),
  contrast: document.querySelector('#contrast'),
  threshold: document.querySelector('#threshold'),
  activeQuestion: document.querySelector('#activeQuestion'),
  anchorModeButton: document.querySelector('#anchorModeButton'),
  pointModeButton: document.querySelector('#pointModeButton'),
  areaModeButton: document.querySelector('#areaModeButton'),
  singleModeButton: document.querySelector('#singleModeButton'),
  anchorPanel: document.querySelector('#anchorPanel'),
  anchorStatus: document.querySelector('#anchorStatus'),
  resetAnchorsButton: document.querySelector('#resetAnchorsButton'),
  pointPanel: document.querySelector('#pointPanel'),
  areaPanel: document.querySelector('#areaPanel'),
  pointWidth: document.querySelector('#pointWidth'),
  pointHeight: document.querySelector('#pointHeight'),
  pointAutoNext: document.querySelector('#pointAutoNext'),
  areaStart: document.querySelector('#areaStart'),
  areaCount: document.querySelector('#areaCount'),
  areaColumns: document.querySelector('#areaColumns'),
  areaPadding: document.querySelector('#areaPadding'),
  areaOrder: document.querySelector('#areaOrder'),
  detectBoxesButton: document.querySelector('#detectBoxesButton'),
  detectBoxesInAreaButton: document.querySelector('#detectBoxesInAreaButton'),
  autoDetectStatus: document.querySelector('#autoDetectStatus'),
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

const tesseractEngine = new TesseractOcrEngine();
const paddleEngine = new PaddleOcrEngine(getOcrSettings);
const gradingEngine = new RuleBasedGradingEngine();

window.addEventListener('load', init);

async function init() {
  state.templateEditor = new TemplateEditor(elements.templateCanvas);
  state.templateEditor.onChange = boxes => {
    state.boxes = boxes;
    renderBoxList();
  };
  state.templateEditor.onActiveNumberChange = number => {
    elements.activeQuestion.value = String(number);
  };
  state.templateEditor.onAnchorProgressChange = renderAnchorStatus;

  bindEvents();
  await loadTests();
  loadOcrSettings();
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
  elements.saveOcrSettingsButton.addEventListener('click', saveOcrSettings);
  elements.testOcrServerButton.addEventListener('click', testOcrServer);
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
  elements.anchorModeButton.addEventListener('click', () => setTemplateMode('anchor'));
  elements.pointModeButton.addEventListener('click', () => setTemplateMode('point'));
  elements.areaModeButton.addEventListener('click', () => setTemplateMode('area'));
  elements.singleModeButton.addEventListener('click', () => setTemplateMode('single'));
  elements.activeQuestion.addEventListener('change', () => {
    state.templateEditor.setActiveNumber(Number(elements.activeQuestion.value));
  });
  [elements.pointWidth, elements.pointHeight, elements.pointAutoNext].forEach(input => {
    input.addEventListener('input', syncPointOptionsFromUi);
    input.addEventListener('change', syncPointOptionsFromUi);
  });
  [elements.areaStart, elements.areaCount, elements.areaColumns, elements.areaPadding, elements.areaOrder].forEach(input => {
    input.addEventListener('input', syncAreaOptionsFromUi);
    input.addEventListener('change', syncAreaOptionsFromUi);
  });
  document.querySelector('#loadTemplateButton').addEventListener('click', loadTemplateForCurrentTest);
  elements.resetAnchorsButton.addEventListener('click', () => state.templateEditor.resetAnchors());
  elements.detectBoxesButton.addEventListener('click', () => detectBoxesFromFrameLines());
  elements.detectBoxesInAreaButton.addEventListener('click', () => detectBoxesFromFrameLines({ useManualArea: true }));
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

function loadOcrSettings() {
  const settings = getOcrSettings();
  elements.ocrMode.value = settings.mode;
  elements.ocrServerUrl.value = settings.serverUrl;
  elements.ocrDeviceToken.value = settings.deviceToken;
}

function getOcrSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('free-ocr-grader-ocr-settings') || '{}');
    return {
      mode: saved.mode || 'paddle',
      serverUrl: saved.serverUrl || '',
      deviceToken: saved.deviceToken || ''
    };
  } catch (_error) {
    return { mode: 'paddle', serverUrl: '', deviceToken: '' };
  }
}

function saveOcrSettings() {
  const settings = {
    mode: elements.ocrMode.value,
    serverUrl: elements.ocrServerUrl.value.trim().replace(/\/+$/, ''),
    deviceToken: elements.ocrDeviceToken.value.trim()
  };
  localStorage.setItem('free-ocr-grader-ocr-settings', JSON.stringify(settings));
  setOcrServerStatus('OCR設定をこの端末に保存しました。公開コードには保存されません。', 'ok');
}

async function testOcrServer() {
  saveOcrSettings();
  const originalText = elements.testOcrServerButton.textContent;
  try {
    elements.testOcrServerButton.disabled = true;
    elements.testOcrServerButton.textContent = '接続中...';
    setOcrServerStatus('採点サーバーへ接続しています。');
    showMessage('採点サーバーへ接続しています。');
    const health = await paddleEngine.healthCheck();
    const message = health.ready
      ? 'PaddleOCRサーバーに接続できました。'
      : 'サーバーには接続できましたが、PaddleOCRの準備が完了していません。';
    const type = health.ready ? 'ok' : 'error';
    setOcrServerStatus(message, type);
    showMessage(message, type);
  } catch (error) {
    const message = error.message || '採点サーバーに接続できませんでした。';
    setOcrServerStatus(message, 'error');
    showMessage(message, 'error');
  } finally {
    elements.testOcrServerButton.disabled = false;
    elements.testOcrServerButton.textContent = originalText;
  }
}

function setOcrServerStatus(message, type = '') {
  elements.ocrServerStatus.textContent = message;
  elements.ocrServerStatus.className = `message ${type}`.trim();
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
  syncPointOptionsFromUi();
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
    showMessage('答案画像を読み込みました。', 'ok');
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
  const selectedMode = ['anchor', 'point', 'area', 'single'].includes(mode) ? mode : 'anchor';
  const isAnchor = selectedMode === 'anchor';
  const isPoint = selectedMode === 'point';
  const isArea = selectedMode === 'area';
  const isSingle = selectedMode === 'single';
  state.templateEditor.setMode(selectedMode);
  elements.anchorModeButton.classList.toggle('is-selected', isAnchor);
  elements.pointModeButton.classList.toggle('is-selected', isPoint);
  elements.areaModeButton.classList.toggle('is-selected', isArea);
  elements.singleModeButton.classList.toggle('is-selected', isSingle);
  elements.anchorPanel.classList.toggle('hidden', !isAnchor);
  elements.pointPanel.classList.toggle('hidden', !(isAnchor || isPoint));
  elements.areaPanel.classList.toggle('hidden', !(isAnchor || isArea));
  const messages = {
    anchor: '各列の一番上と一番下の回答文字だけをタップしてください。間の問題は自動配置します。',
    point: '回答文字の中心をタップしてください。タップ後は次の問題へ進みます。',
    area: '回答が書かれている範囲全体を大きく囲んでください。',
    single: '修正したい問題を選び、その問題の回答欄だけを囲んでください。'
  };
  showMessage(messages[selectedMode]);
  renderAnchorStatus(state.templateEditor.getAnchorStatus());
}

function syncPointOptionsFromUi() {
  state.templateEditor.setPointOptions({
    widthPercent: Number(elements.pointWidth.value || 7),
    heightPercent: Number(elements.pointHeight.value || 3.5),
    autoNext: elements.pointAutoNext.checked
  });
}

function syncAreaOptionsFromUi() {
  state.templateEditor.setAreaOptions({
    start: Number(elements.areaStart.value || 1),
    count: Number(elements.areaCount.value || 1),
    columns: Number(elements.areaColumns.value || 1),
    padding: Number(elements.areaPadding.value || 0),
    order: elements.areaOrder.value
  });
  renderAnchorStatus(state.templateEditor.getAnchorStatus());
}

function renderAnchorStatus(status) {
  if (!elements.anchorStatus || !status) return;
  elements.anchorStatus.textContent = status.message;
  elements.anchorStatus.className = status.completed >= status.total && status.total > 0
    ? 'message ok'
    : 'message';
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

async function detectBoxesFromFrameLines(options = {}) {
  const useManualArea = Boolean(options.useManualArea);
  const button = useManualArea ? elements.detectBoxesInAreaButton : elements.detectBoxesButton;
  const originalText = button.textContent;
  try {
    const test = readTestForm();
    if (!state.adjustedCanvas.width) {
      showMessage('先に答案画像を選択してください。', 'error');
      return;
    }

    const searchArea = useManualArea ? getManualSearchArea(test) : null;
    if (useManualArea && !searchArea) {
      const message = '先に「範囲をまとめて」で回答欄全体を大きく囲んでください。';
      elements.autoDetectStatus.textContent = message;
      elements.autoDetectStatus.className = 'message warn';
      showMessage(message, 'error');
      return;
    }

    button.disabled = true;
    button.textContent = '検出中...';
    elements.autoDetectStatus.textContent = useManualArea ? '指定した大枠内だけで枠線を検出しています。' : '画像全体から枠線を検出しています。';
    elements.autoDetectStatus.className = 'message';

    const result = detectAnswerBoxesFromLines(state.adjustedCanvas, {
      start: Number(elements.areaStart.value || 1),
      count: Math.min(Number(elements.areaCount.value || test.questionCount), test.questionCount),
      columns: Number(elements.areaColumns.value || 1),
      order: elements.areaOrder.value,
      insetPercent: Number(elements.areaPadding.value || 10),
      searchArea
    });

    if (!result.boxes.length) {
      elements.autoDetectStatus.textContent = result.message;
      elements.autoDetectStatus.className = 'message warn';
      showMessage(result.message, 'error');
      return;
    }

    const replaceNumbers = new Set(result.boxes.map(box => box.number));
    const boxes = state.boxes.filter(box => !replaceNumbers.has(box.number)).concat(result.boxes);
    state.templateEditor.setBoxes(boxes);
    await saveDraft();

    elements.autoDetectStatus.textContent =
      `${result.message} 検出線: 横${result.horizontalLineCount} / 縦${result.verticalLineCount} / 候補${result.candidateCount}`;
    elements.autoDetectStatus.className = 'message ok';
    showMessage(useManualArea ? '指定した大枠内の枠線から回答欄候補を作成しました。' : '枠線から回答欄候補を作成しました。', 'ok');
  } catch (error) {
    const message = error.message || '枠線の自動検出に失敗しました。';
    elements.autoDetectStatus.textContent = message;
    elements.autoDetectStatus.className = 'message error';
    showMessage(message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function getManualSearchArea(test) {
  const lastArea = state.templateEditor.getLastAreaBox?.();
  if (lastArea) return expandRatioBox(lastArea, 0.015);

  const start = Number(elements.areaStart.value || 1);
  const count = Math.min(Number(elements.areaCount.value || test.questionCount), test.questionCount);
  const end = start + count - 1;
  const boxes = state.boxes.filter(box => box.number >= start && box.number <= end);
  if (!boxes.length) return null;

  const minX = Math.min(...boxes.map(box => box.x));
  const minY = Math.min(...boxes.map(box => box.y));
  const maxX = Math.max(...boxes.map(box => box.x + box.width));
  const maxY = Math.max(...boxes.map(box => box.y + box.height));
  return expandRatioBox({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, 0.035);
}

function expandRatioBox(box, amount) {
  const x = Math.max(0, box.x - amount);
  const y = Math.max(0, box.y - amount);
  const right = Math.min(1, box.x + box.width + amount);
  const bottom = Math.min(1, box.y + box.height + amount);
  return {
    x,
    y,
    width: Math.max(0.01, right - x),
    height: Math.max(0.01, bottom - y)
  };
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
      setTemplateMode('point');
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

    saveOcrSettings();
    showStep('ocr');
    elements.ocrProgress.value = 0;
    elements.cropPreview.innerHTML = '';
    state.ocrItems = [];

    const boxes = state.boxes.slice().filter(box => box.number <= test.questionCount).sort((a, b) => a.number - b.number);
    const crops = boxes.map(box => {
      const crop = cropByRatio(state.adjustedCanvas, box, 0);
      return { number: box.number, canvas: crop, cropDataUrl: crop.toDataURL('image/png') };
    });

    state.ocrItems = await recognizeCrops(crops);
    state.ocrItems.forEach(renderCropCard);
    state.finalAnswers = Object.fromEntries(state.ocrItems.map(item => [item.number, item.answer || '']));
    gradeAndRender();
    showMessage('OCRが完了しました。確認画面で結果を確認してください。', 'ok');
    showStep('review');
  } catch (error) {
    showMessage(error.message || 'OCR処理でエラーが発生しました。', 'error');
  }
}

async function recognizeCrops(crops) {
  const settings = getOcrSettings();
  if (settings.mode === 'tesseract') {
    return recognizeWithTesseract(crops);
  }
  if (settings.mode === 'compare') {
    const [paddleItems, tesseractItems] = await Promise.all([
      recognizeWithPaddle(crops),
      recognizeWithTesseract(crops)
    ]);
    return paddleItems.map(item => ({
      ...item,
      tesseractComparison: tesseractItems.find(other => other.number === item.number)
    }));
  }
  return recognizeWithPaddle(crops);
}

async function recognizeWithPaddle(crops) {
  elements.ocrProgressText.textContent = 'PaddleOCRサーバーへ送信しています。';
  const results = await paddleEngine.recognizeAnswerImages(crops, {
    onProgress: progress => {
      elements.ocrProgressText.textContent = `${progress.status}: ${progress.progress}%`;
    }
  });
  elements.ocrProgress.value = 100;
  return results.map(result => ({
    ...result,
    number: result.number,
    cropDataUrl: crops.find(crop => crop.number === result.number)?.cropDataUrl || '',
    engine: 'paddle'
  }));
}

async function recognizeWithTesseract(crops) {
  await tesseractEngine.initialize(progress => {
    elements.ocrProgressText.textContent = `Tesseract準備中: ${progress.status} ${progress.progress}%`;
  });

  const results = [];
  for (let index = 0; index < crops.length; index += 1) {
    const crop = crops[index];
    const result = await tesseractEngine.recognizeAnswerImage(crop.canvas, {
      onProgress: progress => {
        elements.ocrProgressText.textContent = `問${crop.number}をTesseractで読み取り中: ${progress.progress}%`;
      }
    });
    results.push({ number: crop.number, cropDataUrl: crop.cropDataUrl, engine: 'tesseract', ...result });
    elements.ocrProgress.value = Math.round(((index + 1) / crops.length) * 100);
    await saveDraft();
  }
  return results;
}

function renderCropCard(item) {
  const card = document.createElement('div');
  card.className = 'crop-card';
  card.innerHTML = `<strong>問${item.number}</strong><p>${escapeHtml(item.answer || '未回答')} / ${Math.round(item.confidence)}% / ${escapeHtml(item.variantName || item.engine || '')}</p>`;
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
  const compare = ocr.tesseractComparison
    ? `<span>Tesseract: ${escapeHtml(ocr.tesseractComparison.answer || '未回答')} / ${Math.round(ocr.tesseractComparison.confidence)}%</span>`
    : '';
  const warnings = (ocr.warnings || []).length ? `<span>警告: ${escapeHtml(ocr.warnings.join('、'))}</span>` : '';
  return `
    <article class="review-card ${needsReview(item) ? 'needs-review' : ''}">
      <strong>問${item.number}</strong>
      <img src="${ocr.cropDataUrl || ''}" alt="問${item.number}の回答欄" style="width:100%;border:1px solid #d8d1c4;border-radius:6px;background:#fff;margin-top:8px;">
      <div class="review-meta">
        <span>OCR: ${escapeHtml(item.ocrAnswer || '未回答')}</span>
        <span>信頼度: ${Math.round(item.ocrConfidence)}%</span>
        <span>正答: ${escapeHtml(item.correct)}</span>
        <span>${item.isCorrect ? '正解' : item.isBlank ? '未回答' : '不正解'}</span>
        <span>エンジン: ${escapeHtml(ocr.variantName || ocr.engine || '標準')}</span>
        ${compare}
        ${warnings}
      </div>
      ${ocr.processedDataUrl ? `<img src="${ocr.processedDataUrl}" alt="問${item.number}のOCR用補正画像" style="width:100%;border:1px solid #d8d1c4;border-radius:6px;background:#fff;margin-top:8px;">` : ''}
      <div class="manual-choice">${choices}</div>
    </article>
  `;
}

function needsReview(item) {
  return item.ocrConfidence < 72 || ['blank', 'multiple', 'invalid', 'low-confidence', 'unreadable'].includes(item.status);
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
    ocrItems: state.ocrItems.map(({ cropDataUrl, processedDataUrl, ...item }) => item),
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
    setTemplateMode('anchor');
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
