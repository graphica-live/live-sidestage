// TikTok の LinkMic バトル(linkMicBattle / linkMicArmies)の payload を解釈する。
// ここは純粋関数だけ。DB 書き込みは tiktok-listener.ts の upsertBattle が行う。
//
// **型定義をそのまま信じない。** tiktok-live-connector は 2.1.1-beta1 で、使用している
// WebcastPushConnection は deprecated。simplifyObject() が common をトップレベルへ展開したり
// battleUsers を足したりと、型定義(tiktok-schema.d.ts)と実際の payload はずれている。
// したがって全フィールドを best-effort で読み、取れなかったものは null にする。
// payload そのもの(raw)は必ず保存するので、後から再解釈できる。

/** BattleAction。tiktok-schema.d.ts の enum に対応する。 */
export const BATTLE_ACTION = {
  UNKNOWN: 0,
  INVITE: 1,
  REJECT: 2,
  CANCEL: 3,
  OPEN: 4,
  FINISH: 5,
  CUT_SHORT: 6,
  ACCEPT: 7,
} as const;

export type BattlePhase = "START" | "END" | "PROGRESS";

export type ParsedBattle = {
  battleId: string;
  /** 最後に観測した BattleAction。armies イベントには action が無いので null */
  action: number | null;
  phase: BattlePhase;
  /** BattleSetting.startTimeMs から取れた開始時刻。取れなければ null */
  startTime: Date | null;
  /** BattleSetting.endTimeMs から取れた終了時刻。取れなければ null */
  endTime: Date | null;
  durationSec: number | null;
  /** anchorIdStr(数値文字列)の一覧 */
  hostUserIds: string[];
  /** anchorInfo[].user.displayId(ハンドル相当・実 payload で未検証) */
  hostDisplayIds: string[];
  /** anchorIdStr -> hostScore。TikTok 側の集計値なので文字列のまま持つ */
  hostScores: Record<string, string>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

/** proto の map は object で来るが、実装によっては配列になりうるので両方受ける。 */
function toEntries(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map(asRecord).filter((v): v is Record<string, unknown> => v !== null);
  }
  const record = asRecord(value);
  if (!record) return [];
  return Object.values(record)
    .map(asRecord)
    .filter((v): v is Record<string, unknown> => v !== null);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** TikTok の時刻はミリ秒の文字列。秒で来る実装もありうるので桁で見分ける。 */
function parseTimeMs(value: unknown): Date | null {
  const raw = nonEmptyString(value);
  if (raw === null) return null;

  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;

  // 10桁台なら秒、13桁台ならミリ秒。2001年以降・2100年以前に収まるものだけ採る。
  const ms = num < 1e11 ? num * 1000 : num;
  if (ms < 1_000_000_000_000 || ms > 4_102_444_800_000) return null;

  return new Date(ms);
}

function parseDuration(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  // 12時間を超えるものは単位の取り違えとみなして捨てる(ミリ秒で来た場合など)。
  if (num > 12 * 60 * 60) return null;
  return Math.round(num);
}

/** battle 側は `battleSetting`(単数)、armies 側は `battleSettings`(複数形)。 */
function findSetting(data: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(data.battleSetting) ?? asRecord(data.battleSettings);
}

/** battle 側は `armies`、armies 側は `battleItems`。中身はどちらも BattleUserArmies。 */
function findArmies(data: Record<string, unknown>): Record<string, unknown>[] {
  const armies = toEntries(data.armies);
  return armies.length > 0 ? armies : toEntries(data.battleItems);
}

function collectHosts(data: Record<string, unknown>) {
  const hostUserIds: string[] = [];
  const hostScores: Record<string, string> = {};

  for (const army of findArmies(data)) {
    const anchorId = nonEmptyString(army.anchorIdStr) ?? nonEmptyString(army.anchorId);
    if (anchorId === null) continue;
    if (!hostUserIds.includes(anchorId)) hostUserIds.push(anchorId);

    const score = nonEmptyString(army.hostScore);
    if (score !== null) hostScores[anchorId] = score;
  }

  const hostDisplayIds: string[] = [];
  for (const info of toEntries(data.anchorInfo)) {
    // simplifyObject が足す battleUsers ではなく、生の anchorInfo を読む。
    // BattleBaseUserInfo には uniqueId が無く displayId しか無いため、
    // これを TikTok ハンドルとして使えるかは実 payload での検証待ち。
    const user = asRecord(info.user) ?? info;
    const displayId = nonEmptyString(user.displayId);
    if (displayId !== null && !hostDisplayIds.includes(displayId)) {
      hostDisplayIds.push(displayId);
    }
    const userId = nonEmptyString(user.userId);
    if (userId !== null && !hostUserIds.includes(userId)) hostUserIds.push(userId);
  }

  return { hostUserIds, hostDisplayIds, hostScores };
}

/**
 * `linkMicBattle` の payload を解釈する。
 *
 * 成立していない招待(INVITE / REJECT / CANCEL など)は null を返す = 保存しない。
 */
export function parseBattleEvent(data: unknown): ParsedBattle | null {
  const record = asRecord(data);
  if (!record) return null;

  const setting = findSetting(record);
  const battleId =
    nonEmptyString(record.battleId) ?? (setting ? nonEmptyString(setting.battleId) : null);
  if (battleId === null) return null;

  const action = Number(record.action);
  if (!Number.isFinite(action)) return null;

  let phase: BattlePhase;
  if (action === BATTLE_ACTION.OPEN) phase = "START";
  else if (action === BATTLE_ACTION.FINISH || action === BATTLE_ACTION.CUT_SHORT) phase = "END";
  else return null; // 招待・辞退・キャンセル等。バトルとして成立していないので記録しない

  return {
    battleId,
    action,
    phase,
    startTime: setting ? parseTimeMs(setting.startTimeMs) : null,
    endTime: setting ? parseTimeMs(setting.endTimeMs) : null,
    durationSec: setting ? parseDuration(setting.duration) : null,
    ...collectHosts(record),
  };
}

/**
 * `linkMicArmies` の payload を解釈する。
 *
 * バトル中のスコア更新なので phase は常に PROGRESS。**配信の途中から接続した場合、
 * OPEN を受け取れないのでこれが最初のイベントになる。** そのためレコードを起こせる
 * だけの情報(battleId と、あれば startTimeMs)を返す。
 */
export function parseArmiesEvent(data: unknown): ParsedBattle | null {
  const record = asRecord(data);
  if (!record) return null;

  const setting = findSetting(record);
  const battleId =
    nonEmptyString(record.battleId) ?? (setting ? nonEmptyString(setting.battleId) : null);
  if (battleId === null) return null;

  return {
    battleId,
    action: null,
    phase: "PROGRESS",
    startTime: setting ? parseTimeMs(setting.startTimeMs) : null,
    endTime: setting ? parseTimeMs(setting.endTimeMs) : null,
    durationSec: setting ? parseDuration(setting.duration) : null,
    ...collectHosts(record),
  };
}

export type BattleRecordState = {
  action: number;
  startedAt: Date;
  startedAtEstimated: boolean;
  endedAt: Date | null;
  durationSec: number | null;
  hostUserIds: string[];
  hostDisplayIds: string[];
  hostScores: Record<string, string>;
};

/**
 * 既存レコード(なければ null)と新しい観測から、保存すべき状態を作る。
 *
 * 同じバトルについてイベントが何度も届くので、**必ず冪等**にする。
 * 情報は増える方向にしか動かさない(取れなかった値で既存を上書きしない)。
 */
export function mergeBattleState(
  existing: BattleRecordState | null,
  parsed: ParsedBattle,
  receivedAt: Date
): BattleRecordState {
  const startTime = parsed.startTime;

  let startedAt: Date;
  let startedAtEstimated: boolean;
  if (existing && !existing.startedAtEstimated) {
    // すでに確かな開始時刻を持っている。受信順の揺れで上書きしない。
    startedAt = existing.startedAt;
    startedAtEstimated = false;
  } else if (startTime) {
    startedAt = startTime;
    startedAtEstimated = false;
  } else if (parsed.phase === "START") {
    // OPEN を受け取った時刻は実質そのままバトルの開始時刻。
    startedAt = receivedAt;
    startedAtEstimated = false;
  } else if (existing) {
    startedAt = existing.startedAt;
    startedAtEstimated = existing.startedAtEstimated;
  } else {
    // 途中接続。いつ始まったかは分からないので気づいた時刻を置く。
    startedAt = receivedAt;
    startedAtEstimated = true;
  }

  let endedAt = existing?.endedAt ?? null;
  if (parsed.phase === "END") {
    // endTimeMs があればそれを、無ければ受信時刻を終了とする。
    endedAt = parsed.endTime ?? receivedAt;
  } else if (!endedAt && parsed.endTime && parsed.endTime <= receivedAt) {
    // 途中接続で FINISH を逃したが、設定値の終了時刻をすでに過ぎている場合。
    endedAt = parsed.endTime;
  }

  const mergeIds = (prev: string[], next: string[]) => {
    const merged = [...prev];
    for (const id of next) if (!merged.includes(id)) merged.push(id);
    return merged;
  };

  // armies は action を持たないので既存を保つ(OPEN を観測済みなら OPEN のまま)。
  // 終了を観測した後に開始のイベントが遅れて届いても、状態を巻き戻さない。
  let action = existing?.action ?? BATTLE_ACTION.UNKNOWN;
  if (parsed.action !== null && !(existing?.endedAt != null && parsed.phase === "START")) {
    action = parsed.action;
  }

  return {
    action,
    startedAt,
    startedAtEstimated,
    endedAt,
    durationSec: parsed.durationSec ?? existing?.durationSec ?? null,
    hostUserIds: mergeIds(existing?.hostUserIds ?? [], parsed.hostUserIds),
    hostDisplayIds: mergeIds(existing?.hostDisplayIds ?? [], parsed.hostDisplayIds),
    // スコアは最新の値で上書きする(増えていくので最後の観測が正しい)。
    hostScores: { ...(existing?.hostScores ?? {}), ...parsed.hostScores },
  };
}
