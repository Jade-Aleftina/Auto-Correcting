export class TemplateEditor {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.imageCanvas = null;
    this.boxes = [];
    this.activeNumber = 1;
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
    this.activeNumber = Math.min(this.activeNumber, Number(count || 1));
  }

  setBoxes(boxes) {
    this.boxes = (boxes || []).map(box => ({ ...box }));
    this.redraw();
    this.onChange(this.boxes);
  }

  clear() {
    this.boxes = [];
    this.redraw();
    this.onChange(this.boxes);
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
      const box = this.previewBox;
      this.dragStart = null;
      this.previewBox = null;
      this.canvas.releasePointerCapture(event.pointerId);

      if (box.width < 8 || box.height < 8) {
        this.redraw();
        return;
      }

      const ratioBox = {
        number: this.activeNumber,
        x: box.x / this.canvas.width,
        y: box.y / this.canvas.height,
        width: box.width / this.canvas.width,
        height: box.height / this.canvas.height
      };

      this.boxes = this.boxes.filter(item => item.number !== this.activeNumber).concat(ratioBox);
      this.boxes.sort((a, b) => a.number - b.number);
      this.activeNumber += 1;
      this.redraw();
      this.onChange(this.boxes);
    });
  }

  redraw() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.imageCanvas) {
      this.context.drawImage(this.imageCanvas, 0, 0);
    }

    this.boxes.forEach(box => {
      this.drawBox(ratioToPixelBox(box, this.canvas), '#176c5d', String(box.number));
    });

    if (this.previewBox) {
      this.drawBox(this.previewBox, '#b42318', String(this.activeNumber));
    }
  }

  drawBox(box, color, label) {
    this.context.save();
    this.context.strokeStyle = color;
    this.context.lineWidth = Math.max(3, this.canvas.width / 360);
    this.context.fillStyle = 'rgba(255,255,255,.82)';
    this.context.strokeRect(box.x, box.y, box.width, box.height);
    this.context.fillRect(box.x, Math.max(0, box.y - 28), 46, 26);
    this.context.fillStyle = color;
    this.context.font = `${Math.max(18, this.canvas.width / 40)}px sans-serif`;
    this.context.fillText(label, box.x + 8, Math.max(20, box.y - 8));
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
