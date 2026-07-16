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

export function createOcrVariants(source) {
  return [
    makeOcrVariant(source, '枠線除去', 0, true),
    makeOcrVariant(source, '薄め文字用', 24, true),
    makeOcrVariant(source, '濃い文字用', -22, true),
    makeOcrVariant(source, '枠線除去なし', 0, false)
  ];
}

export function measureInkRatio(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let dark = 0;
  for (let index = 0; index < data.length; index += 4) {
    if ((data[index] + data[index + 1] + data[index + 2]) / 3 < 150) dark += 1;
  }
  return dark / Math.max(1, canvas.width * canvas.height);
}

function makeOcrVariant(source, name, thresholdDelta, removeLines) {
  const binary = createBinaryCanvas(source, thresholdDelta);
  if (removeLines) {
    eraseBorder(binary, 0.055);
    eraseLongLines(binary);
  }
  removeSmallSpecks(binary);
  const normalized = normalizeInkCanvas(binary, 190);
  return {
    name,
    canvas: normalized,
    inkRatio: measureInkRatio(normalized)
  };
}

function createBinaryCanvas(source, thresholdDelta) {
  const maxSide = 260;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(24, Math.round(source.width * scale));
  canvas.height = Math.max(24, Math.round(source.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const grays = [];
  for (let index = 0; index < data.length; index += 4) {
    grays.push(Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114));
  }
  const threshold = clamp(otsuThreshold(grays) + thresholdDelta);
  for (let pixel = 0; pixel < grays.length; pixel += 1) {
    const value = grays[pixel] < threshold ? 0 : 255;
    const index = pixel * 4;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function eraseBorder(canvas, ratio) {
  const context = canvas.getContext('2d');
  const marginX = Math.max(2, Math.round(canvas.width * ratio));
  const marginY = Math.max(2, Math.round(canvas.height * ratio));
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, marginY);
  context.fillRect(0, canvas.height - marginY, canvas.width, marginY);
  context.fillRect(0, 0, marginX, canvas.height);
  context.fillRect(canvas.width - marginX, 0, marginX, canvas.height);
}

function eraseLongLines(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const rowsToErase = [];
  const colsToErase = [];

  for (let y = 0; y < canvas.height; y += 1) {
    let dark = 0;
    for (let x = 0; x < canvas.width; x += 1) {
      if (isDark(data, canvas.width, x, y)) dark += 1;
    }
    if (dark / canvas.width > 0.48) rowsToErase.push(y);
  }

  for (let x = 0; x < canvas.width; x += 1) {
    let dark = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      if (isDark(data, canvas.width, x, y)) dark += 1;
    }
    if (dark / canvas.height > 0.48) colsToErase.push(x);
  }

  rowsToErase.forEach(y => eraseRow(data, canvas.width, canvas.height, y));
  colsToErase.forEach(x => eraseColumn(data, canvas.width, canvas.height, x));
  context.putImageData(imageData, 0, 0);
}

function removeSmallSpecks(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const visited = new Uint8Array(canvas.width * canvas.height);
  const minArea = Math.max(8, Math.round(canvas.width * canvas.height * 0.0012));

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const startIndex = y * canvas.width + x;
      if (visited[startIndex] || !isDark(data, canvas.width, x, y)) continue;
      const pixels = floodFill(data, visited, canvas.width, canvas.height, x, y);
      if (pixels.length < minArea) {
        pixels.forEach(([px, py]) => setWhite(data, canvas.width, px, py));
      }
    }
  }

  context.putImageData(imageData, 0, 0);
}

function normalizeInkCanvas(source, size) {
  const context = source.getContext('2d', { willReadFrequently: true });
  const data = context.getImageData(0, 0, source.width, source.height).data;
  const bounds = findInkBounds(data, source.width, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const target = canvas.getContext('2d');
  target.fillStyle = '#fff';
  target.fillRect(0, 0, size, size);

  if (!bounds) return canvas;

  const sourceWidth = bounds.maxX - bounds.minX + 1;
  const sourceHeight = bounds.maxY - bounds.minY + 1;
  const margin = Math.round(size * 0.18);
  const scale = Math.min((size - margin * 2) / sourceWidth, (size - margin * 2) / sourceHeight);
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const dx = Math.round((size - targetWidth) / 2);
  const dy = Math.round((size - targetHeight) / 2);

  target.imageSmoothingEnabled = false;
  target.drawImage(source, bounds.minX, bounds.minY, sourceWidth, sourceHeight, dx, dy, targetWidth, targetHeight);
  return canvas;
}

function otsuThreshold(grays) {
  const histogram = new Array(256).fill(0);
  grays.forEach(value => { histogram[value] += 1; });
  const total = grays.length;
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];

  let sumB = 0;
  let weightB = 0;
  let maxVariance = 0;
  let threshold = 150;
  for (let value = 0; value < 256; value += 1) {
    weightB += histogram[value];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += value * histogram[value];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = value;
    }
  }
  return threshold;
}

function floodFill(data, visited, width, height, startX, startY) {
  const stack = [[startX, startY]];
  const pixels = [];
  visited[startY * width + startX] = 1;
  while (stack.length) {
    const [x, y] = stack.pop();
    pixels.push([x, y]);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const index = ny * width + nx;
      if (visited[index] || !isDark(data, width, nx, ny)) return;
      visited[index] = 1;
      stack.push([nx, ny]);
    });
  }
  return pixels;
}

function findInkBounds(data, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isDark(data, width, x, y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function isDark(data, width, x, y) {
  return data[(y * width + x) * 4] < 128;
}

function eraseRow(data, width, height, row) {
  for (let y = Math.max(0, row - 1); y <= Math.min(height - 1, row + 1); y += 1) {
    for (let x = 0; x < width; x += 1) setWhite(data, width, x, y);
  }
}

function eraseColumn(data, width, height, col) {
  for (let x = Math.max(0, col - 1); x <= Math.min(width - 1, col + 1); x += 1) {
    for (let y = 0; y < height; y += 1) setWhite(data, width, x, y);
  }
}

function setWhite(data, width, x, y) {
  const index = (y * width + x) * 4;
  data[index] = 255;
  data[index + 1] = 255;
  data[index + 2] = 255;
  data[index + 3] = 255;
}

function grayAt(data, width, x, y) {
  const index = (y * width + x) * 4;
  return (data[index] + data[index + 1] + data[index + 2]) / 3;
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
