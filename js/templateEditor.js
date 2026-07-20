export class TemplateEditor {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.imageCanvas = null;
    this.boxes = [];
    this.activeNumber = 1;
    this.mode = 'anchor';
    this.questionCount = 20;
    this.areaOptions = { start: 1, count: 20, columns: 1, order: 'column', padding: 10 };
    this.pointOptions = { widthPercent: 7, heightPercent: 3.5, autoNext: true };
    this.anchorPoints = [];
    this.lastAreaBox = null;
    this.dragStart = null;
    this.previewBox = null;
    this.onChange = () => {};
    this.onActiveNumberChange = () => {};
    this.onAnchorProgressChange = () => {};
    this.bindEvents();
  }

  setImage(imageCanvas) {
    this.imageCanvas = imageCanvas;
    this.canvas.width = imageCanvas.width;
    this.canvas.height = imageCanvas.height;
    this.redraw();
  }

  setQuestionCount(count) {
    this.questionCount = Number(count || 1);
    this.activeNumber = clampNumber(this.activeNumber, 1, this.questionCount);
    this.areaOptions.count = Math.min(this.areaOptions.count, this.questionCount);
    this.redraw();
  }

  setActiveNumber(number) {
    this.activeNumber = clampNumber(Number(number || 1), 1, this.questionCount);
    this.redraw();
  }

  setMode(mode) {
    this.mode = ['anchor', 'area', 'single', 'point'].includes(mode) ? mode : 'anchor';
    this.redraw();
    this.onAnchorProgressChange(this.getAnchorStatus());
  }

  setAreaOptions(options) {
    const nextOptions = {
      start: clampNumber(Number(options.start || 1), 1, this.questionCount),
      count: Math.max(1, Math.min(Number(options.count || this.questionCount), this.questionCount)),
      columns: Math.max(1, Math.min(Number(options.columns || 1), 6)),
      order: options.order === 'row' ? 'row' : 'column',
      padding: Math.max(0, Math.min(Number(options.padding || 0), 40))
    };
    const layoutChanged = ['start', 'count', 'columns', 'order']
      .some(key => this.areaOptions[key] !== nextOptions[key]);
    this.areaOptions = nextOptions;
    if (layoutChanged) this.anchorPoints = [];
    this.redraw();
    this.onAnchorProgressChange(this.getAnchorStatus());
  }

  setPointOptions(options) {
    this.pointOptions = {
      widthPercent: clampNumber(Number(options.widthPercent || 7), 1, 30),
      heightPercent: clampNumber(Number(options.heightPercent || 3.5), 1, 20),
      autoNext: Boolean(options.autoNext)
    };
    this.redraw();
  }

  setBoxes(boxes) {
    this.boxes = (boxes || []).map(box => ({ ...box })).sort((a, b) => a.number - b.number);
    this.redraw();
    this.onChange(this.getBoxes());
  }

  clear() {
    this.boxes = [];
    this.lastAreaBox = null;
    this.anchorPoints = [];
    this.redraw();
    this.onAnchorProgressChange(this.getAnchorStatus());
    this.onChange(this.getBoxes());
  }

  removeBox(number) {
    this.boxes = this.boxes.filter(box => box.number !== number);
    this.redraw();
    this.onChange(this.getBoxes());
  }

  getBoxes() {
    return this.boxes.map(box => ({ ...box }));
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', event => {
      if (!this.imageCanvas) return;
      const point = this.getPoint(event);
      this.dragStart = point;
      this.previewBox = { x: point.x, y: point.y, width: 0, height: 0 };
      this.canvas.setPointerCapture(event.pointerId);
    });

    this.canvas.addEventListener('pointermove', event => {
      if (!this.dragStart) return;
      this.previewBox = normalizeBox(this.dragStart, this.getPoint(event));
      this.redraw();
    });

    this.canvas.addEventListener('pointerup', event => {
      if (!this.dragStart || !this.previewBox) return;
      const pixelBox = this.previewBox;
      this.dragStart = null;
      this.previewBox = null;
      this.canvas.releasePointerCapture(event.pointerId);

      if (this.mode === 'anchor') {
        const endPoint = this.getPoint(event);
        const newBoxes = this.registerAnchorPoint(pixelBox, endPoint);
        if (newBoxes.length) {
          const replaceNumbers = new Set(newBoxes.map(box => box.number));
          this.boxes = this.boxes.filter(box => !replaceNumbers.has(box.number)).concat(newBoxes);
          this.boxes.sort((a, b) => a.number - b.number);
          this.onChange(this.getBoxes());
        }
        this.redraw();
        this.onAnchorProgressChange(this.getAnchorStatus());
        return;
      }

      if (this.mode !== 'point' && (pixelBox.width < 8 || pixelBox.height < 8)) {
        this.redraw();
        return;
      }

      let newBoxes;
      if (this.mode === 'area') {
        this.lastAreaBox = this.pixelToRatioArea(pixelBox);
        newBoxes = this.createAreaBoxes(pixelBox);
      } else if (this.mode === 'point') {
        const endPoint = this.getPoint(event);
        newBoxes = [this.createPointBox(pixelBox, endPoint)];
      } else {
        newBoxes = [this.pixelToRatioBox(pixelBox, this.activeNumber)];
      }
      const replaceNumbers = new Set(newBoxes.map(box => box.number));
      this.boxes = this.boxes.filter(box => !replaceNumbers.has(box.number)).concat(newBoxes);
      this.boxes.sort((a, b) => a.number - b.number);
      if (this.mode === 'point' && this.pointOptions.autoNext && this.activeNumber < this.questionCount) {
        this.activeNumber += 1;
        this.onActiveNumberChange(this.activeNumber);
      }
      this.redraw();
      this.onChange(this.getBoxes());
    });
  }

  resetAnchors() {
    this.anchorPoints = [];
    this.redraw();
    this.onAnchorProgressChange(this.getAnchorStatus());
  }

  createAreaBoxes(pixelBox) {
    const boxes = [];
    const { start, count, columns, order, padding } = this.areaOptions;
    const total = Math.min(count, this.questionCount - start + 1);
    const rows = Math.ceil(total / columns);
    const cellWidth = pixelBox.width / columns;
    const cellHeight = pixelBox.height / rows;
    const padX = cellWidth * (padding / 100);
    const padY = cellHeight * (padding / 100);

    for (let index = 0; index < total; index += 1) {
      const row = order === 'row' ? Math.floor(index / columns) : index % rows;
      const col = order === 'row' ? index % columns : Math.floor(index / rows);
      const number = start + index;
      const cell = {
        x: pixelBox.x + col * cellWidth + padX,
        y: pixelBox.y + row * cellHeight + padY,
        width: Math.max(8, cellWidth - padX * 2),
        height: Math.max(8, cellHeight - padY * 2)
      };
      boxes.push(this.pixelToRatioBox(cell, number));
    }
    return boxes;
  }

  createPointBox(pixelBox, endPoint) {
    // 中心タップ方式では、正確に四角を囲まなくても固定サイズの読み取り範囲を作ります。
    return this.pixelToRatioBox(this.createFixedPixelBox(this.getSelectionCenter(pixelBox, endPoint)), this.activeNumber);
  }

  getSelectionCenter(pixelBox, endPoint) {
    const movedEnough = pixelBox.width >= 8 && pixelBox.height >= 8;
    return {
      x: movedEnough ? pixelBox.x + pixelBox.width / 2 : endPoint.x,
      y: movedEnough ? pixelBox.y + pixelBox.height / 2 : endPoint.y
    };
  }

  createFixedPixelBox(center) {
    const width = Math.max(8, this.canvas.width * (this.pointOptions.widthPercent / 100));
    const height = Math.max(8, this.canvas.height * (this.pointOptions.heightPercent / 100));
    const x = clampNumber(center.x - width / 2, 0, Math.max(0, this.canvas.width - width));
    const y = clampNumber(center.y - height / 2, 0, Math.max(0, this.canvas.height - height));
    return { x, y, width, height };
  }

  registerAnchorPoint(pixelBox, endPoint) {
    const step = this.getNextAnchorStep();
    if (!step) {
      this.anchorPoints = [];
      return this.registerAnchorPoint(pixelBox, endPoint);
    }

    const center = this.getSelectionCenter(pixelBox, endPoint);
    this.anchorPoints = this.anchorPoints
      .filter(point => !(point.col === step.col && point.kind === step.kind))
      .concat({
        col: step.col,
        kind: step.kind,
        x: center.x / this.canvas.width,
        y: center.y / this.canvas.height
      });

    return this.areAnchorsComplete() ? this.createAnchorBoxes() : [];
  }

  createAnchorBoxes() {
    const layout = this.getAnchorLayout();
    const boxes = [];

    layout.columns.forEach(col => {
      const slots = layout.slots
        .filter(slot => slot.col === col)
        .sort((a, b) => a.row - b.row);
      const top = this.findAnchorPoint(col, 'top');
      const bottom = this.findAnchorPoint(col, 'bottom') || top;
      if (!top || !bottom) return;

      slots.forEach((slot, index) => {
        const ratio = slots.length <= 1 ? 0 : index / (slots.length - 1);
        const center = {
          x: (top.x + (bottom.x - top.x) * ratio) * this.canvas.width,
          y: (top.y + (bottom.y - top.y) * ratio) * this.canvas.height
        };
        boxes.push(this.pixelToRatioBox(this.createFixedPixelBox(center), slot.number));
      });
    });

    return boxes;
  }

  getAnchorStatus() {
    const steps = this.getAnchorSteps();
    const completed = steps.filter(step => this.findAnchorPoint(step.col, step.kind)).length;
    const next = this.getNextAnchorStep();
    if (!steps.length) {
      return { completed: 0, total: 0, message: '配置する問題がありません。問題数を確認してください。' };
    }
    if (!next) {
      return {
        completed,
        total: steps.length,
        message: `上下指定が完了しました。${this.getAnchorLayout().slots.length}問分の回答範囲を自動配置済みです。`
      };
    }
    return {
      completed,
      total: steps.length,
      message: `次: ${next.label}をタップしてください。進捗 ${completed}/${steps.length}`
    };
  }

  getNextAnchorStep() {
    return this.getAnchorSteps().find(step => !this.findAnchorPoint(step.col, step.kind)) || null;
  }

  areAnchorsComplete() {
    const steps = this.getAnchorSteps();
    return steps.length > 0 && steps.every(step => this.findAnchorPoint(step.col, step.kind));
  }

  getAnchorSteps() {
    const layout = this.getAnchorLayout();
    return layout.columns.flatMap(col => {
      const slots = layout.slots.filter(slot => slot.col === col);
      const columnLabel = `${col + 1}列目`;
      if (slots.length <= 1) {
        return [{ col, kind: 'top', label: `${columnLabel}の回答中心` }];
      }
      return [
        { col, kind: 'top', label: `${columnLabel}の一番上の回答中心` },
        { col, kind: 'bottom', label: `${columnLabel}の一番下の回答中心` }
      ];
    });
  }

  getAnchorLayout() {
    const { start, count, columns, order } = this.areaOptions;
    const total = Math.min(count, this.questionCount - start + 1);
    const rows = Math.ceil(total / columns);
    const slots = [];

    for (let index = 0; index < total; index += 1) {
      const row = order === 'row' ? Math.floor(index / columns) : index % rows;
      const col = order === 'row' ? index % columns : Math.floor(index / rows);
      slots.push({ number: start + index, row, col });
    }

    const usedColumns = [...new Set(slots.map(slot => slot.col))].sort((a, b) => a - b);
    return { slots, columns: usedColumns };
  }

  findAnchorPoint(col, kind) {
    return this.anchorPoints.find(point => point.col === col && point.kind === kind) || null;
  }

  pixelToRatioBox(pixelBox, number) {
    return {
      number,
      x: pixelBox.x / this.canvas.width,
      y: pixelBox.y / this.canvas.height,
      width: pixelBox.width / this.canvas.width,
      height: pixelBox.height / this.canvas.height
    };
  }

  pixelToRatioArea(pixelBox) {
    return {
      x: pixelBox.x / this.canvas.width,
      y: pixelBox.y / this.canvas.height,
      width: pixelBox.width / this.canvas.width,
      height: pixelBox.height / this.canvas.height
    };
  }

  getLastAreaBox() {
    return this.lastAreaBox ? { ...this.lastAreaBox } : null;
  }

  redraw() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.imageCanvas) this.context.drawImage(this.imageCanvas, 0, 0);

    this.boxes.forEach(box => {
      const isActive = box.number === this.activeNumber;
      this.drawBox(ratioToPixelBox(box, this.canvas), isActive ? '#b42318' : '#176c5d', `問${box.number}`);
    });

    this.drawAnchorPoints();

    if (this.previewBox) {
      if (this.mode === 'point' || this.mode === 'anchor') {
        const nextAnchor = this.mode === 'anchor' ? this.getNextAnchorStep() : null;
        const preview = this.createFixedPixelBox(this.getSelectionCenter(this.previewBox, {
          x: this.previewBox.x + this.previewBox.width,
          y: this.previewBox.y + this.previewBox.height
        }));
        this.drawBox(preview, '#365c96', nextAnchor ? nextAnchor.label : `問${this.activeNumber}`);
      } else {
        const label = this.mode === 'area'
          ? `問${this.areaOptions.start}から自動分割`
          : `問${this.activeNumber}`;
        this.drawBox(this.previewBox, '#365c96', label);
      }
    }
  }

  drawAnchorPoints() {
    this.anchorPoints.forEach(point => {
      const x = point.x * this.canvas.width;
      const y = point.y * this.canvas.height;
      const step = this.getAnchorSteps().find(item => item.col === point.col && item.kind === point.kind);
      this.context.save();
      this.context.fillStyle = '#365c96';
      this.context.strokeStyle = '#fff';
      this.context.lineWidth = Math.max(2, this.canvas.width / 520);
      this.context.beginPath();
      this.context.arc(x, y, Math.max(7, this.canvas.width / 180), 0, Math.PI * 2);
      this.context.fill();
      this.context.stroke();
      this.context.fillStyle = 'rgba(255,255,255,.9)';
      this.context.fillRect(x + 8, Math.max(0, y - 28), Math.max(96, (step?.label || '').length * 12), 24);
      this.context.fillStyle = '#365c96';
      this.context.font = `${Math.max(14, this.canvas.width / 56)}px sans-serif`;
      this.context.fillText(step?.label || `${point.col + 1}列目`, x + 14, Math.max(18, y - 10));
      this.context.restore();
    });
  }

  drawBox(box, color, label) {
    this.context.save();
    this.context.strokeStyle = color;
    this.context.lineWidth = Math.max(3, this.canvas.width / 360);
    this.context.fillStyle = 'rgba(255,255,255,.86)';
    this.context.strokeRect(box.x, box.y, box.width, box.height);
    this.context.fillRect(box.x, Math.max(0, box.y - 30), Math.max(72, label.length * 16), 28);
    this.context.fillStyle = color;
    this.context.font = `${Math.max(18, this.canvas.width / 42)}px sans-serif`;
    this.context.fillText(label, box.x + 8, Math.max(22, box.y - 9));
    this.context.beginPath();
    this.context.arc(box.x + box.width / 2, box.y + box.height / 2, Math.max(4, this.canvas.width / 260), 0, Math.PI * 2);
    this.context.fill();
    this.context.restore();
  }

  getPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (this.canvas.width / rect.width),
      y: (event.clientY - rect.top) * (this.canvas.height / rect.height)
    };
  }
}

export function ratioToPixelBox(box, canvas) {
  return {
    x: box.x * canvas.width,
    y: box.y * canvas.height,
    width: box.width * canvas.width,
    height: box.height * canvas.height
  };
}

function normalizeBox(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
