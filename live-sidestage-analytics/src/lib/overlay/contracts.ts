// オーバーレイが socket / API でやり取りするペイロードの契約。
//
// **このファイルはブラウザ(クライアントコンポーネント)からも import される。**
// import を1つも持たない状態を保つこと。prisma や crypto を引くモジュールをここへ足すと、
// オーバーレイ表示ページや設定画面のバンドルへ Prisma が丸ごと混入する。
// サーバー専用の集計は contribution.server.ts、socket 送信は emit.ts にある。

export const OVERLAY_HEADING_BACKGROUNDS = ["clear", "crystal-blue", "sakura-pink", "black", "white"] as const;
export type OverlayHeadingBackground = (typeof OVERLAY_HEADING_BACKGROUNDS)[number];

export type OverlayContributor = {
  uniqueId: string;
  nickname: string;
  profileImageUrl: string | null;
  totalDiamonds: number;
};

export type OverlaySnapshot = {
  dayKey: string;
  isToday: boolean;
  threshold: number;
  goalCount: number;
  visibleRows: number;
  nameMaxWidth: number;
  align: "left" | "right";
  headingBackground: OverlayHeadingBackground;
  displaySpeed: number;
  qualifiedCount: number;
  contributors: OverlayContributor[];
};

export const OVERLAY_DISPLAY_SPEED_MIN = 1;
export const OVERLAY_DISPLAY_SPEED_MAX = 5;
export const OVERLAY_DISPLAY_SPEED_DEFAULT = 3;

export function clampOverlayDisplaySpeed(value: number): number {
  if (!Number.isFinite(value)) return OVERLAY_DISPLAY_SPEED_DEFAULT;
  return Math.min(OVERLAY_DISPLAY_SPEED_MAX, Math.max(OVERLAY_DISPLAY_SPEED_MIN, Math.round(value)));
}

// DB の列は string なので、読み出したものは必ずここを通して型に落とす。
// 想定外の値(旧仕様の残骸や手作業の書き換え)が入っていても表示が壊れないようにする。
export function normalizeOverlayAlign(value: string): "left" | "right" {
  return value === "right" ? "right" : "left";
}

export function normalizeOverlayHeadingBackground(value: string): OverlayHeadingBackground {
  return OVERLAY_HEADING_BACKGROUNDS.includes(value as OverlayHeadingBackground)
    ? (value as OverlayHeadingBackground)
    : "clear";
}

/**
 * `GET` / `PATCH /api/streamer/overlay-settings` のレスポンス。設定画面がそのまま使う。
 * **設定画面(クライアント)から route.ts の型を import すると prisma と next-auth を
 * 引き込むので、契約はここに置く。**
 */
export type OverlaySettingsPayload = {
  overlayToken: string;
  displayDate: string;
  isToday: boolean;
  threshold: number;
  goalCount: number;
  visibleRows: number;
  nameMaxWidth: number;
  align: "left" | "right";
  headingBackground: OverlayHeadingBackground;
  displaySpeed: number;
};
