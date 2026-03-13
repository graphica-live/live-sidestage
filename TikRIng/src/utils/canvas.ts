

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
  previewSize = outputSize
): Promise<Blob> => {
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

  return new Promise((resolve, reject) => {
    canvas.toBlob((file) => {
      if (file) {
        resolve(file);
      } else {
        reject(new Error('Canvas to blob failed'));
      }
    }, 'image/png');
  });
};

export const hasTransparentPixelsInCenter = async (
  imageSrc: string,
  alphaThreshold = 10
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

  const centerX = Math.floor(canvas.width / 2);
  const centerY = Math.floor(canvas.height / 2);
  const data = ctx.getImageData(centerX, centerY, 1, 1).data;
  return data[3] <= alphaThreshold;
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
