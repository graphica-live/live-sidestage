/**
 * TikTok LIVE スーパーファン判別（@yu_ki_nojo 実測・配信者確認済み）。
 * 正本: ~/.cursor/skills/tiktok-probe/KNOWLEDGE.md「スーパーファン判別 — 確定」
 */

export const PORTRAIT_TAG_SUB_FOR_MO = "ttlive_ls_msgGroups_viewerLabel_subForMo";
export const PORTRAIT_TAG_NOT_SUB = "ttlive_ls_msgGroups_viewerLabel_notSub";

export const SUPER_FAN_BARRAGE_DISPLAY_PREFIX = "ttlive_superFan";

type PortraitTag = { showValue?: string };

function readPortraitTags(data: Record<string, unknown>): string[] {
  const pac = data.publicAreaMessageCommon;
  if (!pac || typeof pac !== "object") return [];
  const portraitInfo = (pac as Record<string, unknown>).portraitInfo;
  if (!portraitInfo || typeof portraitInfo !== "object") return [];
  const tags = (portraitInfo as Record<string, unknown>).portraitTag;
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (t && typeof t === "object" ? (t as PortraitTag).showValue : undefined))
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * chat / gift の平坦化 connector データから SF かどうかを判定する。
 * 確定ロジックに一致しないときは null（フィールドを付けない）。
 */
export function resolveSuperFanStatus(data: Record<string, unknown>): boolean | null {
  const ui = data.userIdentity;
  if (!ui || typeof ui !== "object") return null;
  const subAnchor = (ui as Record<string, unknown>).isSubscriberOfAnchor;
  if (typeof subAnchor !== "boolean") return null;

  const tagValues = readPortraitTags(data);
  const hasSubForMo = tagValues.includes(PORTRAIT_TAG_SUB_FOR_MO);
  const hasNotSub = tagValues.includes(PORTRAIT_TAG_NOT_SUB);

  if (subAnchor === true && hasSubForMo) return true;
  if (subAnchor === false && hasNotSub) return false;
  return null;
}

export function isSuperFanBarrageDisplayType(displayType: unknown): boolean {
  return (
    typeof displayType === "string" &&
    displayType.includes(SUPER_FAN_BARRAGE_DISPLAY_PREFIX)
  );
}

/** WebcastBarrageMessage（superFan イベント）から tiktokUid を取る。 */
export function resolveSuperFanJoinUserId(data: Record<string, unknown>): string | null {
  const schema = data.schema;
  if (typeof schema === "string") {
    const match = schema.match(/user_id=(\d+)/);
    if (match?.[1]) return match[1];
  }
  const raw = data.userId;
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

export function readBarrageDisplayType(data: Record<string, unknown>): string | null {
  const content = data.content;
  if (!content || typeof content !== "object") return null;
  const dt = (content as Record<string, unknown>).displayType;
  return typeof dt === "string" && dt.length > 0 ? dt : null;
}
