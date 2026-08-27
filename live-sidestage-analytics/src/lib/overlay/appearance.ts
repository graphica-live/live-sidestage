// 新規5kind(coin-list/top-gift/tap-list/like-contribution/timer)共通の外観設定。
// contracts.ts と同様にブラウザからも import されるため import ゼロを保つ。

export type OverlayAppearance = {
  fontKey: string;
  textStyleKey: string;
  strokeWidth: number;
};

export const OVERLAY_APPEARANCE_DEFAULT: OverlayAppearance = {
  fontKey: "default",
  textStyleKey: "gold-night",
  strokeWidth: 4,
};

const MAX_STROKE_WIDTH = 20;

/** DB由来/PATCH由来どちらの値も、想定外なら安全なデフォルトへ倒す。 */
export function normalizeOverlayAppearance(value: {
  fontKey: string;
  textStyleKey: string;
  strokeWidth: number;
}): OverlayAppearance {
  return {
    fontKey: typeof value.fontKey === "string" && value.fontKey ? value.fontKey : OVERLAY_APPEARANCE_DEFAULT.fontKey,
    textStyleKey:
      typeof value.textStyleKey === "string" && value.textStyleKey
        ? value.textStyleKey
        : OVERLAY_APPEARANCE_DEFAULT.textStyleKey,
    strokeWidth: Number.isFinite(value.strokeWidth)
      ? Math.min(MAX_STROKE_WIDTH, Math.max(0, Math.round(value.strokeWidth)))
      : OVERLAY_APPEARANCE_DEFAULT.strokeWidth,
  };
}

/** PATCH body から appearance の各フィールドだけを安全に取り出す(存在するものだけ)。 */
export function parseAppearancePatch(body: Record<string, unknown>): Partial<OverlayAppearance> | null {
  const patch: Partial<OverlayAppearance> = {};
  if (body.fontKey !== undefined) {
    if (typeof body.fontKey !== "string" || body.fontKey.length === 0 || body.fontKey.length > 60) return null;
    patch.fontKey = body.fontKey;
  }
  if (body.textStyleKey !== undefined) {
    if (typeof body.textStyleKey !== "string" || body.textStyleKey.length === 0 || body.textStyleKey.length > 60)
      return null;
    patch.textStyleKey = body.textStyleKey;
  }
  if (body.strokeWidth !== undefined) {
    const strokeWidth = Number(body.strokeWidth);
    if (!Number.isInteger(strokeWidth) || strokeWidth < 0 || strokeWidth > MAX_STROKE_WIDTH) return null;
    patch.strokeWidth = strokeWidth;
  }
  return patch;
}
