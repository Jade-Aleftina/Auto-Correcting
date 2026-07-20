export function detectAnswerBoxesFromLines(sourceCanvas, options = {}) {
  if (!sourceCanvas?.width || !sourceCanvas?.height) {
    return emptyResult('先に答案画像を読み込んでください。');
  }

  const questionCount = clampNumber(Number(options.count || 20), 1, 200);
  const start = clampNumber(Number(options.start || 1), 1, 200);
  const columns = clampNumber(Number(options.columns || 1), 1, 8);
  const order = options.order === 'row' ? 'row' : 'column';
  const insetRatio = clampNumber(Number(options.insetPercent ?? 10), 0, 35) / 100;
  const searchArea = normalizeSearchArea(options.searchArea, sourceCanvas);
  const sample = createSample(sourceCanvas, 1200, searchArea);
  const binary = createLineBinary(sample.canvas);
  const horizontalLines = findLineSegments(binary, sample.width, sample.height, 'horizontal');
  const verticalLines = findLineSegments(binary, sample.width, sample.height, 'vertical');
  const rectangles = findRectangles(horizontalLines, verticalLines, sample.width, sample.height);
  const candidates = chooseAnswerLikeRectangles(rectangles, questionCount);

  if (!candidates.length) {
    return {
      boxes: [],
      candidateCount: rectangles.length,
      horizontalLineCount: horizontalLines.length,
      verticalLineCount: verticalLines.length,
      message: '枠線を検出できませんでした。明るさ・コントラスト・二値化を調整して再試行してください。'
    };
  }

  const ordered = sortForQuestionNumbers(candidates, columns, order).slice(0, questionCount);
  const boxes = ordered.map((rect, index) => {
    const insetX = Math.min(rect.width * insetRatio, rect.width * 0.42);
    const insetY = Math.min(rect.height * insetRatio, rect.height * 0.42);
    return pixelBoxToRatio({
      x: sample.offsetX + (rect.x + insetX) / sample.scale,
      y: sample.offsetY + (rect.y + insetY) / sample.scale,
      width: Math.max(8, rect.width - insetX * 2) / sample.scale,
      height: Math.max(8, rect.height - insetY * 2) / sample.scale
    }, sourceCanvas, start + index);
  });

  return {
    boxes,
    candidateCount: rectangles.length,
    horizontalLineCount: horizontalLines.length,
    verticalLineCount: verticalLines.length,
    message: `${boxes.length}件の回答欄候補を枠線から検出しました。ずれている問題は「修正」から上書きしてください。`
  };
}

function emptyResult(message) {
  return {
    boxes: [],
    candidateCount: 0,
    horizontalLineCount: 0,
    verticalLineCount: 0,
    message
  };
}

function normalizeSearchArea(searchArea, sourceCanvas) {
  if (!searchArea) {
    return { x: 0, y: 0, width: sourceCanvas.width, height: sourceCanvas.height };
  }

  const x = clampNumber(Number(searchArea.x || 0), 0, 0.98) * sourceCanvas.width;
  const y = clampNumber(Number(searchArea.y || 0), 0, 0.98) * sourceCanvas.height;
  const width = clampNumber(Number(searchArea.width || 1), 0.02, 1) * sourceCanvas.width;
  const height = clampNumber(Number(searchArea.height || 1), 0.02, 1) * sourceCanvas.height;
  const sx = clampNumber(Math.round(x), 0, sourceCanvas.width - 1);
  const sy = clampNumber(Math.round(y), 0, sourceCanvas.height - 1);
  return {
    x: sx,
    y: sy,
    width: Math.max(1, Math.min(sourceCanvas.width - sx, Math.max(24, Math.round(width)))),
    height: Math.max(1, Math.min(sourceCanvas.height - sy, Math.max(24, Math.round(height))))
  };
}

function createSample(sourceCanvas, maxSide, searchArea) {
  const scale = Math.min(1, maxSide / Math.max(searchArea.width, searchArea.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(searchArea.width * scale));
  canvas.height = Math.max(1, Math.round(searchArea.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    sourceCanvas,
    searchArea.x,
    searchArea.y,
    searchArea.width,
    searchArea.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    scale,
    offsetX: searchArea.x,
    offsetY: searchArea.y
  };
}

function createLineBinary(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const grays = new Uint8Array(canvas.width * canvas.height);

  for (let pixel = 0; pixel < grays.length; pixel += 1) {
    const index = pixel * 4;
    grays[pixel] = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
  }

  const threshold = clampNumber(otsuThreshold(grays) + 18, 80, 215);
  const binary = new Uint8Array(canvas.width * canvas.height);
  for (let pixel = 0; pixel < grays.length; pixel += 1) {
    binary[pixel] = grays[pixel] < threshold ? 1 : 0;
  }
  return binary;
}

function findLineSegments(binary, width, height, direction) {
  const isHorizontal = direction === 'horizontal';
  const primaryLimit = isHorizontal ? height : width;
  const secondaryLimit = isHorizontal ? width : height;
  const minLength = Math.max(22, Math.round(secondaryLimit * 0.018));
  const maxGap = Math.max(2, Math.round(secondaryLimit * 0.004));
  const rowSegments = [];

  for (let primary = 0; primary < primaryLimit; primary += 1) {
    let start = -1;
    let lastDark = -1;
    let gap = 0;

    for (let secondary = 0; secondary < secondaryLimit; secondary += 1) {
      const x = isHorizontal ? secondary : primary;
      const y = isHorizontal ? primary : secondary;
      const dark = binary[y * width + x] === 1;

      if (dark) {
        if (start < 0) start = secondary;
        lastDark = secondary;
        gap = 0;
      } else if (start >= 0) {
        gap += 1;
        if (gap > maxGap) {
          pushSegment(rowSegments, direction, primary, start, lastDark, minLength);
          start = -1;
          lastDark = -1;
          gap = 0;
        }
      }
    }

    if (start >= 0) pushSegment(rowSegments, direction, primary, start, lastDark, minLength);
  }

  return mergeNearbySegments(rowSegments, direction);
}

function pushSegment(segments, direction, primary, start, end, minLength) {
  if (end - start + 1 < minLength) return;
  if (direction === 'horizontal') {
    segments.push({ x1: start, x2: end, y1: primary, y2: primary, count: 1 });
  } else {
    segments.push({ x1: primary, x2: primary, y1: start, y2: end, count: 1 });
  }
}

function mergeNearbySegments(segments, direction) {
  const groups = [];
  const isHorizontal = direction === 'horizontal';
  const lineGap = 5;

  segments.sort((a, b) => (isHorizontal ? a.y1 - b.y1 : a.x1 - b.x1));
  segments.forEach(segment => {
    let target = null;
    let bestOverlap = 0;

    groups.forEach(group => {
      const primaryGap = isHorizontal
        ? Math.abs(segment.y1 - group.y2)
        : Math.abs(segment.x1 - group.x2);
      if (primaryGap > lineGap) return;

      const overlap = isHorizontal
        ? overlapLength(segment.x1, segment.x2, group.x1, group.x2)
        : overlapLength(segment.y1, segment.y2, group.y1, group.y2);
      const minLength = isHorizontal
        ? Math.min(segment.x2 - segment.x1, group.x2 - group.x1)
        : Math.min(segment.y2 - segment.y1, group.y2 - group.y1);
      if (overlap < Math.max(8, minLength * 0.45)) return;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        target = group;
      }
    });

    if (!target) {
      groups.push({ ...segment });
      return;
    }

    target.x1 = Math.min(target.x1, segment.x1);
    target.x2 = Math.max(target.x2, segment.x2);
    target.y1 = Math.min(target.y1, segment.y1);
    target.y2 = Math.max(target.y2, segment.y2);
    target.count += 1;
  });

  return groups
    .map(group => ({
      ...group,
      cx: (group.x1 + group.x2) / 2,
      cy: (group.y1 + group.y2) / 2,
      length: isHorizontal ? group.x2 - group.x1 + 1 : group.y2 - group.y1 + 1
    }))
    .filter(group => group.count >= 1);
}

function findRectangles(horizontalLines, verticalLines, width, height) {
  const minW = Math.max(22, width * 0.018);
  const minH = Math.max(16, height * 0.012);
  const maxW = width * 0.55;
  const maxH = height * 0.22;
  const tolerance = Math.max(6, Math.round(Math.min(width, height) * 0.008));
  const rectangles = [];

  const sortedH = horizontalLines.slice().sort((a, b) => a.cy - b.cy);
  for (let topIndex = 0; topIndex < sortedH.length; topIndex += 1) {
    const top = sortedH[topIndex];
    for (let bottomIndex = topIndex + 1; bottomIndex < sortedH.length; bottomIndex += 1) {
      const bottom = sortedH[bottomIndex];
      const rectHeight = bottom.cy - top.cy;
      if (rectHeight < minH) continue;
      if (rectHeight > maxH) break;

      const x1 = Math.max(top.x1, bottom.x1);
      const x2 = Math.min(top.x2, bottom.x2);
      if (x2 - x1 < minW) continue;

      const candidates = verticalLines
        .filter(line => line.cx >= x1 - tolerance && line.cx <= x2 + tolerance)
        .filter(line => line.y1 <= top.cy + tolerance && line.y2 >= bottom.cy - tolerance)
        .sort((a, b) => a.cx - b.cx);

      for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
        const left = candidates[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
          const right = candidates[rightIndex];
          const rectWidth = right.cx - left.cx;
          if (rectWidth < minW) continue;
          if (rectWidth > maxW) break;
          if (!lineCovers(top, left.cx, right.cx, tolerance)) continue;
          if (!lineCovers(bottom, left.cx, right.cx, tolerance)) continue;

          const aspect = rectWidth / rectHeight;
          if (aspect < 0.25 || aspect > 16) continue;

          rectangles.push({
            x: left.cx,
            y: top.cy,
            width: rectWidth,
            height: rectHeight,
            area: rectWidth * rectHeight,
            aspect,
            score: rectangleScore(top, bottom, left, right, rectWidth, rectHeight)
          });
        }
      }
    }
  }

  return dedupeRectangles(rectangles);
}

function lineCovers(line, start, end, tolerance) {
  return line.x1 <= start + tolerance && line.x2 >= end - tolerance;
}

function rectangleScore(top, bottom, left, right, rectWidth, rectHeight) {
  const hCoverage = Math.min(top.length, bottom.length, rectWidth) / Math.max(1, rectWidth);
  const vCoverage = Math.min(left.length, right.length, rectHeight) / Math.max(1, rectHeight);
  const thickness = Math.min(1, (top.count + bottom.count + left.count + right.count) / 8);
  return hCoverage * 0.42 + vCoverage * 0.42 + thickness * 0.16;
}

function dedupeRectangles(rectangles) {
  const sorted = rectangles.slice().sort((a, b) => b.score - a.score);
  const kept = [];
  sorted.forEach(rect => {
    if (kept.some(item => iou(item, rect) > 0.65 || centersClose(item, rect))) return;
    kept.push(rect);
  });
  return kept;
}

function chooseAnswerLikeRectangles(rectangles, questionCount) {
  const candidates = rectangles
    .filter(rect => rect.score >= 0.55)
    .sort((a, b) => a.area - b.area);
  if (candidates.length <= questionCount) return candidates.sort((a, b) => b.score - a.score);

  const clusters = [];
  candidates.forEach(seed => {
    const cluster = candidates.filter(rect => {
      const areaRatio = Math.max(rect.area, seed.area) / Math.max(1, Math.min(rect.area, seed.area));
      const aspectRatio = Math.max(rect.aspect, seed.aspect) / Math.max(0.01, Math.min(rect.aspect, seed.aspect));
      return areaRatio <= 1.8 && aspectRatio <= 2.3;
    });
    clusters.push(cluster);
  });

  const minimum = Math.max(2, Math.min(questionCount, Math.ceil(questionCount * 0.55)));
  const enough = clusters
    .filter(cluster => cluster.length >= minimum)
    .sort((a, b) => {
      const sizeDelta = Math.abs(a.length - questionCount) - Math.abs(b.length - questionCount);
      if (sizeDelta !== 0) return sizeDelta;
      return medianArea(a) - medianArea(b);
    });

  const selected = enough[0] || candidates;
  return selected
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(questionCount, Math.ceil(questionCount * 1.4)));
}

function sortForQuestionNumbers(rectangles, columns, order) {
  const boxes = rectangles.slice();
  if (columns <= 1) return boxes.sort((a, b) => a.y - b.y || a.x - b.x);

  if (order === 'row') {
    const rows = chunkBySortedPosition(boxes, Math.ceil(boxes.length / columns), 'y');
    return rows.flatMap(row => row.sort((a, b) => a.x - b.x));
  }

  const cols = chunkBySortedPosition(boxes, columns, 'x');
  return cols.flatMap(col => col.sort((a, b) => a.y - b.y));
}

function chunkBySortedPosition(items, chunkCount, axis) {
  const sorted = items.slice().sort((a, b) => a[axis] - b[axis]);
  const chunks = Array.from({ length: chunkCount }, () => []);
  sorted.forEach((item, index) => {
    const chunkIndex = Math.min(chunkCount - 1, Math.floor(index * chunkCount / sorted.length));
    chunks[chunkIndex].push(item);
  });
  return chunks;
}

function pixelBoxToRatio(box, canvas, number) {
  const x = clampNumber(box.x / canvas.width, 0, 0.995);
  const y = clampNumber(box.y / canvas.height, 0, 0.995);
  const width = clampNumber(box.width / canvas.width, 0.003, 1 - x);
  const height = clampNumber(box.height / canvas.height, 0.003, 1 - y);
  return { number, x, y, width, height, source: 'line-detector' };
}

function overlapLength(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

function iou(a, b) {
  const intersection = overlapLength(a.x, a.x + a.width, b.x, b.x + b.width) *
    overlapLength(a.y, a.y + a.height, b.y, b.y + b.height);
  const union = a.area + b.area - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function centersClose(a, b) {
  const dx = Math.abs((a.x + a.width / 2) - (b.x + b.width / 2));
  const dy = Math.abs((a.y + a.height / 2) - (b.y + b.height / 2));
  return dx < Math.min(a.width, b.width) * 0.12 && dy < Math.min(a.height, b.height) * 0.12;
}

function medianArea(items) {
  const areas = items.map(item => item.area).sort((a, b) => a - b);
  return areas[Math.floor(areas.length / 2)] || 0;
}

function otsuThreshold(values) {
  const histogram = new Array(256).fill(0);
  values.forEach(value => { histogram[value] += 1; });
  const total = values.length;
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value];

  let sumB = 0;
  let weightB = 0;
  let maxVariance = 0;
  let threshold = 150;
  for (let value = 0; value < 256; value += 1) {
    weightB += histogram[value];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
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

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
