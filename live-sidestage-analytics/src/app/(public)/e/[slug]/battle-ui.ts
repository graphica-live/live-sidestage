// 公開トーナメントページ共通の「バトル興行」シェイプ言語。
//
// シェイプは2種類だけに絞る(混在させない):
// - 大きい入れ物(カード・パネル): 右下の角を斜めに切り落とす(CARD_CLIP)。
//   左右対称に使う箇所(トーナメント表の左ブロックなど)は CARD_CLIP_MIRROR で左下を切る。
// - 小さいタグ・バッジ・見出しラベル: 平行四辺形(-skew-x-12)。中身は逆方向に
//   skew-x-12 して文字を垂直に戻す。
export const CARD_CLIP =
  "[clip-path:polygon(0_0,100%_0,100%_calc(100%-14px),calc(100%-14px)_100%,0_100%)]";
export const CARD_CLIP_MIRROR =
  "[clip-path:polygon(14px_0,100%_0,100%_100%,0_100%,0_14px)]";

export const TAG_SKEW = "-skew-x-12";
export const TAG_UNSKEW = "skew-x-12";
