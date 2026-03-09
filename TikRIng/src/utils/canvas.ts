import type { Area } from 'react-easy-crop';

// クロップとフレーム合成を行うユーティリティ関数
export const getCroppedAndMergedImg = async (
  imageSrc: string,
  pixelCrop: Area,
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
  // ※ TikTokのアイコンなどは正方形が基本なので、フレームも正方形を想定
  canvas.width = frameImage.width;
  canvas.height = frameImage.height;

  // 1. リスナーの画像を描画 (クロップとスケーリングを適用)
  // react-easy-cropから渡されるpixelCropは、元画像(image)に対するクロップ領域を示す
  // これを最終的なキャンバスサイズ全体に引き伸ばして描画する
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0, // canvas上のx
    0, // canvas上のy
    canvas.width,
    canvas.height
  );

  // 2. フレーム画像を上に重ねる
  // フレーム画像の透過部分から、先ほど描画したリスナー画像が見える仕組み
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
    }, 'image/png'); // 常にPNGとして出力（アルファチャンネル保持のため）
  });
};

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous'); // R2等から読み込む際のCORS対策
    image.src = url;
  });
}
