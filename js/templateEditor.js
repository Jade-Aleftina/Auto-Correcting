export class TemplateEditor {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.imageCanvas = null;
    this.boxes = [];
    this.activeNumber = 1;
    this.mode = 'single';
    this.batchOptions = { start: 1, count: 5, direction: 'vertical', gap: 8 };
    this.dragStart = null;
    this.previewBox = null;
    this.questionCount = 20;
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
    this.batchOptions.start = clampNumber(this.batchOptions.start, 1, this.questionCount);
    this.redraw();
  }

  setActiveNumber(number) {
    this.activeNumber = clampNumber(Number(number || 1), 1, this.questionCount);
    this.redraw();
  }

  setMode(mode) {
    this.mode = mode === 'batch' ? 'batch' : 'single';
    this.redraw();
  }

  setBatchOptions(options) {
    this.batchOptions = {
      start: clampNumber(Number(options.start || 1), 1, this.questionCount),
      count: Math.max(1, Number(options.count || 1)),
      direction: options.direction === 'horizontal' ? 'horizontal' : 'vertical',
      gap: Math.max(0, Number(options.gap || 0))
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
      const point = this.getPoint(event);
      this.previewBox = normalizeBox(this.dragStart, point);
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

      const newBoxes = this.mode === 'batch'
        ? this.createBatchBoxes(pixelBox)
        : [this.pixelToRatioBox(pixelBox, this.activeNumber)];
      const replaceNumbers = new Set(newBoxes.map(box => box.number));
      this.boxes = this.boxes.filter(box => !replaceNumbers.has(box.number)).concat(newBoxes);
      this.boxes.sort((a, b) => a.number - b.number);
      if (this.mode === 'single') {
        this.activeNumber = clampNumber(this.activeNumber + 1, 1, this.questionCount);
      }
      this.redraw();
      this.onChange(this.getBoxes());
    });
  }

  createBatchBoxes(pixelBox) {
    const boxes = [];
    const start = this.batchOptions.start;
    const total = Math.min(this.batchOptions.count, this.questionCount - start + 1);
    const stepX = this.batchOptions.direction === 'horizontal' ? pixelBox.width + this.batchOptions.gap : 0;
    const stepY = this.batchOptions.direction === 'vertical' ? pixelBox.height + this.batchOptions.gap : 0;

    for (let index = 0; index < total; index += 1) {
      const number = start + index;
      const nextPixelBox = {
        x: pixelBox.x + stepX * index,
        y: pixelBox.y + stepY * index,
        width: pixelBox.width,
        height: pixelBox.height
      };
      if (nextPixelBox.x + nextPixelBox.width <= this.canvas.width && nextPixelBox.y + nextPixelBox.height <= this.canvas.height) {
        boxes.push(this.pixelToRatioBox(nextPixelBox, number));
      }
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
    if (this.imageCanvas) {
      this.context.drawImage(this.imageCanvas, 0, 0);
    }

    this.boxes.forEach(box => {
      const isActive = box.number === this.activeNumber;
      this.drawBox(ratioToPixelBox(box, this.canvas), isActive ? '#b42318' : '#176c5d', `問${box.number}`);
    });

    if (this.previewBox) {
      const label = this.mode === 'batch'
        ? `問${this.batchOptions.start}〜`
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
    this.context.fillRect(box.x, Math.max(0, box.y - 30), Math.max(58, label.length * 18), 28);
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
