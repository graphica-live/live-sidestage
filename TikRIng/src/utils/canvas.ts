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
  previewSize = 600,
  openingMaskSrc?: string | null
): Promise<string> => {
  const image = await createImage(imageSrc);
  const frameImage = await createImage(frameSrc);
  const squareFrameCanvas = createSquareFrameCanvas(frameImage);
  const openingMaskCanvas = openingMaskSrc
    ? await createMaskCanvasFromSource(openingMaskSrc, squareFrameCanvas.width)
    : buildFrameOpeningMaskCanvas(squareFrameCanvas);

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

export const getFrameOpeningGuideDataUrl = async (
  frameSrc: string,
  options?: {
    strokeColor?: { r: number; g: number; b: number; a?: number };
    haloColor?: { r: number; g: number; b: number; a?: number };
    strokeWidth?: number;
  }
): Promise<string | null> => {
  const frameImage = await createImage(frameSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = frameImage.width;
  canvas.height = frameImage.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frameImage, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const maskAlpha = buildFrameOpeningMaskAlpha(imageData.data, canvas.width, canvas.height);

  if (!maskAlpha) {
    return null;
  }

  const guideCanvas = createFrameOpeningGuideCanvas(maskAlpha, canvas.width, canvas.height, options);
  return guideCanvas ? guideCanvas.toDataURL('image/png') : null;
};

export const getSquareFrameBlob = async (
  imageSrc: string,
  position: { x: number; y: number },
  zoom: number,
  outputSize = 1024,
  previewSize = outputSize
): Promise<{ blob: Blob; hasTransparentBorder: boolean }> => {
  const image = await createImage(imageSrc);
  const canvas = renderImageToSquareCanvas(image, position, zoom, outputSize, previewSize);
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  const hasTransparentBorder = hasTransparentPixelsOnBorder(ctx, outputSize, 10);

  const blob = await canvasToBlob(canvas);
  return { blob, hasTransparentBorder };
};

export const getSquareFrameOpeningMaskBlob = async (
  imageSrc: string,
  position: { x: number; y: number },
  zoom: number,
  outputSize = 512,
  previewSize = outputSize
): Promise<Blob | null> => {
  const image = await createImage(imageSrc);
  const squareCanvas = renderImageToSquareCanvas(image, position, zoom, outputSize, previewSize);
  const openingMaskCanvas = buildFrameOpeningMaskCanvas(squareCanvas);

  if (!openingMaskCanvas) {
    return null;
  }

  return canvasToBlob(openingMaskCanvas);
};

export const getSolidOpeningMaskBlob = async (outputSize = 512): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = outputSize;
  canvas.height = outputSize;
  ctx.clearRect(0, 0, outputSize, outputSize);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fillRect(0, 0, outputSize, outputSize);

  return canvasToBlob(canvas);
};

export const getSquareFrameOpeningMaskDataUrl = async (
  imageSrc: string,
  position: { x: number; y: number },
  zoom: number,
  outputSize = 512,
  previewSize = outputSize
): Promise<string | null> => {
  const blob = await getSquareFrameOpeningMaskBlob(imageSrc, position, zoom, outputSize, previewSize);
  if (!blob) {
    return null;
  }

  return blobToDataUrl(blob);
};

export const getSharePreviewBlob = async (
  frameSrc: string,
  outputWidth = 1200,
  outputHeight = 630
): Promise<Blob> => {
  const frameImage = await createImage(frameSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = outputWidth;
  canvas.height = outputHeight;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const gradient = ctx.createLinearGradient(0, 0, outputWidth, outputHeight);
  gradient.addColorStop(0, '#0f172a');
  gradient.addColorStop(0.5, '#111827');
  gradient.addColorStop(1, '#1d4ed8');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(outputWidth * 0.16, outputHeight * 0.22, outputHeight * 0.16, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.arc(outputWidth * 0.84, outputHeight * 0.78, outputHeight * 0.22, 0, Math.PI * 2);
  ctx.fill();

  const cardX = outputWidth * 0.5 - 220;
  const cardY = outputHeight * 0.5 - 220;
  const cardSize = 440;
  const avatarRadius = 136;
  const centerX = cardX + cardSize / 2;
  const centerY = cardY + cardSize / 2;

  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.roundRect(cardX - 18, cardY - 18, cardSize + 36, cardSize + 36, 36);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardSize, cardSize, 28);
  ctx.fill();

  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.arc(centerX, centerY - 26, avatarRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.arc(centerX, centerY - 78, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(centerX, centerY + 68, 116, 88, 0, 0, Math.PI * 2);
  ctx.fill();

  const frameSize = 440;
  ctx.drawImage(frameImage, cardX, cardY, frameSize, frameSize);

  return canvasToBlob(canvas);
};

export const getTikTokLiveCommentAvatarPreviewDataUrl = async (
  frameSrc: string,
  openingMaskSrc?: string | null,
  outputSize = 240
): Promise<string> => {
  const frameImage = await createImage(frameSrc);
  const squareFrameCanvas = createSquareFrameCanvas(frameImage);
  const openingMaskCanvas = openingMaskSrc
    ? await createMaskCanvasFromSource(openingMaskSrc, squareFrameCanvas.width)
    : buildFrameOpeningMaskCanvas(squareFrameCanvas);
  const previewMaskCanvas = openingMaskCanvas
    ? createBinaryMaskCanvas(openingMaskCanvas, outputSize, 200)
    : null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = outputSize;
  canvas.height = outputSize;
  ctx.clearRect(0, 0, outputSize, outputSize);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const center = outputSize / 2;

  const avatarCanvas = document.createElement('canvas');
  avatarCanvas.width = outputSize;
  avatarCanvas.height = outputSize;
  const avatarCtx = avatarCanvas.getContext('2d');

  if (!avatarCtx) {
    throw new Error('Canvas 2D context not available');
  }

  avatarCtx.imageSmoothingEnabled = true;
  avatarCtx.imageSmoothingQuality = 'high';

  avatarCtx.fillStyle = '#00d84a';
  avatarCtx.fillRect(0, 0, outputSize, outputSize);

  avatarCtx.fillStyle = '#D6AF93';
  avatarCtx.beginPath();
  avatarCtx.arc(center, outputSize * 0.42, outputSize * 0.16, 0, Math.PI * 2);
  avatarCtx.fill();

  avatarCtx.fillStyle = '#2B3242';
  avatarCtx.beginPath();
  avatarCtx.arc(center, outputSize * 0.34, outputSize * 0.18, Math.PI, 0, false);
  avatarCtx.arc(center, outputSize * 0.45, outputSize * 0.12, 0, Math.PI, true);
  avatarCtx.closePath();
  avatarCtx.fill();

  avatarCtx.fillStyle = '#F0E6EA';
  avatarCtx.beginPath();
  avatarCtx.roundRect(outputSize * 0.31, outputSize * 0.56, outputSize * 0.38, outputSize * 0.24, outputSize * 0.11);
  avatarCtx.fill();

  avatarCtx.fillStyle = '#D4C3CA';
  avatarCtx.beginPath();
  avatarCtx.roundRect(outputSize * 0.35, outputSize * 0.63, outputSize * 0.3, outputSize * 0.16, outputSize * 0.08);
  avatarCtx.fill();

  if (previewMaskCanvas) {
    avatarCtx.save();
    avatarCtx.globalCompositeOperation = 'destination-in';
    avatarCtx.drawImage(previewMaskCanvas, 0, 0, outputSize, outputSize);
    avatarCtx.restore();
  } else {
    avatarCtx.save();
    avatarCtx.globalCompositeOperation = 'destination-in';
    avatarCtx.beginPath();
    avatarCtx.arc(center, center, outputSize * 0.5, 0, Math.PI * 2);
    avatarCtx.fill();
    avatarCtx.restore();
  }

  ctx.drawImage(avatarCanvas, 0, 0, outputSize, outputSize);

  ctx.drawImage(squareFrameCanvas, 0, 0, outputSize, outputSize);

  return canvas.toDataURL('image/png');
};

export type FrameTransparencyAnalysis = {
  connectedTransparentRatio: number;
  centralOpaqueRatio: number;
  hasCentralSeedTransparency: boolean;
  shouldBlockUpload: boolean;
};

export type FrameBackgroundTransparencySuggestion = {
  blob: Blob;
  fillCoverageRatio: number;
  exteriorPixelRatio: number;
  fillColor: {
    r: number;
    g: number;
    b: number;
    a: number;
  };
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

export const getFrameBackgroundTransparencySuggestion = async (
  imageSrc: string,
  options?: {
    alphaThreshold?: number;
    minFillCoverageRatio?: number;
    minExteriorPixelRatio?: number;
    centerBlockRadiusRatio?: number;
  }
): Promise<FrameBackgroundTransparencySuggestion | null> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = image.width;
  canvas.height = image.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const width = canvas.width;
  const height = canvas.height;
  const alphaThreshold = options?.alphaThreshold ?? 10;
  const minFillCoverageRatio = options?.minFillCoverageRatio ?? 0.58;
  const minExteriorPixelRatio = options?.minExteriorPixelRatio ?? 0.12;
  const centerBlockRadiusRatio = options?.centerBlockRadiusRatio ?? 0.17;
  const { data } = ctx.getImageData(0, 0, width, height);
  const centralTransparentRegion = getCentralTransparentRegion(data, width, height, alphaThreshold);

  if (!centralTransparentRegion.hasSeed) {
    return null;
  }

  const cornerFillCandidate = getUniformCornerFillCandidate(data, width, height, alphaThreshold);
  const borderFillCandidates = getOuterFillCandidates(data, width, height, alphaThreshold)
    .filter((candidate): candidate is Extract<FillStyle, { kind: 'solid' }> => candidate.kind === 'solid');
  const solidFillCandidates = [
    ...(cornerFillCandidate ? [{ fillCandidate: cornerFillCandidate, fromUniformCorners: true }] : []),
    ...borderFillCandidates.map((fillCandidate) => ({ fillCandidate, fromUniformCorners: false })),
  ].filter((entry, index, entries) => {
    return entries.findIndex((candidateEntry) => (
      Math.hypot(
        candidateEntry.fillCandidate.r - entry.fillCandidate.r,
        candidateEntry.fillCandidate.g - entry.fillCandidate.g,
        candidateEntry.fillCandidate.b - entry.fillCandidate.b,
      ) <= 10
      && Math.abs(candidateEntry.fillCandidate.a - entry.fillCandidate.a) <= 12
    )) === index;
  });

  const center = { x: width / 2, y: height / 2 };
  const centerBlockRadius = Math.min(width, height) * centerBlockRadiusRatio;
  const totalPixels = width * height;

  if (cornerFillCandidate) {
    let selectedExteriorMask: Uint8Array | null = null;
    let selectedExteriorPixelCount = 0;
    const toleranceSteps = [12, 18, 24, 32];

    for (const tolerance of toleranceSteps) {
      const nextExteriorMask = buildExteriorFillMask(data, width, height, cornerFillCandidate, alphaThreshold, {
        rgbTolerance: tolerance,
        alphaTolerance: tolerance,
      });
      const nextExteriorPixelCount = countMaskPixels(nextExteriorMask);
      if (
        nextExteriorPixelCount <= 0
        || nextExteriorPixelCount >= totalPixels * 0.97
      ) {
        continue;
      }

      if (nextExteriorPixelCount > selectedExteriorPixelCount) {
        selectedExteriorMask = nextExteriorMask;
        selectedExteriorPixelCount = nextExteriorPixelCount;
      }
    }

    if (selectedExteriorMask && selectedExteriorPixelCount > 0) {
      const resultCanvas = document.createElement('canvas');
      const resultCtx = resultCanvas.getContext('2d');
      if (!resultCtx) {
        throw new Error('Canvas 2D context not available');
      }

      resultCanvas.width = width;
      resultCanvas.height = height;
      const nextImageData = resultCtx.createImageData(width, height);
      nextImageData.data.set(data);

      for (let index = 0; index < selectedExteriorMask.length; index += 1) {
        if (selectedExteriorMask[index] !== 1) {
          continue;
        }

        nextImageData.data[index * 4 + 3] = 0;
      }

      resultCtx.putImageData(nextImageData, 0, 0);

      return {
        blob: await canvasToBlob(resultCanvas),
        fillCoverageRatio: selectedExteriorPixelCount / Math.max(totalPixels, 1),
        exteriorPixelRatio: selectedExteriorPixelCount / Math.max(totalPixels, 1),
        fillColor: {
          r: cornerFillCandidate.r,
          g: cornerFillCandidate.g,
          b: cornerFillCandidate.b,
          a: cornerFillCandidate.a,
        },
      };
    }
  }

  let bestSuggestion: {
    blob: Blob;
    fillCoverageRatio: number;
    exteriorPixelRatio: number;
    fillColor: { r: number; g: number; b: number; a: number };
  } | null = null;

  for (const { fillCandidate, fromUniformCorners } of solidFillCandidates) {
    const exteriorMask = buildExteriorFillMask(data, width, height, fillCandidate, alphaThreshold);
    if (!isUsableExteriorMask(exteriorMask, width, height)) {
      continue;
    }

    if (hasExteriorFillInsideCircle(exteriorMask, width, height, center, centerBlockRadius, 0)) {
      continue;
    }

    let opaqueOutsideCenterCount = 0;
    let coveredOpaqueCount = 0;
    for (let index = 0; index < exteriorMask.length; index += 1) {
      if (centralTransparentRegion.mask[index] === 1) {
        continue;
      }

      const alpha = data[index * 4 + 3];
      if (alpha <= alphaThreshold) {
        continue;
      }

      opaqueOutsideCenterCount += 1;
      if (exteriorMask[index] === 1) {
        coveredOpaqueCount += 1;
      }
    }

    if (opaqueOutsideCenterCount === 0) {
      continue;
    }

    const fillCoverageRatio = coveredOpaqueCount / opaqueOutsideCenterCount;
    const exteriorPixelRatio = countMaskPixels(exteriorMask) / Math.max(totalPixels, 1);
    const requiredFillCoverageRatio = fromUniformCorners ? 0.005 : minFillCoverageRatio;
    const requiredExteriorPixelRatio = fromUniformCorners ? 0.005 : minExteriorPixelRatio;
    if (fillCoverageRatio < requiredFillCoverageRatio || exteriorPixelRatio < requiredExteriorPixelRatio) {
      continue;
    }

    const resultCanvas = document.createElement('canvas');
    const resultCtx = resultCanvas.getContext('2d');
    if (!resultCtx) {
      throw new Error('Canvas 2D context not available');
    }

    resultCanvas.width = width;
    resultCanvas.height = height;
    const nextImageData = resultCtx.createImageData(width, height);
    nextImageData.data.set(data);

    for (let index = 0; index < exteriorMask.length; index += 1) {
      if (exteriorMask[index] !== 1) {
        continue;
      }

      nextImageData.data[index * 4 + 3] = 0;
    }

    resultCtx.putImageData(nextImageData, 0, 0);
    const blob = await canvasToBlob(resultCanvas);

    if (fromUniformCorners) {
      return {
        blob,
        fillCoverageRatio,
        exteriorPixelRatio,
        fillColor: {
          r: fillCandidate.r,
          g: fillCandidate.g,
          b: fillCandidate.b,
          a: fillCandidate.a,
        },
      };
    }

    if (!bestSuggestion || fillCoverageRatio > bestSuggestion.fillCoverageRatio) {
      bestSuggestion = {
        blob,
        fillCoverageRatio,
        exteriorPixelRatio,
        fillColor: {
          r: fillCandidate.r,
          g: fillCandidate.g,
          b: fillCandidate.b,
          a: fillCandidate.a,
        },
      };
    }
  }

  return bestSuggestion;
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

function getUniformCornerFillCandidate(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold: number
): Extract<FillStyle, { kind: 'solid' }> | null {
  if (width <= 0 || height <= 0) {
    return null;
  }

  const cornerPoints = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 },
  ];
  const sampleRadius = Math.min(1, Math.floor((Math.min(width, height) - 1) / 2));
  const rgbTolerance = 18;
  const alphaTolerance = 18;

  const sampleCorner = (corner: { x: number; y: number }) => {
    let sampleCount = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;

    for (let dy = 0; dy <= sampleRadius; dy += 1) {
      for (let dx = 0; dx <= sampleRadius; dx += 1) {
        const sampleX = corner.x === 0 ? dx : corner.x - dx;
        const sampleY = corner.y === 0 ? dy : corner.y - dy;
        const offset = getPixelOffset(sampleX, sampleY, width);
        const alpha = data[offset + 3];
        if (alpha <= alphaThreshold) {
          return null;
        }

        sumR += data[offset];
        sumG += data[offset + 1];
        sumB += data[offset + 2];
        sumA += alpha;
        sampleCount += 1;
      }
    }

    if (sampleCount === 0) {
      return null;
    }

    return {
      r: Math.round(sumR / sampleCount),
      g: Math.round(sumG / sampleCount),
      b: Math.round(sumB / sampleCount),
      a: Math.round(sumA / sampleCount),
    };
  };

  const cornerSamples = cornerPoints.map(sampleCorner);
  if (cornerSamples.some((sample) => sample === null)) {
    return null;
  }

  const reference = cornerSamples[0];
  if (!reference) {
    return null;
  }

  for (let index = 1; index < cornerSamples.length; index += 1) {
    const sample = cornerSamples[index];
    if (!sample) {
      return null;
    }

    if (
      Math.abs(sample.r - reference.r) > rgbTolerance
      || Math.abs(sample.g - reference.g) > rgbTolerance
      || Math.abs(sample.b - reference.b) > rgbTolerance
      || Math.abs(sample.a - reference.a) > alphaTolerance
    ) {
      return null;
    }
  }

  return { kind: 'solid', ...reference };
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
  alphaThreshold: number,
  options?: {
    rgbTolerance?: number;
    alphaTolerance?: number;
  }
): boolean {
  const offset = getPixelOffset(x, y, width);
  const alpha = data[offset + 3];
  const rgbTolerance = Math.max(0, options?.rgbTolerance ?? 28);
  const alphaTolerance = Math.max(0, options?.alphaTolerance ?? 28);

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
  return Math.hypot(dr, dg, db) <= rgbTolerance && Math.abs(da) <= alphaTolerance;
}

function buildExteriorFillMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  fillStyle: FillStyle,
  alphaThreshold: number,
  options?: {
    rgbTolerance?: number;
    alphaTolerance?: number;
  }
): Uint8Array {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  for (const point of getBorderPixels(width, height)) {
    if (!matchesFillStyle(data, width, point.x, point.y, fillStyle, alphaThreshold, options)) {
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

      if (!matchesFillStyle(data, width, nextX, nextY, fillStyle, alphaThreshold, options)) {
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
      let bestLocalVerticalOffset = Number.POSITIVE_INFINITY;
      let bestLocalCenterPenalty = Number.POSITIVE_INFINITY;
      let bestLocalAvailableRadius = -Infinity;
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

          const offsetX = x + 0.5 - imageCenterX;
          const offsetY = y + 0.5 - imageCenterY;
          const verticalOffset = Math.abs(offsetY);
          const centerPenalty = Math.hypot(offsetX, offsetY);

          const isBetterVerticalOffset = verticalOffset < bestLocalVerticalOffset - AUTO_FIT_SCORE_EPSILON;
          const hasSameVerticalOffset = Math.abs(verticalOffset - bestLocalVerticalOffset) <= AUTO_FIT_SCORE_EPSILON;
          const isBetterCenterPenalty = hasSameVerticalOffset
            && centerPenalty < bestLocalCenterPenalty - AUTO_FIT_SCORE_EPSILON;
          const hasSameCenterPenalty = hasSameVerticalOffset
            && Math.abs(centerPenalty - bestLocalCenterPenalty) <= AUTO_FIT_SCORE_EPSILON;
          const isBetterAvailableRadius = hasSameCenterPenalty
            && availableRadius > bestLocalAvailableRadius + AUTO_FIT_SCORE_EPSILON;

          if (isBetterVerticalOffset || isBetterCenterPenalty || isBetterAvailableRadius) {
            bestLocalVerticalOffset = verticalOffset;
            bestLocalCenterPenalty = centerPenalty;
            bestLocalAvailableRadius = availableRadius;
            bestLocalCenter = candidateCenter;
            bestLocalTiedCenters = [candidateCenter];
            continue;
          }

          if (
            hasSameVerticalOffset
            && hasSameCenterPenalty
            && Math.abs(availableRadius - bestLocalAvailableRadius) <= AUTO_FIT_SCORE_EPSILON
          ) {
            bestLocalTiedCenters.push(candidateCenter);
          }
        }
      }

      if (bestLocalTiedCenters.length > 1) {
        let sumX = 0;
        let sumY = 0;

        for (const tiedCenter of bestLocalTiedCenters) {
          sumX += tiedCenter.x;
          sumY += tiedCenter.y;
        }

        const centroidX = sumX / bestLocalTiedCenters.length;
        const centroidY = sumY / bestLocalTiedCenters.length;

        bestLocalCenter = bestLocalTiedCenters.reduce<SamplePoint>((closest, candidate) => {
          const closestDistance = Math.hypot(closest.x - centroidX, closest.y - centroidY);
          const candidateDistance = Math.hypot(candidate.x - centroidX, candidate.y - centroidY);

          if (candidateDistance < closestDistance - AUTO_FIT_SCORE_EPSILON) {
            return candidate;
          }

          if (Math.abs(candidateDistance - closestDistance) <= AUTO_FIT_SCORE_EPSILON) {
            const closestCenterPenalty = Math.hypot(closest.x - imageCenterX, closest.y - imageCenterY);
            const candidateCenterPenalty = Math.hypot(candidate.x - imageCenterX, candidate.y - imageCenterY);
            if (candidateCenterPenalty < closestCenterPenalty) {
              return candidate;
            }
          }

          return closest;
        }, bestLocalTiedCenters[0]);
      } else if (bestLocalTiedCenters.length === 1) {
        bestLocalCenter = bestLocalTiedCenters[0];
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

function renderImageToSquareCanvas(
  image: HTMLImageElement,
  position: { x: number; y: number },
  zoom: number,
  outputSize: number,
  previewSize: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = outputSize;
  canvas.height = outputSize;
  ctx.clearRect(0, 0, outputSize, outputSize);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

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

  return canvas;
}

async function createMaskCanvasFromSource(maskSrc: string, outputSize: number): Promise<HTMLCanvasElement> {
  const maskImage = await createImage(maskSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = outputSize;
  canvas.height = outputSize;
  ctx.clearRect(0, 0, outputSize, outputSize);
  ctx.drawImage(maskImage, 0, 0, outputSize, outputSize);
  return canvas;
}

function createBinaryMaskCanvas(sourceCanvas: HTMLCanvasElement, outputSize: number, alphaThreshold = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = outputSize;
  canvas.height = outputSize;
  ctx.clearRect(0, 0, outputSize, outputSize);
  ctx.drawImage(sourceCanvas, 0, 0, outputSize, outputSize);

  const imageData = ctx.getImageData(0, 0, outputSize, outputSize);
  const data = imageData.data;
  for (let offset = 3; offset < data.length; offset += 4) {
    data[offset] = data[offset] >= alphaThreshold ? 255 : 0;
    data[offset - 3] = 255;
    data[offset - 2] = 255;
    data[offset - 1] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

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

function createFrameOpeningGuideCanvas(
  maskAlpha: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    strokeColor?: { r: number; g: number; b: number; a?: number };
    haloColor?: { r: number; g: number; b: number; a?: number };
    strokeWidth?: number;
  }
): HTMLCanvasElement | null {
  const baseStrokeWidth = options?.strokeWidth ?? Math.max(2, Math.round(Math.min(width, height) / 360));
  const strokeWidth = Math.max(2, Math.floor(baseStrokeWidth));
  const strokeColor = options?.strokeColor ?? { r: 255, g: 84, b: 84, a: 255 };
  const haloColor = options?.haloColor ?? { r: 255, g: 255, b: 255, a: 210 };
  const edgeMask = new Uint8Array(width * height);
  let edgePixelCount = 0;

  const isVisible = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return false;
    }
    return maskAlpha[y * width + x] > 0;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (maskAlpha[index] === 0) {
        continue;
      }

      if (
        !isVisible(x - 1, y)
        || !isVisible(x + 1, y)
        || !isVisible(x, y - 1)
        || !isVisible(x, y + 1)
      ) {
        edgeMask[index] = 1;
        edgePixelCount += 1;
      }
    }
  }

  if (edgePixelCount === 0) {
    return null;
  }

  const expandedMask = dilateBinaryMask(edgeMask, width, height, strokeWidth - 1);
  const haloMask = dilateBinaryMask(edgeMask, width, height, strokeWidth + 1);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  canvas.width = width;
  canvas.height = height;
  const imageData = ctx.createImageData(width, height);

  for (let i = 0; i < haloMask.length; i += 1) {
    const offset = i * 4;

    if (haloMask[i] === 1) {
      imageData.data[offset] = haloColor.r;
      imageData.data[offset + 1] = haloColor.g;
      imageData.data[offset + 2] = haloColor.b;
      imageData.data[offset + 3] = haloColor.a ?? 210;
    }

    if (expandedMask[i] === 1) {
      imageData.data[offset] = strokeColor.r;
      imageData.data[offset + 1] = strokeColor.g;
      imageData.data[offset + 2] = strokeColor.b;
      imageData.data[offset + 3] = strokeColor.a ?? 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function dilateBinaryMask(
  sourceMask: Uint8Array,
  width: number,
  height: number,
  radius: number
): Uint8Array {
  if (radius <= 0) {
    return sourceMask.slice();
  }

  const expandedMask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (sourceMask[y * width + x] !== 1) {
        continue;
      }

      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) {
            continue;
          }

          expandedMask[nextY * width + nextX] = 1;
        }
      }
    }
  }

  return expandedMask;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((file) => {
      if (file) {
        resolve(file);
      } else {
        reject(new Error('Canvas to blob failed'));
      }
    }, 'image/png');
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Blob to data URL failed'));
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
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
