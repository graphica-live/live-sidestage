

// クロップとフレーム合成を行うユーティリティ関数
export const getCroppedAndMergedImg = async (
  imageSrc: string,
  position: { x: number; y: number },
  zoom: number,
  frameSrc: string
): Promise<string> => {
  const image = await createImage(imageSrc);
  const frameImage = await createImage(frameSrc);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  // 最終的な出力サイズ（フレーム画像のサイズに合わせる）
  canvas.width = frameImage.width;
  canvas.height = frameImage.height;

  // キャンバスの基準スケール（画面上の表示サイズと実際のキャンバスサイズの違いを吸収）
  // ※ ここではブラウザ上のプレビューUIが正方形前提であると仮定し、フレーム幅を基準にする
  // これにより、画面上で例えば x=50px 動かしたときのキャンバス上での実ピクセルを計算する
  const displaySize = Math.min(window.innerWidth, 600); // 簡易的な画面表示サイズ（UI上の最大コンテナ幅程度）
  const scaleRatio = canvas.width / displaySize;

  // 1. リスナーの画像の描画
  // 画像の元々の幅と高さ
  const imgW = image.width;
  const imgH = image.height;

  // 表示上の枠に対して「contain」で表示されていた場合の基礎スケール
  // 画像全体が枠に収まるように表示される際のスケール（CSSのobject-fit: contain相当）
  const baseScale = Math.min(canvas.width / imgW, canvas.height / imgH);

  // 最終的な描画スケール（基礎スケール × ユーザーの指定ズーム）
  const finalScale = baseScale * zoom;

  // 描画先の幅と高さ
  const drawW = imgW * finalScale;
  const drawH = imgH * finalScale;

  // 中央揃えを基準とした座標
  const centerX = (canvas.width - drawW) / 2;
  const centerY = (canvas.height - drawH) / 2;

  // ユーザーがドラッグした移動量（UI上の移動をキャンバススケールに変換）
  const offsetX = position.x * scaleRatio;
  const offsetY = position.y * scaleRatio;

  // 描画実行
  ctx.drawImage(
    image,
    0, 0, imgW, imgH, // ソース画像全体
    centerX + offsetX, centerY + offsetY, drawW, drawH // キャンバス上の位置とサイズ
  );

  // 2. フレーム画像を上に重ねる
  ctx.drawImage(frameImage, 0, 0, canvas.width, canvas.height);

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
