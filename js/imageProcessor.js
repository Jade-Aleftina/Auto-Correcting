export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('画像を表示できませんでした。'));
      image.onload = () => resolve(image);
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export function drawImageToCanvas(image, canvas, maxSize = 1800) {
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
}

export function rotateCanvas(source, direction) {
  const temp = document.createElement('canvas');
  temp.width = source.height;
  temp.height = source.width;
  const context = temp.getContext('2d');
  context.translate(temp.width / 2, temp.height / 2);
  context.rotate(direction === 'left' ? -Math.PI / 2 : Math.PI / 2);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  copyCanvas(temp, source);
}

export function applyAdjustments(source, target, settings) {
  target.width = source.width;
  target.height = source.height;
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  const targetContext = target.getContext('2d', { willReadFrequently: true });
  const imageData = sourceContext.getImageData(0, 0, source.width, source.height);
  const data = imageData.data;
  const brightness = Number(settings.brightness || 0);
  const contrast = Number(settings.contrast || 0);
  const threshold = Number(settings.threshold || 0);
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let index = 0; index < data.length; index += 4) {
    let red = clamp(factor * (data[index] - 128) + 128 + brightness);
    let green = clamp(factor * (data[index + 1] - 128) + 128 + brightness);
    let blue = clamp(factor * (data[index + 2] - 128) + 128 + brightness);

    if (threshold > 0) {
      const gray = (red + green + blue) / 3;
      const binary = gray >= threshold ? 255 : 0;
      red = binary;
      green = binary;
      blue = binary;
    }

    data[index] = red;
    data[index + 1] = green;
    data[index + 2] = blue;
  }

  targetContext.putImageData(imageData, 0, 0);
}

export function cropByRatio(source, boxRatio, paddingRatio = 0.12) {
  const x = boxRatio.x * source.width;
  const y = boxRatio.y * source.height;
  const width = boxRatio.width * source.width;
  const height = boxRatio.height * source.height;
  const padding = Math.max(width, height) * paddingRatio;
  const sx = Math.max(0, Math.round(x - padding));
  const sy = Math.max(0, Math.round(y - padding));
  const sw = Math.min(source.width - sx, Math.round(width + padding * 2));
  const sh = Math.min(source.height - sy, Math.round(height + padding * 2));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(80, sw * 3);
  canvas.height = Math.max(80, sh * 3);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function detectBlur(canvas) {
  if (!canvas.width || !canvas.height) return 0;
  const sampleWidth = Math.min(360, canvas.width);
  const sampleHeight = Math.min(360, canvas.height);
  const temp = document.createElement('canvas');
  temp.width = sampleWidth;
  temp.height = sampleHeight;
  const tempContext = temp.getContext('2d', { willReadFrequently: true });
  tempContext.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);
  const data = tempContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
  let total = 0;
  let count = 0;

  for (let y = 1; y < sampleHeight - 1; y += 1) {
    for (let x = 1; x < sampleWidth - 1; x += 1) {
      const center = grayAt(data, sampleWidth, x, y);
      const laplacian =
        -4 * center +
        grayAt(data, sampleWidth, x - 1, y) +
        grayAt(data, sampleWidth, x + 1, y) +
        grayAt(data, sampleWidth, x, y - 1) +
        grayAt(data, sampleWidth, x, y + 1);
      total += laplacian * laplacian;
      count += 1;
    }
  }

  return total / Math.max(1, count);
}

export function copyCanvas(source, target) {
  target.width = source.width;
  target.height = source.height;
  target.getContext('2d').drawImage(source, 0, 0);
}

function grayAt(data, width, x, y) {
  const index = (y * width + x) * 4;
  return (data[index] + data[index + 1] + data[index + 2]) / 3;
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
