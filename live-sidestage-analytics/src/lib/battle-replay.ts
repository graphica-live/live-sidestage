// バトル再生ペイロードの構築と再生可否判定。
//
// 既存の貢献者API(`queryBattleContributors`)を拡張せず別エンドポイントにしてある。貢献者は
// モーダルを開くたび必ず走るので、再生ペイロード(数十〜数百KB)を再生しないユーザーに払わせない。
//
// **色はここで決めない。** クライアントが既存の `assignFactionColors` を使い、一覧・詳細と
// 完全に一致させる(サーバーが色を返すと2箇所で定義が割れる)。

import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { resolveAvatarUrls } from "./avatar-storage";
import {
  BATTLE_REPLAY_VERSION,
  MAX_REPLAY_EVENTS,
  MAX_REPLAY_WINDOW_MS,
  MIN_REPLAY_SCORE_POINTS,
  MIN_REPLAY_WINDOW_MS,
  type BattleReplayPayload,
  type ReplayAvailability,
  type ReplayEligibility,
  type ReplayGift,
  type ReplayGiftEvent,
  type ReplayParticipant,
  type ReplayScorePoint,
  type ReplaySegment,
  type ReplaySender,
  type ReplayTeam,
} from "./battle-replay-contract";

/** 私的(配信者本人・admin)か公開(シェアリンク)か。**公開は TikTokハンドルを一切載せない。** */
export type ReplayVariant = "private" | "public";

/**
 * 再生できるか。**判定はこの1箇所だけに置く。** 条件は今後変わるので、DBに `replayReady` のような
 * 真偽列は持たせず、件数と窓から毎回導出する。
 */
export function isReplayable(input: ReplayEligibility): ReplayAvailability {
  if (!input.finalized) return { available: false, reason: "not_finalized" };
  if (input.scorePointCount < MIN_REPLAY_SCORE_POINTS) return { available: false, reason: "no_score_points" };
  if (input.windowStart === null || input.windowEnd === null) return { available: false, reason: "window_invalid" };
  const windowMs = input.windowEnd.getTime() - input.windowStart.getTime();
  if (windowMs < MIN_REPLAY_WINDOW_MS || windowMs > MAX_REPLAY_WINDOW_MS) {
    return { available: false, reason: "window_invalid" };
  }
  if (input.participantCount < 2 || !input.hasSelfParticipant) {
    return { available: false, reason: "participants_invalid" };
  }
  return { available: true, reason: null };
}

/** `Streamer.overlayToken` と同じ 192bit。cuid 等の推測可能な識別子は使わない。 */
function generateShareToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * シェアトークンを遅延発行する。**未発行のときだけ書く**ので、2タブ同時押下でも1本に収まる
 * (`ensureOverlayToken` と同じ形)。対象が無ければ null。
 */
export async function ensureShareToken(roomId: string, battleId: string): Promise<string | null> {
  const existing = await prisma.battleHistory.findUnique({
    where: { roomId_battleId: { roomId, battleId } },
    select: { id: true, shareToken: true },
  });
  if (existing === null) return null;
  if (existing.shareToken !== null) return existing.shareToken;

  await prisma.battleHistory.updateMany({
    where: { id: existing.id, shareToken: null },
    data: { shareToken: generateShareToken(), shareTokenIssuedAt: new Date() },
  });
  const reread = await prisma.battleHistory.findUnique({
    where: { id: existing.id },
    select: { shareToken: true },
  });
  return reread?.shareToken ?? null;
}

const REPLAY_SELECT = {
  // `as const` を付けない。readonly な orderBy 配列は Prisma の入力型(mutable)へ代入できない。
  id: true,
  battleId: true,
  status: true,
  windowStart: true,
  windowEnd: true,
  replayScorePointCount: true,
  openingMultiplier: true,
  openingMultiplierConfidence: true,
  openingWindowStartedAt: true,
  openingWindowEndedAt: true,
  participants: {
    select: {
      id: true,
      tiktokUid: true,
      teamIndex: true,
      position: true,
      side: true,
      isSelf: true,
      tiktokHandleSnapshot: true,
      nicknameSnapshot: true,
      score: true,
      officialScore: true,
      battleTeamId: true,
      giftEvents: {
        select: {
          senderTiktokUid: true,
          senderTiktokHandleSnapshot: true,
          senderNicknameSnapshot: true,
          repeatCount: true,
          totalDiamonds: true,
          occurredAt: true,
          giftId: true,
          giftNameSnapshot: true,
          senderGroupId: true,
          multiplierValue: true,
        },
        orderBy: [{ occurredAt: "asc" }, { sourceGiftId: "asc" }],
      },
    },
    orderBy: [{ teamIndex: "asc" }, { position: "asc" }],
  },
  scorePoints: {
    select: { tiktokUid: true, offsetMs: true, score: true },
    orderBy: [{ offsetMs: "asc" }, { tiktokUid: "asc" }],
  },
  bonusMissions: {
    select: {
      rewardMultiple: true,
      startedAt: true,
      rewardStartedAt: true,
      rewardEndedAt: true,
    },
  },
  // 陣営の公式スコアの正本。**participant の officialScore はメンバー個人の値**なので、
  // 多人数陣営でそれを陣営スコアとして出すと合計と食い違う。
  teams: { select: { id: true, officialScore: true } },
} satisfies Prisma.BattleHistorySelect;

/** 読み出す行の形。`REPLAY_SELECT` と対で、テストが DB 無しで組み立てられるよう export する。 */
export type ReplayRow = {
  id: string;
  battleId: string;
  status: string;
  windowStart: Date;
  windowEnd: Date;
  replayScorePointCount: number;
  openingMultiplier: number | null;
  openingMultiplierConfidence: string | null;
  openingWindowStartedAt: Date | null;
  openingWindowEndedAt: Date | null;
  participants: {
    id: string;
    tiktokUid: string;
    teamIndex: number;
    position: number;
    side: string;
    /** 確定処理が解決できなかった古い行では null。判定は `=== true` で行う。 */
    isSelf: boolean | null;
    tiktokHandleSnapshot: string | null;
    nicknameSnapshot: string | null;
    score: string | null;
    officialScore: string | null;
    battleTeamId: string | null;
    giftEvents: {
      senderTiktokUid: string;
      senderTiktokHandleSnapshot: string | null;
      senderNicknameSnapshot: string | null;
      repeatCount: number;
      totalDiamonds: number;
      occurredAt: Date;
      giftId: number;
      giftNameSnapshot: string;
      senderGroupId: string | null;
      multiplierValue: number | null;
    }[];
  }[];
  scorePoints: { tiktokUid: string; offsetMs: number; score: string }[];
  bonusMissions: {
    rewardMultiple: number;
    startedAt: Date;
    rewardStartedAt: Date | null;
    rewardEndedAt: Date | null;
  }[];
  teams: { id: string; officialScore: string | null }[];
};

/** 公開バリアントで名前が取れなかったときの表示。TikTokハンドルへは決して落とさない。 */
const ANONYMOUS_DISPLAY_NAME = "配信者";

/**
 * **公開バリアントは `nicknameSnapshot` だけを使う。** `tiktokHandleSnapshot` は TikTokハンドルなので、
 * 名前が無いからといってフォールバックすると公開リンクからハンドルが漏れる
 * (`hostProfiles` に anchor が無い確定行では nickname が null になりうる)。
 */
function displayNameOf(p: ReplayRow["participants"][number], variant: ReplayVariant): string {
  if (variant === "public") return p.nicknameSnapshot ?? ANONYMOUS_DISPLAY_NAME;
  return (
    p.nicknameSnapshot ??
    (p.tiktokHandleSnapshot ? `@${p.tiktokHandleSnapshot}` : null) ??
    ANONYMOUS_DISPLAY_NAME
  );
}


/**
 * 件数列ではなく**実際に読めたスコア点の数**で判定する。ネストした select は1トランザクションに
 * まとまらないため、再確定(`commitBattleSnapshot` のスコア点 deleteMany→createMany)と読みが
 * 交差すると、親行の件数が非0のまま子行が空で返りうる。
 */
function eligibilityOf(row: ReplayRow): ReplayEligibility {
  return {
    finalized: true,
    scorePointCount: Math.min(row.replayScorePointCount, row.scorePoints.length),
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    participantCount: row.participants.length,
    hasSelfParticipant: row.participants.some((p) => p.teamIndex === 0),
  };
}

/** ギフトの表示名は `labelJa` を優先し、無ければ確定時のスナップショット名へ落とす。 */
async function loadGiftCatalog(giftIds: number[]): Promise<Map<number, { labelJa: string | null; imageUrl: string | null }>> {
  if (giftIds.length === 0) return new Map();
  const rows = await prisma.tiktokGiftCatalog.findMany({
    where: { giftId: { in: giftIds } },
    select: { giftId: true, labelJa: true, imageUrl: true },
  });
  return new Map(rows.map((r) => [r.giftId, { labelJa: r.labelJa, imageUrl: r.imageUrl }]));
}

function buildSegments(row: ReplayRow): ReplaySegment[] {
  const segments: ReplaySegment[] = [];
  const windowStartMs = row.windowStart.getTime();
  const windowLengthMs = row.windowEnd.getTime() - windowStartMs;
  const clamp = (at: Date): number => Math.min(windowLengthMs, Math.max(0, at.getTime() - windowStartMs));

  // 初ギフトx倍。**区間の開始・終了が実測できたときだけ帯にする。**
  // 逆算の候補窓(60秒)は未確定の仮定値なので、そこから区間を作って画面に見せてはいけない。
  const confidence = row.openingMultiplierConfidence;
  if (
    (confidence === "measured" || confidence === "inferred") &&
    row.openingMultiplier !== null &&
    row.openingWindowStartedAt !== null &&
    row.openingWindowEndedAt !== null
  ) {
    segments.push({
      kind: "opening",
      startMs: clamp(row.openingWindowStartedAt),
      endMs: clamp(row.openingWindowEndedAt),
      multiplier: row.openingMultiplier,
      label: `初めてのギフト×${row.openingMultiplier}倍`,
      // 実測できた区間なのでカウントダウンしてよい。
      showCountdown: true,
      confidence,
    });
  }

  for (const mission of row.bonusMissions) {
    if (mission.rewardStartedAt === null || mission.rewardEndedAt === null) continue;
    segments.push({
      kind: "bonus_reward",
      startMs: clamp(mission.rewardStartedAt),
      endMs: clamp(mission.rewardEndedAt),
      multiplier: mission.rewardMultiple,
      label: `ボーナス×${mission.rewardMultiple}倍`,
      // `rewardEndedAt` は TikTok が配信してくる実測値なので残り秒数を出してよい。
      // opening と重なった区間は `segmentAt` が opening を優先するので帯は競合しない。
      showCountdown: true,
    });
  }

  return segments.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/**
 * 陣営の公式スコア。`BattleTeam.officialScore` が正本で、`battleTeamId` が未設定の旧データだけ
 * メンバー個人のスコア合計へ落ちる。**メンバー1人分をそのまま陣営スコアにしない**
 * (多人数陣営で合計と食い違う)。
 */
function teamScoreOf(
  members: ReplayRow["participants"],
  teamScoreById: Map<string, string | null>
): string | null {
  for (const member of members) {
    if (member.battleTeamId === null) continue;
    const score = teamScoreById.get(member.battleTeamId);
    if (score !== undefined && score !== null) return score;
  }
  let total: bigint | null = null;
  for (const member of members) {
    const score = member.officialScore ?? member.score;
    // 数字以外が入っていたら黙って飛ばす。`BigInt()` は throw するので、1行の異常データで
    // そのバトルが恒久的に 500 になる。
    if (score === null || !/^\d+$/.test(score)) continue;
    total = (total ?? 0n) + BigInt(score);
  }
  return total === null ? null : total.toString();
}

/** 辞書化・添字付け・truncate の本体。DBを引かない純関数なので unit テストで固定する。 */
export function buildPayload(
  row: ReplayRow,
  variant: ReplayVariant,
  anchorAvatarUrls: Map<string, string>,
  senderAvatarUrls: Map<string, string>,
  giftCatalog: Map<number, { labelJa: string | null; imageUrl: string | null }>
): BattleReplayPayload {
  const windowStartMs = row.windowStart.getTime();
  const windowLengthMs = row.windowEnd.getTime() - windowStartMs;
  const isPublic = variant === "public";

  const teamScoreById = new Map(row.teams.map((t) => [t.id, t.officialScore]));

  const teamIndexes = [...new Set(row.participants.map((p) => p.teamIndex))].sort((a, b) => a - b);
  const teams: ReplayTeam[] = teamIndexes.map((teamIndex) => {
    // **本人(isSelf)を陣営の先頭へ寄せる。** DB の position は TikTok が配信してくる並びで、
    // 自陣コラボでは本人が position 1 以降に来ることがある(実バトルで確認)。ステージは
    // participants の順にマス目を埋めるので、そのままだと本人が左上に出ない。
    const members = [...row.participants.filter((p) => p.teamIndex === teamIndex)].sort(
      (a, b) => Number(b.isSelf === true) - Number(a.isSelf === true) || a.position - b.position
    );
    const participants: ReplayParticipant[] = members.map((p) => ({
      tiktokUid: p.tiktokUid,
      isSelf: p.isSelf === true,
      displayName: displayNameOf(p, variant),
      // **公開バリアントではハンドルを落とす。** 個人のプロフィールへ直リンクできるため。
      tiktokHandle: isPublic ? null : p.tiktokHandleSnapshot,
      avatarUrl: anchorAvatarUrls.get(p.tiktokUid) ?? null,
    }));
    return {
      index: teamIndex,
      isSelf: teamIndex === 0,
      officialScore: teamScoreOf(members, teamScoreById),
      participants,
    };
  });

  // 添字の正本。scorePoints / giftEvents はこの配列の位置で anchor を指す。
  const anchors = teams.flatMap((t) => t.participants.map((p) => p.tiktokUid));
  const anchorIndex = new Map(anchors.map((a, i) => [a, i]));

  const scorePoints: ReplayScorePoint[] = [];
  for (const point of row.scorePoints) {
    const index = anchorIndex.get(point.tiktokUid);
    // participant として確定していない tiktokUid は確定時に捨てているが、
    // 後から participants だけが作り直された場合に備えて読み出し側でも落とす。
    if (index === undefined) continue;
    scorePoints.push({ t: point.offsetMs, a: index, s: point.score });
  }

  // 辞書は truncate を確定させてから作る。先に作ると、落としたイベントからしか参照されない
  // 送信者・ギフトが辞書に残り、公開ペイロードに余計なリスナー情報が載る。
  type RawEvent = {
    t: number;
    a: number;
    sender: string;
    giftId: number;
    c: number;
    d: number;
    group: string | null;
    m: number | null;
  };
  const rawEvents: RawEvent[] = [];

  for (const participant of row.participants) {
    const anchorPos = anchorIndex.get(participant.tiktokUid);
    if (anchorPos === undefined) continue;
    for (const event of participant.giftEvents) {
      rawEvents.push({
        t: Math.min(windowLengthMs, Math.max(0, event.occurredAt.getTime() - windowStartMs)),
        a: anchorPos,
        sender: event.senderTiktokUid,
        giftId: event.giftId,
        c: event.repeatCount,
        d: event.totalDiamonds,
        group: event.senderGroupId,
        m: event.multiplierValue,
      });
    }
  }

  rawEvents.sort((a, b) => a.t - b.t || a.a - b.a || (a.sender < b.sender ? -1 : a.sender > b.sender ? 1 : 0));
  const truncated = rawEvents.length > MAX_REPLAY_EVENTS;
  // 上限を超えたら**時系列の先頭から**残す(バトル序盤が欠けると再生の意味が薄いため)。
  const keptEvents = truncated ? rawEvents.slice(0, MAX_REPLAY_EVENTS) : rawEvents;

  const nicknameBySender = new Map<string, string | null>();
  const handleBySender = new Map<string, string | null>();
  const giftNameById = new Map<number, string>();
  for (const participant of row.participants) {
    for (const event of participant.giftEvents) {
      if (!nicknameBySender.has(event.senderTiktokUid)) {
        nicknameBySender.set(event.senderTiktokUid, event.senderNicknameSnapshot);
        handleBySender.set(event.senderTiktokUid, event.senderTiktokHandleSnapshot);
      }
      if (!giftNameById.has(event.giftId)) giftNameById.set(event.giftId, event.giftNameSnapshot);
    }
  }

  // コンボの段を束ねる添字。groupId をそのまま載せるとリスナー横断で衝突しうるうえ、
  // **"0" が本番に3591件流入していて combo か単発か判定できない**(schema の Gift.giftType
  // コメント参照)ので、"0" は鍵として使わず単発扱いにする。
  const comboIndex = new Map<string, number>();
  const comboKeyOf = (event: RawEvent): number | null => {
    if (!event.group || event.group === "0") return null;
    const key = `${event.a}|${event.sender}|${event.giftId}|${event.group}`;
    let pos = comboIndex.get(key);
    if (pos === undefined) {
      pos = comboIndex.size;
      comboIndex.set(key, pos);
    }
    return pos;
  };

  const senderIndex = new Map<string, number>();
  const senders: ReplaySender[] = [];
  const giftIndex = new Map<number, number>();
  const gifts: ReplayGift[] = [];
  const giftEvents: ReplayGiftEvent[] = keptEvents.map((event) => {
    let senderPos = senderIndex.get(event.sender);
    if (senderPos === undefined) {
      senderPos = senders.length;
      senderIndex.set(event.sender, senderPos);
      senders.push({
        uid: event.sender,
        // **公開バリアントではハンドルを落とす**(リスナー個人のプロフィールへ直リンクできるため)。
        u: isPublic ? null : handleBySender.get(event.sender) ?? null,
        n: nicknameBySender.get(event.sender) ?? "",
        // アバターは公開でも出す(2026-09-08、配信者の明示判断で解禁)。
        a: senderAvatarUrls.get(event.sender) ?? null,
      });
    }

    // カタログは giftId で引く。**名前で引かない** — 実測で670件中29の名前が複数 giftId を持つ。
    let giftPos = giftIndex.get(event.giftId);
    if (giftPos === undefined) {
      giftPos = gifts.length;
      giftIndex.set(event.giftId, giftPos);
      const catalog = giftCatalog.get(event.giftId);
      gifts.push({
        id: event.giftId,
        // 日本語名は表示専用。一致判定には使わない(LIVEのgiftイベント名は英語固定)。
        n: catalog?.labelJa ?? giftNameById.get(event.giftId) ?? "",
        img: catalog?.imageUrl ?? null,
      });
    }

    return {
      t: event.t,
      a: event.a,
      s: senderPos,
      g: giftPos,
      c: event.c,
      d: event.d,
      k: comboKeyOf(event),
      m: event.m,
    };
  });

  const selfTiktokUids = new Set(
    row.participants.filter((p) => p.teamIndex === 0).map((p) => p.tiktokUid)
  );
  const opponentGiftsMissing = !row.participants.some(
    (p) => !selfTiktokUids.has(p.tiktokUid) && p.giftEvents.length > 0
  );

  return {
    version: BATTLE_REPLAY_VERSION,
    battleId: row.battleId,
    startedAt: row.windowStart.toISOString(),
    durationMs: windowLengthMs,
    status: row.status,
    teams,
    anchors,
    senders,
    gifts,
    scorePoints,
    giftEvents,
    segments: buildSegments(row),
    opponentGiftsMissing,
    truncated,
  };
}

async function buildFromRow(row: ReplayRow, variant: ReplayVariant): Promise<BattleReplayPayload> {
  const senderTiktokUids = [
    ...new Set(row.participants.flatMap((p) => p.giftEvents.map((g) => g.senderTiktokUid))),
  ];
  const giftIds = [...new Set(row.participants.flatMap((p) => p.giftEvents.map((g) => g.giftId)))];

  // アバターは署名付きURLで数時間で失効するため保存せず都度解決する。
  const [anchorAvatarUrls, senderAvatarUrls, giftCatalog] = await Promise.all([
    resolveAvatarUrls(row.participants.map((p) => p.tiktokUid)),
    resolveAvatarUrls(senderTiktokUids),
    loadGiftCatalog(giftIds),
  ]);

  return buildPayload(row, variant, anchorAvatarUrls, senderAvatarUrls, giftCatalog);
}

export type ReplayQueryResult =
  | { ok: true; payload: BattleReplayPayload }
  | { ok: false; availability: ReplayAvailability };

/** 配信者本人・admin 向け。roomId で絞るので他人のバトルは引けない。 */
export async function queryBattleReplay(roomId: string, battleId: string): Promise<ReplayQueryResult> {
  const row = await prisma.battleHistory.findUnique({
    where: { roomId_battleId: { roomId, battleId } },
    select: REPLAY_SELECT,
  });
  if (row === null) return { ok: false, availability: { available: false, reason: "not_finalized" } };

  const availability = isReplayable(eligibilityOf(row));
  if (!availability.available) return { ok: false, availability };
  return { ok: true, payload: await buildFromRow(row, "private") };
}

/**
 * シェアリンク向け。**トークンだけが鍵**なのでセッションを見ない。
 * 公開バリアントは TikTokハンドル(配信者・リスナーとも)を載せない。
 */
export async function queryBattleReplayByShareToken(shareToken: string): Promise<ReplayQueryResult> {
  const row = await prisma.battleHistory.findUnique({
    where: { shareToken },
    select: REPLAY_SELECT,
  });
  if (row === null) return { ok: false, availability: { available: false, reason: "not_finalized" } };

  const availability = isReplayable(eligibilityOf(row));
  if (!availability.available) return { ok: false, availability };
  return { ok: true, payload: await buildFromRow(row, "public") };
}
