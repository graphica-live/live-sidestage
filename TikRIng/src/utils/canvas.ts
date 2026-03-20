

// クロップとフレーム合成を行うユーティリティ関数
export const getCroppedAndMergedImg = async (
  imageSrc: string,
  position: { x: number; y: number },
  zoom: number,
  frameSrc: string,
  previewSize = 600
): Promise<string> => {
  const image = await createImage(imageSrc);
  const frameImage = await createImage(frameSrc);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  // 保存結果は必ず正方形で出力する
  const outputSize = Math.min(frameImage.width, frameImage.height);
  canvas.width = outputSize;
  canvas.height = outputSize;
  const frameCropX = (frameImage.width - outputSize) / 2;
  const frameCropY = (frameImage.height - outputSize) / 2;
  const scaleRatio = outputSize / Math.max(previewSize, 1);

  // 1. リスナーの画像の描画
  // 画像の元々の幅と高さ
  const imgW = image.width;
  const imgH = image.height;

  // 表示上の枠に対して「contain」で表示されていた場合の基礎スケール
  // 画像全体が枠に収まるように表示される際のスケール（CSSのobject-fit: contain相当）
  const baseScale = Math.min(outputSize / imgW, outputSize / imgH);

  // 最終的な描画スケール（基礎スケール × ユーザーの指定ズーム）
  const finalScale = baseScale * zoom;

  // 描画先の幅と高さ
  const drawW = imgW * finalScale;
  const drawH = imgH * finalScale;

  // 中央揃えを基準とした座標
  const centerX = (outputSize - drawW) / 2;
  const centerY = (outputSize - drawH) / 2;

  // ユーザーがドラッグした移動量（UI上の移動をキャンバススケールに変換）
  const offsetX = position.x * scaleRatio;
  const offsetY = position.y * scaleRatio;

  // 描画実行
  ctx.drawImage(
    image,
    0, 0, imgW, imgH, // ソース画像全体
    centerX + offsetX, centerY + offsetY, drawW, drawH // キャンバス上の位置とサイズ
  );

  // 2. フレーム画像を上に重ねる（中央正方形で切り出し）
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

  // Base64 (データURL) として出力
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

export const getSquareFrameBlob = async (
  imageSrc: string,
  position: { x: number; y: number },
  zoom: number,
  outputSize = 1024,
  previewSize = outputSize,
  options?: { fillTransparentEdges?: boolean }
): Promise<{ blob: Blob; edgeFilled: boolean; hasTransparentBorder: boolean }> => {
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

  const fillTransparentEdges = options?.fillTransparentEdges ?? true;
  const hasTransparentBorder = hasTransparentPixelsOnBorder(ctx, outputSize, 10);
  const edgeFilled = fillTransparentEdges && hasTransparentBorder
    ? fillTransparentEdgesWithAverageOpaqueColor(ctx, outputSize, 10)
    : false;

  return new Promise((resolve, reject) => {
    canvas.toBlob((file) => {
      if (file) {
        resolve({ blob: file, edgeFilled, hasTransparentBorder });
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
  const minConnectedTransparentRatio = options?.minConnectedTransparentRatio ?? 0.12;
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
      connectedTransparentRatio < minConnectedTransparentRatio &&
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

function fillTransparentEdgesWithAverageOpaqueColor(
  ctx: CanvasRenderingContext2D,
  size: number,
  alphaThreshold: number
): boolean {
  const imageData = ctx.getImageData(0, 0, size, size);
  const { data } = imageData;

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > alphaThreshold) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count += 1;
    }
  }

  if (count === 0) {
    return false;
  }

  const avgR = Math.round(r / count);
  const avgG = Math.round(g / count);
  const avgB = Math.round(b / count);

  const pixelCount = size * size;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const fillTargets: number[] = [];

  const isTransparentAt = (pixelIndex: number) => data[pixelIndex * 4 + 3] <= alphaThreshold;
  const pushIfTransparentUnvisited = (pixelIndex: number) => {
    if (visited[pixelIndex] === 1) return;
    if (!isTransparentAt(pixelIndex)) return;
    visited[pixelIndex] = 1;
    queue[tail] = pixelIndex;
    tail += 1;
  };

  // まず外周の透過ピクセルを起点にする
  for (let x = 0; x < size; x += 1) {
    pushIfTransparentUnvisited(x); // top
    pushIfTransparentUnvisited((size - 1) * size + x); // bottom
  }
  for (let y = 0; y < size; y += 1) {
    pushIfTransparentUnvisited(y * size); // left
    pushIfTransparentUnvisited(y * size + (size - 1)); // right
  }

  while (head < tail) {
    const current = queue[head];
    head += 1;
    fillTargets.push(current);

    const x = current % size;
    const y = Math.floor(current / size);

    if (x > 0) pushIfTransparentUnvisited(current - 1);
    if (x < size - 1) pushIfTransparentUnvisited(current + 1);
    if (y > 0) pushIfTransparentUnvisited(current - size);
    if (y < size - 1) pushIfTransparentUnvisited(current + size);
  }

  if (fillTargets.length === 0) {
    return false;
  }

  for (let i = 0; i < fillTargets.length; i += 1) {
    const idx = fillTargets[i] * 4;
    data[idx] = avgR;
    data[idx + 1] = avgG;
    data[idx + 2] = avgB;
    data[idx + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return true;
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

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));

    // R2等から読み込む際のCORS対策（ただしblobやdata URLでは不要であり、
    // Android Chrome等でCanvasが汚染される（tainted）エラーの原因になるため除外）
    if (!url.startsWith('blob:') && !url.startsWith('data:')) {
      image.setAttribute('crossOrigin', 'anonymous');
    }

    image.src = url;
  });
}
