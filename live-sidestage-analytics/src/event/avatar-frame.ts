// 対戦カードのアバター切り出し位置・ズームを表す純粋関数群。
// 表示側(BracketTree.tsx)と編集UI(AvatarFrameEditor.tsx)の両方から使い、
// 「保存した見た目」と「公開カードの見た目」が構造的に一致するようにする。

export const DEFAULT_AVATAR_OFFSET_X = 50;
export const DEFAULT_AVATAR_OFFSET_Y = 30;
export const DEFAULT_AVATAR_ZOOM = 1;
export const AVATAR_ZOOM_MIN = 1;
export const AVATAR_ZOOM_MAX = 3;

export type AvatarFrame = {
  offsetX: number;
  offsetY: number;
  zoom: number;
};

/** DB値(null許容)からデフォルトを解決する。null = 現状のカード固定値と同じ見た目。 */
export function resolveAvatarFrame(
  offsetX: number | null | undefined,
  offsetY: number | null | undefined,
  zoom: number | null | undefined
): AvatarFrame {
  return {
    offsetX: offsetX ?? DEFAULT_AVATAR_OFFSET_X,
    offsetY: offsetY ?? DEFAULT_AVATAR_OFFSET_Y,
    zoom: zoom ?? DEFAULT_AVATAR_ZOOM,
  };
}

export function clampOffset(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function clampZoom(value: number): number {
  return Math.min(AVATAR_ZOOM_MAX, Math.max(AVATAR_ZOOM_MIN, value));
}

/**
 * <img>へ適用するインラインstyle。
 *
 * **transformOrigin を objectPosition と同じ値にすること。** transform-origin の既定値(中央)
 * のままだと、scale はobject-positionが決めた注視点とは無関係に枠の中心を基準に拡大するため、
 * 「その位置を中心にズームする」という直感的な動きにならず、ズーム後にドラッグで
 * 到達できない領域が生まれる(fable-expertレビューで指摘、数式検証済み)。
 */
export function avatarFrameStyle(frame: AvatarFrame): {
  objectPosition: string;
  transformOrigin: string;
  transform?: string;
} {
  const position = `${frame.offsetX}% ${frame.offsetY}%`;
  return {
    objectPosition: position,
    transformOrigin: position,
    transform: frame.zoom !== DEFAULT_AVATAR_ZOOM ? `scale(${frame.zoom})` : undefined,
  };
}

/** object-fit: cover 適用後の画像の実描画サイズ(zoom前)。 */
export function coverDimensions(
  naturalWidth: number,
  naturalHeight: number,
  frameWidth: number,
  frameHeight: number
): { width: number; height: number } {
  if (naturalWidth <= 0 || naturalHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { width: frameWidth, height: frameHeight };
  }
  const scale = Math.max(frameWidth / naturalWidth, frameHeight / naturalHeight);
  return { width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * ドラッグの移動量(スクリーンpx)を object-position の%差分へ変換する。
 *
 * 可視窓の始点は `[(I-F) + F(1-1/z)] * P/100`(P: offset%, I: cover後の画像サイズ,
 * F: 枠サイズ, z: zoom)になる。両辺をPで微分して整理すると、1px動かしたときの
 * P の変化量は `-100 / (z*I - F)` になる(符号はドラッグ方向と逆)。
 *
 * `z*I - F` は「zoomした状態でのはみ出し量」。z=1でI=F(coverでぴったり収まる軸、
 * 例えば正方形画像を正方形枠に入れたときの両軸)だと分母が0になり、
 * **その軸は動かせない**のが正しい(coverの性質上、はみ出しが無ければパンする先が無い)。
 */
export function dragDeltaToOffsetDelta(
  deltaPx: number,
  frameSize: number,
  imageSize: number,
  zoom: number
): number {
  const denom = zoom * imageSize - frameSize;
  if (denom <= 0) return 0;
  return (-deltaPx * 100) / denom;
}
