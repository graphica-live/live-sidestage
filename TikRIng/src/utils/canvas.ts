// クロップとフレーム合成を行うユーティリティ関数
export const EDITOR_CROP_MASK_RADIUS_RATIO = 0.499;
const EDITOR_CROP_MASK_EXPAND_PX = 1;

export function getEditorCropRadiusRatio(previewSize: number, strokePx?: number): number {
  const effectivePreviewSize = Math.max(previewSize, 1);
  const effectiveExpandPx = Math.max(0, strokePx ?? EDITOR_CROP_MASK_EXPAND_PX);
  return Math.min(0.5, EDITOR_CROP_MASK_RADIUS_RATIO + effectiveExpandPx / effectivePreviewSize);
}

export const getCroppedAndMergedImg = async (
  imageSrc: string,
  position: { x: number; y: number },
  zoom: number,
  frameSrc: string,
  previewSize = 600
): Promise<string> => {
  const image = await createImage(imageSrc);
  const frameImage = await createImage(frameSrc);
  const squareFrameCanvas = createSquareFrameCanvas(frameImage);
  const openingMaskCanvas = buildFrameOpeningMaskCanvas(squareFrameCanvas);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  const outputSize = squareFrameCanvas.width;
  canvas.width = outputSize;
  canvas.height = outputSize;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, outputSize, outputSize);

  const scaleRatio = outputSize / Math.max(previewSize, 1);

  const imgW = image.width;
  const imgH = image.height;
  const baseScale = Math.min(outputSize / imgW, outputSize / imgH);
  const finalScale = baseScale * zoom;
  const drawW = imgW * finalScale;
  const drawH = imgH * finalScale;
  const centerX = (outputSize - drawW) / 2;
  const centerY = (outputSize - drawH) / 2;
  const offsetX = position.x * scaleRatio;
  const offsetY = position.y * scaleRatio;

  ctx.drawImage(
    image,
    0,
    0,
    imgW,
    imgH,
    centerX + offsetX,
    centerY + offsetY,
    drawW,
    drawH
  );

  if (openingMaskCanvas) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(openingMaskCanvas, 0, 0, outputSize, outputSize);
    ctx.restore();
  }

  ctx.drawImage(
    squareFrameCanvas,
    0,
    0,
    outputSize,
    outputSize
  );

  return new Promise((resolve, reject) => {
    canvas.toBlob((file) => {
      if (file) {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onloadend = () => {
          resolve(reader.result as string);
        };
      } else {
        reject(new Error('Canvas to blob failed'));
      }
    }, 'image/png');
  });
};

export const getFrameOpeningMaskDataUrl = async (frameSrc: string): Promise<string | null> => {
  const frameImage = await createImage(frameSrc);
  const squareFrameCanvas = createSquareFrameCanvas(frameImage);
  const openingMaskCanvas = buildFrameOpeningMaskCanvas(squareFrameCanvas);

  if (!openingMaskCanvas) {
    return null;
  }

  return openingMaskCanvas.toDataURL('image/png');
};

export const getSquareFrameBlob = async (
  imageSrc: string,
  position: { x: number; y: number },
  zoom: number,
  outputSize = 1024,
  previewSize = outputSize
): Promise<{ blob: Blob; hasTransparentBorder: boolean }> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = outputSize;
  canvas.height = outputSize;

  const imgW = image.width;
  const imgH = image.height;
  const baseScale = Math.min(outputSize / imgW, outputSize / imgH);
  const finalScale = baseScale * zoom;
  const drawW = imgW * finalScale;
  const drawH = imgH * finalScale;
  const centerX = (outputSize - drawW) / 2;
  const centerY = (outputSize - drawH) / 2;
  const scaleRatio = outputSize / Math.max(previewSize, 1);
  const offsetX = position.x * scaleRatio;
  const offsetY = position.y * scaleRatio;

  ctx.clearRect(0, 0, outputSize, outputSize);

  ctx.drawImage(
    image,
    0,
    0,
    imgW,
    imgH,
    centerX + offsetX,
    centerY + offsetY,
    drawW,
    drawH
  );

  const hasTransparentBorder = hasTransparentPixelsOnBorder(ctx, outputSize, 10);

  return new Promise((resolve, reject) => {
    canvas.toBlob((file) => {
      if (file) {
        resolve({ blob: file, hasTransparentBorder });
      } else {
        reject(new Error('Canvas to blob failed'));
      }
    }, 'image/png');
  });
};

export type FrameTransparencyAnalysis = {
  connectedTransparentRatio: number;
  centralOpaqueRatio: number;
  hasCentralSeedTransparency: boolean;
  shouldBlockUpload: boolean;
};

export const analyzeFrameTransparency = async (
  imageSrc: string,
  options?: {
    alphaThreshold?: number;
    centerRadiusRatio?: number;
    seedSearchRadiusRatio?: number;
    minConnectedTransparentRatio?: number;
    maxCentralOpaqueRatio?: number;
  }
): Promise<FrameTransparencyAnalysis> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = image.width;
  canvas.height = image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, image.width, image.height);

  const alphaThreshold = options?.alphaThreshold ?? 10;
  const centerRadiusRatio = options?.centerRadiusRatio ?? 0.22;
  const seedSearchRadiusRatio = options?.seedSearchRadiusRatio ?? 0.35;
  const minConnectedTransparentRatio = options?.minConnectedTransparentRatio ?? 0.18;
  const maxCentralOpaqueRatio = options?.maxCentralOpaqueRatio ?? 0.7;

  const width = canvas.width;
  const height = canvas.height;
  const data = ctx.getImageData(0, 0, width, height).data;
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const radius = Math.max(1, Math.floor(Math.min(width, height) * centerRadiusRatio));
  const radiusSq = radius * radius;
  const seedRadius = Math.max(1, Math.floor(radius * seedSearchRadiusRatio));
  const seedRadiusSq = seedRadius * seedRadius;

  let centralAreaCount = 0;
  let centralOpaqueCount = 0;
  let seedIndex = -1;
  let nearestSeedDistance = Number.POSITIVE_INFINITY;

  const startX = Math.max(0, centerX - radius);
  const endX = Math.min(width - 1, centerX + radius);
  const startY = Math.max(0, centerY - radius);
  const endY = Math.min(height - 1, centerY + radius);

  const isTransparentAt = (pixelIndex: number) => data[pixelIndex * 4 + 3] <= alphaThreshold;

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) {
        continue;
      }

      centralAreaCount += 1;

      const pixelIndex = y * width + x;
      if (!isTransparentAt(pixelIndex)) {
        centralOpaqueCount += 1;
        continue;
      }

      if (distSq <= seedRadiusSq && distSq < nearestSeedDistance) {
        nearestSeedDistance = distSq;
        seedIndex = pixelIndex;
      }
    }
  }

  let connectedTransparentCount = 0;
  if (seedIndex !== -1) {
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(Math.max(centralAreaCount, 1));
    let head = 0;
    let tail = 0;
    queue[tail] = seedIndex;
    tail += 1;
    visited[seedIndex] = 1;

    while (head < tail) {
      const current = queue[head];
      head += 1;
      connectedTransparentCount += 1;

      const x = current % width;
      const y = Math.floor(current / width);

      const tryPush = (nextX: number, nextY: number) => {
        if (nextX < startX || nextX > endX || nextY < startY || nextY > endY) {
          return;
        }

        const dx = nextX - centerX;
        const dy = nextY - centerY;
        if (dx * dx + dy * dy > radiusSq) {
          return;
        }

        const nextIndex = nextY * width + nextX;
        if (visited[nextIndex] === 1 || !isTransparentAt(nextIndex)) {
          return;
        }

        visited[nextIndex] = 1;
        queue[tail] = nextIndex;
        tail += 1;
      };

      tryPush(x - 1, y);
      tryPush(x + 1, y);
      tryPush(x, y - 1);
      tryPush(x, y + 1);
    }
  }

  const connectedTransparentRatio = centralAreaCount > 0 ? connectedTransparentCount / centralAreaCount : 0;
  const centralOpaqueRatio = centralAreaCount > 0 ? centralOpaqueCount / centralAreaCount : 1;
  const hasCentralSeedTransparency = seedIndex !== -1;

  return {
    connectedTransparentRatio,
    centralOpaqueRatio,
    hasCentralSeedTransparency,
    shouldBlockUpload:
      !hasCentralSeedTransparency ||
      connectedTransparentRatio < minConnectedTransparentRatio ||
      centralOpaqueRatio > maxCentralOpaqueRatio,
  };
};

function hasTransparentPixelsOnBorder(
  ctx: CanvasRenderingContext2D,
  size: number,
  alphaThreshold: number
): boolean {
  const { data } = ctx.getImageData(0, 0, size, size);

  const isTransparent = (x: number, y: number) => {
    const idx = (y * size + x) * 4 + 3;
    return data[idx] <= alphaThreshold;
  };

  for (let x = 0; x < size; x += 1) {
    if (isTransparent(x, 0) || isTransparent(x, size - 1)) {
      return true;
    }
  }

  for (let y = 0; y < size; y += 1) {
    if (isTransparent(0, y) || isTransparent(size - 1, y)) {
      return true;
    }
  }

  return false;
}

export const hasTransparentPixelsInCenter = async (
  imageSrc: string,
  alphaThreshold = 10
): Promise<boolean> => {
  const analysis = await analyzeFrameTransparency(imageSrc, {
    alphaThreshold,
    minConnectedTransparentRatio: 0.0001,
    maxCentralOpaqueRatio: 0.9999,
  });
  return analysis.hasCentralSeedTransparency;
};

function getCentralTransparentRegion(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number,
  centerRadiusRatio = 0.22,
  seedSearchRadiusRatio = 0.35
): { mask: Uint8Array; hasSeed: boolean } {
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const radius = Math.max(1, Math.floor(Math.min(width, height) * centerRadiusRatio));
  const radiusSq = radius * radius;
  const seedRadius = Math.max(1, Math.floor(radius * seedSearchRadiusRatio));
  const seedRadiusSq = seedRadius * seedRadius;
  const startX = Math.max(0, centerX - radius);
  const endX = Math.min(width - 1, centerX + radius);
  const startY = Math.max(0, centerY - radius);
  const endY = Math.min(height - 1, centerY + radius);
  const isTransparentAt = (pixelIndex: number) => data[pixelIndex * 4 + 3] <= alphaThreshold;

  let seedIndex = -1;
  let nearestSeedDistance = Number.POSITIVE_INFINITY;

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) {
        continue;
      }

      const pixelIndex = y * width + x;
      if (!isTransparentAt(pixelIndex)) {
        continue;
      }

      if (distSq <= seedRadiusSq && distSq < nearestSeedDistance) {
        nearestSeedDistance = distSq;
        seedIndex = pixelIndex;
      }
    }
  }

  const visited = new Uint8Array(width * height);
  if (seedIndex === -1) {
    return { mask: visited, hasSeed: false };
  }

  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  queue[tail] = seedIndex;
  tail += 1;
  visited[seedIndex] = 1;

  while (head < tail) {
    const current = queue[head];
    head += 1;

    const x = current % width;
    const y = Math.floor(current / width);

    const tryPush = (nextX: number, nextY: number) => {
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
        return;
      }

      const nextIndex = nextY * width + nextX;
      if (visited[nextIndex] === 1 || !isTransparentAt(nextIndex)) {
        return;
      }

      visited[nextIndex] = 1;
      queue[tail] = nextIndex;
      tail += 1;
    };

    tryPush(x - 1, y);
    tryPush(x + 1, y);
    tryPush(x, y - 1);
    tryPush(x, y + 1);
  }

  return { mask: visited, hasSeed: true };
}

export const getTransparentCentroidHint = async (
  imageSrc: string,
  centerRatio = 0.75,
  alphaThreshold = 10,
  sampleStep = 2
): Promise<{ width: number; height: number; point: { x: number; y: number } | null }> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = image.width;
  canvas.height = image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, image.width, image.height);

  const ratio = Math.max(0.2, Math.min(1, centerRatio));
  const regionW = Math.max(1, Math.floor(canvas.width * ratio));
  const regionH = Math.max(1, Math.floor(canvas.height * ratio));
  const startX = Math.floor((canvas.width - regionW) / 2);
  const startY = Math.floor((canvas.height - regionH) / 2);
  const endX = startX + regionW;
  const endY = startY + regionH;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  let sumX = 0;
  let sumY = 0;
  let count = 0;

  const step = Math.max(1, sampleStep);
  for (let y = startY; y < endY; y += step) {
    for (let x = startX; x < endX; x += step) {
      const idx = (y * canvas.width + x) * 4 + 3;
      if (data[idx] <= alphaThreshold) {
        sumX += x;
        sumY += y;
        count += 1;
      }
    }
  }

  if (count === 0) {
    return { width: canvas.width, height: canvas.height, point: null };
  }

  return {
    width: canvas.width,
    height: canvas.height,
    point: {
      x: sumX / count,
      y: sumY / count,
    },
  };
};

export const isTransparentCenterWithinCropMask = async (
  imageSrc: string,
  previewSize: number,
  autoFit: {
    zoom: number;
    position: { x: number; y: number };
  },
  options?: {
    alphaThreshold?: number;
    insetPx?: number;
  }
): Promise<boolean> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = image.width;
  canvas.height = image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, image.width, image.height);

  const alphaThreshold = options?.alphaThreshold ?? 10;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const region = getCentralTransparentRegion(data, canvas.width, canvas.height, alphaThreshold);

  if (!region.hasSeed) {
    return true;
  }

  const effectivePreviewSize = Math.max(previewSize, 1);
  const baseScale = effectivePreviewSize / Math.max(canvas.width, canvas.height, 1);
  const imageCenterX = canvas.width / 2;
  const imageCenterY = canvas.height / 2;
  const cropRadius = effectivePreviewSize * getEditorCropRadiusRatio(effectivePreviewSize);
  const insetPx = Math.max(0, options?.insetPx ?? 2);
  const allowedRadius = Math.max(0, cropRadius - insetPx);

  for (let index = 0; index < region.mask.length; index += 1) {
    if (region.mask[index] !== 1) {
      continue;
    }

    const x = index % canvas.width;
    const y = Math.floor(index / canvas.width);
    const mappedX = effectivePreviewSize / 2
      + (x + 0.5 - imageCenterX) * baseScale * autoFit.zoom
      + autoFit.position.x;
    const mappedY = effectivePreviewSize / 2
      + (y + 0.5 - imageCenterY) * baseScale * autoFit.zoom
      + autoFit.position.y;
    const distanceFromCenter = Math.hypot(
      mappedX - effectivePreviewSize / 2,
      mappedY - effectivePreviewSize / 2
    );

    if (distanceFromCenter > allowedRadius) {
      return false;
    }
  }

  return true;
};

export type CircleAutoFitResult = {
  zoom: number;
  position: { x: number; y: number };
  strategy: 'fill-mask' | 'unsupported-fill' | 'full-image';
};

type SamplePoint = {
  x: number;
  y: number;
};

type FillStyle =
  | { kind: 'transparent' }
  | { kind: 'solid'; r: number; g: number; b: number; a: number };

type OpaqueBorderSample = {
  r: number;
  g: number;
  b: number;
  a: number;
};

const AUTO_FIT_SCORE_EPSILON = 1e-6;

function getPixelOffset(x: number, y: number, width: number): number {
  return (y * width + x) * 4;
}

function getBorderPixels(width: number, height: number): SamplePoint[] {
  const border: SamplePoint[] = [];

  for (let x = 0; x < width; x += 1) {
    border.push({ x, y: 0 });
    if (height > 1) {
      border.push({ x, y: height - 1 });
    }
  }

  for (let y = 1; y < height - 1; y += 1) {
    border.push({ x: 0, y });
    if (width > 1) {
      border.push({ x: width - 1, y });
    }
  }

  return border;
}

function getSolidFillKey(r: number, g: number, b: number, a: number): string {
  const rgbBucket = 16;
  const alphaBucket = 24;
  return [
    Math.round(r / rgbBucket),
    Math.round(g / rgbBucket),
    Math.round(b / rgbBucket),
    Math.round(a / alphaBucket),
  ].join(':');
}

function getOuterFillCandidates(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number
): FillStyle[] {
  const border = getBorderPixels(width, height);
  if (border.length === 0) {
    return [];
  }

  let transparentCount = 0;
  let opaqueCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumA = 0;
  const opaqueSamples: OpaqueBorderSample[] = [];

  for (const point of border) {
    const offset = getPixelOffset(point.x, point.y, width);
    const alpha = data[offset + 3];
    if (alpha <= alphaThreshold) {
      transparentCount += 1;
      continue;
    }

    opaqueCount += 1;
    sumR += data[offset];
    sumG += data[offset + 1];
    sumB += data[offset + 2];
    sumA += alpha;
    opaqueSamples.push({
      r: data[offset],
      g: data[offset + 1],
      b: data[offset + 2],
      a: alpha,
    });
  }

  const candidates: FillStyle[] = [];
  const transparentRatio = transparentCount / border.length;
  const opaqueRatio = opaqueCount / border.length;

  if (transparentRatio >= 0.18) {
    candidates.push({ kind: 'transparent' });
  }

  if (opaqueRatio < 0.72) {
    return candidates;
  }

  const avg = {
    r: sumR / opaqueCount,
    g: sumG / opaqueCount,
    b: sumB / opaqueCount,
    a: sumA / opaqueCount,
  };

  const addSolidCandidate = (solidCandidate: { r: number; g: number; b: number; a: number }) => {
    const exists = candidates.some((candidate) => (
      candidate.kind === 'solid'
      && Math.hypot(candidate.r - solidCandidate.r, candidate.g - solidCandidate.g, candidate.b - solidCandidate.b) <= 10
      && Math.abs(candidate.a - solidCandidate.a) <= 12
    ));

    if (!exists) {
      candidates.push({ kind: 'solid', ...solidCandidate });
    }
  };

  const borderColorGroups = new Map<string, {
    count: number;
    sumR: number;
    sumG: number;
    sumB: number;
    sumA: number;
  }>();

  for (const sample of opaqueSamples) {
    const key = getSolidFillKey(sample.r, sample.g, sample.b, sample.a);
    const group = borderColorGroups.get(key);
    if (group) {
      group.count += 1;
      group.sumR += sample.r;
      group.sumG += sample.g;
      group.sumB += sample.b;
      group.sumA += sample.a;
    } else {
      borderColorGroups.set(key, {
        count: 1,
        sumR: sample.r,
        sumG: sample.g,
        sumB: sample.b,
        sumA: sample.a,
      });
    }
  }

  const dominantGroups = Array.from(borderColorGroups.values())
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);

  if (opaqueCount > 0) {
    addSolidCandidate({
      r: Math.round(avg.r),
      g: Math.round(avg.g),
      b: Math.round(avg.b),
      a: Math.round(avg.a),
    });
  }

  for (const group of dominantGroups) {
    if (group.count / Math.max(opaqueCount, 1) < 0.12) {
      continue;
    }

    addSolidCandidate({
      r: Math.round(group.sumR / group.count),
      g: Math.round(group.sumG / group.count),
      b: Math.round(group.sumB / group.count),
      a: Math.round(group.sumA / group.count),
    });
  }

  return candidates;
}

function matchesFillStyle(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  fillStyle: FillStyle,
  alphaThreshold: number
): boolean {
  const offset = getPixelOffset(x, y, width);
  const alpha = data[offset + 3];

  if (fillStyle.kind === 'transparent') {
    return alpha <= alphaThreshold;
  }

  if (alpha <= alphaThreshold) {
    return false;
  }

  const dr = data[offset] - fillStyle.r;
  const dg = data[offset + 1] - fillStyle.g;
  const db = data[offset + 2] - fillStyle.b;
  const da = alpha - fillStyle.a;
  return Math.hypot(dr, dg, db) <= 28 && Math.abs(da) <= 28;
}

function buildExteriorFillMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  fillStyle: FillStyle,
  alphaThreshold: number
): Uint8Array {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  for (const point of getBorderPixels(width, height)) {
    if (!matchesFillStyle(data, width, point.x, point.y, fillStyle, alphaThreshold)) {
      continue;
    }

    const index = point.y * width + point.x;
    if (visited[index] === 1) {
      continue;
    }

    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  }

  while (head < tail) {
    const current = queue[head];
    head += 1;

    const x = current % width;
    const y = Math.floor(current / width);
    const tryVisit = (nextX: number, nextY: number) => {
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
        return;
      }

      const nextIndex = nextY * width + nextX;
      if (visited[nextIndex] === 1) {
        return;
      }

      if (!matchesFillStyle(data, width, nextX, nextY, fillStyle, alphaThreshold)) {
        return;
      }

      visited[nextIndex] = 1;
      queue[tail] = nextIndex;
      tail += 1;
    };

    tryVisit(x - 1, y);
    tryVisit(x + 1, y);
    tryVisit(x, y - 1);
    tryVisit(x, y + 1);
  }

  return visited;
}

function countMaskPixels(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    count += mask[i];
  }
  return count;
}

function isUsableExteriorMask(exteriorMask: Uint8Array, width: number, height: number): boolean {
  const exteriorPixelCount = countMaskPixels(exteriorMask);
  const totalPixelCount = width * height;

  if (exteriorPixelCount < totalPixelCount * 0.03) {
    return false;
  }

  if (exteriorPixelCount > totalPixelCount * 0.985) {
    return false;
  }

  return true;
}

function computeDistanceFromExterior(exteriorMask: Uint8Array, width: number, height: number): Float32Array {
  const distance = new Float32Array(width * height);
  const inf = 1e9;
  const diagonal = Math.SQRT2;

  for (let i = 0; i < exteriorMask.length; i += 1) {
    distance[i] = exteriorMask[i] === 1 ? 0 : inf;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (distance[index] === 0) {
        continue;
      }

      let best = distance[index];
      if (x > 0) best = Math.min(best, distance[index - 1] + 1);
      if (y > 0) best = Math.min(best, distance[index - width] + 1);
      if (x > 0 && y > 0) best = Math.min(best, distance[index - width - 1] + diagonal);
      if (x < width - 1 && y > 0) best = Math.min(best, distance[index - width + 1] + diagonal);
      distance[index] = best;
    }
  }

  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (distance[index] === 0) {
        continue;
      }

      let best = distance[index];
      if (x < width - 1) best = Math.min(best, distance[index + 1] + 1);
      if (y < height - 1) best = Math.min(best, distance[index + width] + 1);
      if (x < width - 1 && y < height - 1) best = Math.min(best, distance[index + width + 1] + diagonal);
      if (x > 0 && y < height - 1) best = Math.min(best, distance[index + width - 1] + diagonal);
      distance[index] = best;
    }
  }

  return distance;
}

function hasExteriorFillInsideCircle(
  exteriorMask: Uint8Array,
  width: number,
  height: number,
  center: SamplePoint,
  radius: number,
  safetyMargin = 0
): boolean {
  const effectiveRadius = radius + Math.max(0, safetyMargin);
  const radiusSq = effectiveRadius * effectiveRadius;
  const minX = Math.max(0, Math.floor(center.x - effectiveRadius - 1));
  const maxX = Math.min(width - 1, Math.ceil(center.x + effectiveRadius + 1));
  const minY = Math.max(0, Math.floor(center.y - effectiveRadius - 1));
  const maxY = Math.min(height - 1, Math.ceil(center.y + effectiveRadius + 1));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (exteriorMask[y * width + x] !== 1) {
        continue;
      }

      const dx = x + 0.5 - center.x;
      const dy = y + 0.5 - center.y;
      if (dx * dx + dy * dy <= radiusSq) {
        return true;
      }
    }
  }

  return false;
}

export const getCircleAutoFit = async (
  imageSrc: string,
  previewSize: number,
  options?: {
    alphaThreshold?: number;
    targetRadiusRatio?: number;
    analysisMaxSize?: number;
    borderInsetPx?: number;
    safetyMarginPx?: number;
  }
): Promise<CircleAutoFitResult> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  const alphaThreshold = options?.alphaThreshold ?? 10;
  const analysisMaxSize = Math.max(64, Math.floor(options?.analysisMaxSize ?? 256));
  const targetRadiusRatio = options?.targetRadiusRatio ?? getEditorCropRadiusRatio(previewSize);
  const borderInsetPx = Math.max(0, options?.borderInsetPx ?? 0);
  const safetyMarginPx = Math.max(0, options?.safetyMarginPx ?? 5);
  const dominantOriginalSize = Math.max(image.width, image.height);
  const analysisScale = dominantOriginalSize > analysisMaxSize
    ? analysisMaxSize / dominantOriginalSize
    : 1;

  canvas.width = Math.max(1, Math.round(image.width * analysisScale));
  canvas.height = Math.max(1, Math.round(image.height * analysisScale));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const fillCandidates = getOuterFillCandidates(data, width, height, alphaThreshold);
  const dominantAnalysisSize = Math.max(width, height);
  const targetRadiusInAnalysis = dominantAnalysisSize * targetRadiusRatio
    - borderInsetPx * (dominantAnalysisSize / Math.max(previewSize, 1));
  const safetyMarginInAnalysis = safetyMarginPx * (dominantAnalysisSize / Math.max(previewSize, 1));
  const imageCenterX = width / 2;
  const imageCenterY = height / 2;

  for (const fillStyle of fillCandidates) {
    const exteriorMask = buildExteriorFillMask(data, width, height, fillStyle, alphaThreshold);
    if (!isUsableExteriorMask(exteriorMask, width, height)) {
      continue;
    }

    const distance = computeDistanceFromExterior(exteriorMask, width, height);
    let chosenZoom: number | null = null;
    let chosenCenter: SamplePoint | null = null;

    for (let zoom = 0.3; zoom <= 3.001; zoom += 0.01) {
      const normalizedZoom = Math.round(zoom * 1000) / 1000;
      const requiredRadius = targetRadiusInAnalysis / normalizedZoom;
      const strictRequiredRadius = requiredRadius + safetyMarginInAnalysis;

      let bestLocalCenter: SamplePoint | null = null;
      let bestLocalScore = -Infinity;
      let bestLocalTiedCenters: SamplePoint[] = [];

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const availableRadius = distance[y * width + x];
          if (availableRadius < strictRequiredRadius) {
            continue;
          }

          const candidateCenter = { x: x + 0.5, y: y + 0.5 };
          if (hasExteriorFillInsideCircle(
            exteriorMask,
            width,
            height,
            candidateCenter,
            Math.max(0, requiredRadius - 0.5),
            safetyMarginInAnalysis
          )) {
            continue;
          }

          const centerPenalty = Math.hypot(x + 0.5 - imageCenterX, y + 0.5 - imageCenterY);
          const score = availableRadius - centerPenalty * 0.01;
          if (score > bestLocalScore + AUTO_FIT_SCORE_EPSILON) {
            bestLocalScore = score;
            bestLocalCenter = candidateCenter;
            bestLocalTiedCenters = [candidateCenter];
            continue;
          }

          if (Math.abs(score - bestLocalScore) <= AUTO_FIT_SCORE_EPSILON) {
            bestLocalTiedCenters.push(candidateCenter);
          }
        }
      }

      if (bestLocalTiedCenters.length > 1) {
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let sumX = 0;
        let sumY = 0;

        for (const tiedCenter of bestLocalTiedCenters) {
          minX = Math.min(minX, tiedCenter.x);
          maxX = Math.max(maxX, tiedCenter.x);
          minY = Math.min(minY, tiedCenter.y);
          maxY = Math.max(maxY, tiedCenter.y);
          sumX += tiedCenter.x;
          sumY += tiedCenter.y;
        }

        if (maxX - minX <= 1 && maxY - minY <= 1) {
          bestLocalCenter = {
            x: sumX / bestLocalTiedCenters.length,
            y: sumY / bestLocalTiedCenters.length,
          };
        }
      }

      if (bestLocalCenter) {
        chosenZoom = normalizedZoom;
        chosenCenter = bestLocalCenter;
        break;
      }
    }

    if (chosenZoom === null || chosenCenter === null) {
      continue;
    }

    const originalPerAnalysisX = image.width / width;
    const originalPerAnalysisY = image.height / height;
    const focusX = chosenCenter.x * originalPerAnalysisX;
    const focusY = chosenCenter.y * originalPerAnalysisY;
    const baseScale = Math.max(previewSize, 1) / Math.max(image.width, image.height);

    return {
      zoom: chosenZoom,
      position: {
        x: baseScale * chosenZoom * (image.width / 2 - focusX),
        y: baseScale * chosenZoom * (image.height / 2 - focusY),
      },
      strategy: 'fill-mask',
    };
  }

  if (fillCandidates.length === 0) {
    return {
      zoom: 1,
      position: { x: 0, y: 0 },
      strategy: 'unsupported-fill',
    };
  }

  return {
    zoom: 1,
    position: { x: 0, y: 0 },
    strategy: 'unsupported-fill',
  };
};

function createSquareFrameCanvas(frameImage: HTMLImageElement): HTMLCanvasElement {
  const outputSize = Math.min(frameImage.width, frameImage.height);
  const frameCropX = (frameImage.width - outputSize) / 2;
  const frameCropY = (frameImage.height - outputSize) / 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = outputSize;
  canvas.height = outputSize;
  ctx.clearRect(0, 0, outputSize, outputSize);
  ctx.drawImage(
    frameImage,
    frameCropX,
    frameCropY,
    outputSize,
    outputSize,
    0,
    0,
    outputSize,
    outputSize
  );

  return canvas;
}

function buildFrameOpeningMaskCanvas(
  frameCanvas: HTMLCanvasElement,
  options?: {
    coreAlphaThreshold?: number;
    edgeAlphaThreshold?: number;
  }
): HTMLCanvasElement | null {
  const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  const width = frameCanvas.width;
  const height = frameCanvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const maskAlpha = buildFrameOpeningMaskAlpha(imageData.data, width, height, options);

  if (!maskAlpha) {
    return null;
  }

  const maskCanvas = document.createElement('canvas');
  const maskCtx = maskCanvas.getContext('2d');

  if (!maskCtx) {
    throw new Error('Canvas 2D context not available');
  }

  maskCanvas.width = width;
  maskCanvas.height = height;

  const maskImageData = maskCtx.createImageData(width, height);
  for (let i = 0; i < maskAlpha.length; i += 1) {
    const alpha = maskAlpha[i];
    const offset = i * 4;
    maskImageData.data[offset] = 255;
    maskImageData.data[offset + 1] = 255;
    maskImageData.data[offset + 2] = 255;
    maskImageData.data[offset + 3] = alpha;
  }

  maskCtx.putImageData(maskImageData, 0, 0);
  return maskCanvas;
}

function buildFrameOpeningMaskAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    coreAlphaThreshold?: number;
    edgeAlphaThreshold?: number;
  }
): Uint8ClampedArray | null {
  const coreAlphaThreshold = Math.max(0, Math.min(255, options?.coreAlphaThreshold ?? 24));
  const edgeAlphaThreshold = Math.max(coreAlphaThreshold, Math.min(255, options?.edgeAlphaThreshold ?? 250));
  const transparentFillStyle = getOuterFillCandidates(data, width, height, coreAlphaThreshold)
    .find((candidate) => candidate.kind === 'transparent');
  const exteriorMask = transparentFillStyle
    ? buildExteriorFillMask(data, width, height, transparentFillStyle, coreAlphaThreshold)
    : new Uint8Array(width * height);
  const coreRegion = getCentralTransparentRegion(data, width, height, coreAlphaThreshold);

  if (!coreRegion.hasSeed) {
    return null;
  }

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const maskAlpha = new Uint8ClampedArray(width * height);
  let head = 0;
  let tail = 0;
  let visiblePixelCount = 0;

  for (let index = 0; index < coreRegion.mask.length; index += 1) {
    if (coreRegion.mask[index] !== 1 || exteriorMask[index] === 1) {
      continue;
    }

    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  }

  while (head < tail) {
    const current = queue[head];
    head += 1;

    const offset = current * 4;
    const frameAlpha = data[offset + 3];
    if (frameAlpha >= edgeAlphaThreshold || exteriorMask[current] === 1) {
      continue;
    }

    const nextMaskAlpha = Math.max(maskAlpha[current], 255 - frameAlpha);
    if (nextMaskAlpha > maskAlpha[current]) {
      if (maskAlpha[current] === 0) {
        visiblePixelCount += 1;
      }
      maskAlpha[current] = nextMaskAlpha;
    }

    const x = current % width;
    const y = Math.floor(current / width);
    const tryVisit = (nextX: number, nextY: number) => {
      if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
        return;
      }

      const nextIndex = nextY * width + nextX;
      if (visited[nextIndex] === 1 || exteriorMask[nextIndex] === 1) {
        return;
      }

      const nextAlpha = data[nextIndex * 4 + 3];
      if (nextAlpha >= edgeAlphaThreshold) {
        return;
      }

      visited[nextIndex] = 1;
      queue[tail] = nextIndex;
      tail += 1;
    };

    tryVisit(x - 1, y);
    tryVisit(x + 1, y);
    tryVisit(x, y - 1);
    tryVisit(x, y + 1);
  }

  if (visiblePixelCount === 0) {
    return null;
  }

  return maskAlpha;
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));

    if (!url.startsWith('blob:') && !url.startsWith('data:')) {
      image.setAttribute('crossOrigin', 'anonymous');
    }

    image.src = url;
  });
}
