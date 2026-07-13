export class TemplateEditor {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.imageCanvas = null;
    this.boxes = [];
    this.activeNumber = 1;
    this.mode = 'area';
    this.questionCount = 20;
    this.areaOptions = { start: 1, count: 20, columns: 1, order: 'column', padding: 10 };
    this.dragStart = null;
    this.previewBox = null;
    this.onChange = () => {};
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
    this.mode = mode === 'single' ? 'single' : 'area';
    this.redraw();
  }

  setAreaOptions(options) {
    this.areaOptions = {
      start: clampNumber(Number(options.start || 1), 1, this.questionCount),
      count: Math.max(1, Math.min(Number(options.count || this.questionCount), this.questionCount)),
      columns: Math.max(1, Math.min(Number(options.columns || 1), 6)),
      order: options.order === 'row' ? 'row' : 'column',
      padding: Math.max(0, Math.min(Number(options.padding || 0), 40))
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
    this.redraw();
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

      if (pixelBox.width < 8 || pixelBox.height < 8) {
        this.redraw();
        return;
      }

      const newBoxes = this.mode === 'area'
        ? this.createAreaBoxes(pixelBox)
        : [this.pixelToRatioBox(pixelBox, this.activeNumber)];
      const replaceNumbers = new Set(newBoxes.map(box => box.number));
      this.boxes = this.boxes.filter(box => !replaceNumbers.has(box.number)).concat(newBoxes);
      this.boxes.sort((a, b) => a.number - b.number);
      this.redraw();
      this.onChange(this.getBoxes());
    });
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

  pixelToRatioBox(pixelBox, number) {
    return {
      number,
      x: pixelBox.x / this.canvas.width,
      y: pixelBox.y / this.canvas.height,
      width: pixelBox.width / this.canvas.width,
      height: pixelBox.height / this.canvas.height
    };
  }

  redraw() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.imageCanvas) this.context.drawImage(this.imageCanvas, 0, 0);

    this.boxes.forEach(box => {
      const isActive = box.number === this.activeNumber;
      this.drawBox(ratioToPixelBox(box, this.canvas), isActive ? '#b42318' : '#176c5d', `問${box.number}`);
    });

    if (this.previewBox) {
      const label = this.mode === 'area'
        ? `問${this.areaOptions.start}から自動分割`
        : `問${this.activeNumber}`;
      this.drawBox(this.previewBox, '#365c96', label);
    }
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
