import { prisma } from "@/lib/prisma";
import { BATTLE_ACTION, type HostProfiles } from "@/lib/tiktok-battle";
import { getDateRange } from "@/lib/gift-analytics";
import { queryGifts, resolveHiddenGiftIds, type GiftAnalyticsUser } from "@/lib/gift-analytics";
import { resolveAvatarUrls } from "@/lib/avatar-storage";

// バトル履歴タブの集計ロジック。
//
// **相手のTikTokハンドル・表示名・アイコンは、相手が analytics 未登録でも取れる。**
// `linkMicBattle`/`linkMicArmies` の `anchorInfo` は両サイド分が同時に配信されるため、
// 自分の room の `TiktokBattle.hostProfiles`(tiktok-battle.ts)だけで解決できる
// (2026-08-27 に本番データで実証済み)。「同じ battleId を持つ別 room の行」を検索するのは、
// 相手が analytics に登録済みかどうか(= 自platform内リンクに使えるtiktokId)を知るためだけに残す。
//
// **スコアは消去法で解決する。** TiktokRoom.hostUserId が分かっているのは基本的に自分の room
// だけ(相手が未登録なら相手の hostUserId は永遠に埋まらない)。同じ battleId の全 room 行から
// hostUserIds をマージして重複排除した集合がちょうど2件で、自分の hostUserId がその一方なら、
// **もう一方が相手の anchorId** だと機械的に決まる。3人以上(2vs2 等)はサイド分割の情報が
// payload に無く敵味方を区別できないため、自分のスコアだけ出す。

/** 保存できる形の hostScore か。"12.5" や "1e+21" を BigInt() に渡して落ちないようにする。 */
const SCORE_PATTERN = /^\d{1,30}$/;

function asScoreEntries(value: unknown): [string, string][] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([anchorId, score]) =>
    typeof score === "string" && SCORE_PATTERN.test(score) ? [[anchorId, score] as [string, string]] : []
  );
}

export type BattleRow = {
  battleId: string;
  hostUserIds: string[];
  hostScores: unknown;
};

/** 同じ battleId の行から、anchorId ごとの最大スコアを求める。純粋関数。 */
export function mergeMaxScores(rows: BattleRow[]): Map<string, bigint> {
  const merged = new Map<string, bigint>();
  for (const row of rows) {
    for (const [anchorId, score] of asScoreEntries(row.hostScores)) {
      const value = BigInt(score);
      const current = merged.get(anchorId);
      if (current === undefined || value > current) merged.set(anchorId, value);
    }
  }
  return merged;
}

export type ResolvedBattleScore =
  | { kind: "1v1"; selfScore: string | null; opponentAnchorId: string; opponentScore: string | null }
  | { kind: "multi"; participantCount: number; selfScore: string | null }
  | { kind: "solo"; selfScore: string | null }
  | { kind: "unknown"; selfScore: null };

/**
 * 消去法でスコアを解決する。純粋関数。
 *
 * `selfHostUserId` が未解決、または観測したバトルに自分が含まれていない(別人の room)場合は
 * `unknown` を返す(誤って相手のスコアを自分のものとして出すより、出さないほうがよい)。
 * 自分しか観測できていない場合(`solo`)は、相手情報こそ無いが自分のスコア自体は正しいので出す。
 */
export function resolveBattleScore(input: {
  rows: BattleRow[];
  selfHostUserId: string | null;
}): ResolvedBattleScore {
  if (input.selfHostUserId === null) return { kind: "unknown", selfScore: null };

  const anchorIds = new Set<string>();
  for (const row of input.rows) for (const id of row.hostUserIds) anchorIds.add(id);

  if (!anchorIds.has(input.selfHostUserId)) return { kind: "unknown", selfScore: null };

  const merged = mergeMaxScores(input.rows);
  const selfScore = merged.get(input.selfHostUserId)?.toString() ?? null;

  if (anchorIds.size === 2) {
    const opponentAnchorId = [...anchorIds].find((id) => id !== input.selfHostUserId)!;
    return {
      kind: "1v1",
      selfScore,
      opponentAnchorId,
      opponentScore: merged.get(opponentAnchorId)?.toString() ?? null,
    };
  }

  if (anchorIds.size === 1) return { kind: "solo", selfScore };

  return { kind: "multi", participantCount: anchorIds.size, selfScore };
}

/** 決着済みバトルの開始からの猶予。この間は duration を過ぎていても「進行中」寄りに倒す。 */
const LIVE_GRACE_MS = 5 * 60 * 1000;

export type BattleWindow =
  | { status: "live"; window: { start: Date; end: Date } }
  | { status: "finished"; endedAtSource: "observed" | "duration"; window: { start: Date; end: Date } }
  | { status: "cut_short"; window: { start: Date; end: Date | null } }
  | { status: "unknown"; window: null };

/**
 * バトルの状態と、貢献者集計に使ってよい区間を決める。純粋関数。
 *
 * `endedAt = null` は「進行中」ではなく「終了を観測できなかった」(途中切断・途中接続・
 * worker再起動)であることが多い。3週間前の終了未観測バトルに「開始〜現在」を適用すると
 * 無関係な期間のギフトを貢献者一覧に混ぜてしまうため、observed → duration推定 → 進行中 →
 * 判定不能、の順で保守的に倒す。
 */
export function resolveBattleWindow(
  battle: {
    action: number;
    startedAt: Date;
    startedAtEstimated: boolean;
    endedAt: Date | null;
    durationSec: number | null;
  },
  now: Date
): BattleWindow {
  if (battle.action === BATTLE_ACTION.CUT_SHORT) {
    return { status: "cut_short", window: { start: battle.startedAt, end: battle.endedAt } };
  }

  if (battle.endedAt !== null) {
    return {
      status: "finished",
      endedAtSource: "observed",
      window: { start: battle.startedAt, end: battle.endedAt },
    };
  }

  if (!battle.startedAtEstimated && battle.durationSec !== null) {
    const estimatedEnd = new Date(battle.startedAt.getTime() + battle.durationSec * 1000);
    if (now.getTime() >= estimatedEnd.getTime()) {
      return { status: "finished", endedAtSource: "duration", window: { start: battle.startedAt, end: estimatedEnd } };
    }
    if (battle.action === BATTLE_ACTION.OPEN) {
      return { status: "live", window: { start: battle.startedAt, end: now } };
    }
  }

  if (battle.action === BATTLE_ACTION.OPEN && now.getTime() - battle.startedAt.getTime() < LIVE_GRACE_MS) {
    return { status: "live", window: { start: battle.startedAt, end: now } };
  }

  return { status: "unknown", window: null };
}

/** ダッシュボードの日/週/月タブと同じく Asia/Tokyo 基準で期間を解釈する。 */
export function jstDateRangeToUtc(period: string, date: string): { start: Date; end: Date } {
  const { start, end } = getDateRange(period, date);
  const start_ = new Date(`${start}T00:00:00+09:00`);
  const endExclusive = new Date(`${end}T00:00:00+09:00`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { start: start_, end: endExclusive };
}

export type BattleOpponent = {
  /** 相手が登録済みならそのtiktokId。未登録ならnull(補助情報)。 */
  tiktokId: string | null;
  /** anchorInfo由来のTikTokハンドル。相手が未登録でも取れる。ID併記用。 */
  displayId: string | null;
  /** 表示名。UIのメイン表示。 */
  nickName: string | null;
  /** 自前ストレージのpresigned GET URL。無ければnull。 */
  avatarUrl: string | null;
  count: number;
};

export type BattleListItem = {
  battleId: string;
  startedAt: string;
  status: BattleWindow["status"];
  opponent: BattleOpponent | null;
  selfScore: string | null;
  opponentScore: string | null;
  /** 自分が受け取った実ダイヤ合計。区間が確定できない(unknown、end===nullのcut_short)場合は0。 */
  selfTotalDiamonds: number;
};

/**
 * 同じbattleIdの行から、windowごとのダイヤ合計を求める。純粋関数。
 *
 * giftsはreceivedAt昇順にソート済みで渡すこと。各windowについて開始位置を二分探索してから
 * 線形に集計する(素朴なG×W走査を避ける)。windowはroomが同時に複数バトルへ参加できない
 * 性質上ほとんど重ならないが、重なっても正しく集計される(重複走査になるだけ)。
 */
export function sumDiamondsPerWindow(
  gifts: { receivedAt: Date; totalDiamonds: number }[],
  windows: { battleId: string; start: Date; end: Date }[]
): Map<string, number> {
  const result = new Map<string, number>();
  for (const w of windows) result.set(w.battleId, 0);

  const receivedAtMs = gifts.map((g) => g.receivedAt.getTime());

  function lowerBound(target: number): number {
    let lo = 0;
    let hi = receivedAtMs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (receivedAtMs[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  for (const w of windows) {
    const endMs = w.end.getTime();
    let sum = 0;
    for (let i = lowerBound(w.start.getTime()); i < gifts.length && receivedAtMs[i] <= endMs; i++) {
      sum += gifts[i].totalDiamonds;
    }
    result.set(w.battleId, sum);
  }

  return result;
}

/**
 * roomId の観測済みバトル一覧を返す。固定7クエリ(N+1にしない):
 * (1) 自 room のバトル (2) 同 battleId の他 room 行 (3) 他 room の TiktokRoom (4) 自 room の hostUserId
 * (5) 非表示ギフトID (6) ダイヤ集計対象のGift (7) 相手アイコンのTiktokAvatarAsset。
 * (5)〜(7)はダイヤ集計対象・相手アイコンが1件も無ければ実行しない。
 */
export async function queryBattles(
  roomId: string,
  viewerStreamerId: string,
  range: { start: Date; end: Date },
  now: Date = new Date()
): Promise<{ battles: BattleListItem[] }> {
  const selfRoom = await prisma.tiktokRoom.findUnique({
    where: { id: roomId },
    select: { hostUserId: true },
  });

  const ownBattles = await prisma.tiktokBattle.findMany({
    where: { roomId, startedAt: { gte: range.start, lt: range.end } },
    orderBy: { startedAt: "desc" },
    take: 200,
    select: {
      battleId: true,
      action: true,
      startedAt: true,
      startedAtEstimated: true,
      endedAt: true,
      durationSec: true,
      hostUserIds: true,
      hostScores: true,
      hostProfiles: true,
    },
  });

  if (ownBattles.length === 0) return { battles: [] };

  const battleIds = ownBattles.map((b) => b.battleId);
  const otherRows = await prisma.tiktokBattle.findMany({
    where: { battleId: { in: battleIds }, roomId: { not: roomId } },
    select: { battleId: true, roomId: true, hostUserIds: true, hostScores: true },
  });

  const otherRoomIds = [...new Set(otherRows.map((r) => r.roomId))];
  const otherRooms =
    otherRoomIds.length > 0
      ? await prisma.tiktokRoom.findMany({
          where: { id: { in: otherRoomIds } },
          select: { id: true, tiktokId: true, hostUserId: true },
        })
      : [];
  const otherRoomById = new Map(otherRooms.map((r) => [r.id, r]));

  const otherRowsByBattleId = new Map<string, typeof otherRows>();
  for (const row of otherRows) {
    const list = otherRowsByBattleId.get(row.battleId);
    if (list) list.push(row);
    else otherRowsByBattleId.set(row.battleId, [row]);
  }

  // ダイヤ集計対象のwindowを集める。unknown、end===nullのcut_shortは対象外(後で0扱い)。
  // liveはwindow.end=nowなので現時点までの累計になる。
  const windowInfoByBattleId = new Map<string, BattleWindow>();
  const diamondWindows: { battleId: string; start: Date; end: Date }[] = [];
  for (const own of ownBattles) {
    const windowInfo = resolveBattleWindow(own, now);
    windowInfoByBattleId.set(own.battleId, windowInfo);
    if (windowInfo.window !== null && windowInfo.window.end !== null) {
      diamondWindows.push({ battleId: own.battleId, start: windowInfo.window.start, end: windowInfo.window.end });
    }
  }

  let diamondsByBattleId = new Map<string, number>();
  if (diamondWindows.length > 0) {
    const hiddenIds = await resolveHiddenGiftIds(roomId, viewerStreamerId);
    const gifts = await prisma.gift.findMany({
      where: {
        roomId,
        OR: diamondWindows.map((w) => ({ receivedAt: { gte: w.start, lte: w.end } })),
        ...(hiddenIds.length > 0 ? { id: { notIn: hiddenIds } } : {}),
      },
      select: { receivedAt: true, totalDiamonds: true },
      orderBy: { receivedAt: "asc" },
    });
    diamondsByBattleId = sumDiamondsPerWindow(gifts, diamondWindows);
  }

  type PendingItem = {
    battleId: string;
    startedAt: string;
    status: BattleWindow["status"];
    selfScore: string | null;
    opponentScore: string | null;
    selfTotalDiamonds: number;
    opponentTiktokId: string | null;
    opponentDisplayId: string | null;
    opponentNickName: string | null;
    opponentAnchorId: string | null;
    opponentCount: number | null;
  };

  // 1v1に解決できたバトルの相手anchorIdをdistinctで集め、アイコンをまとめて1回だけ解決する。
  const opponentAnchorIds = new Set<string>();

  const pending: PendingItem[] = ownBattles.map((own): PendingItem => {
    const others = otherRowsByBattleId.get(own.battleId) ?? [];
    const rows: BattleRow[] = [
      { battleId: own.battleId, hostUserIds: own.hostUserIds, hostScores: own.hostScores },
      ...others.map((o) => ({ battleId: o.battleId, hostUserIds: o.hostUserIds, hostScores: o.hostScores })),
    ];

    const resolved = resolveBattleScore({ rows, selfHostUserId: selfRoom?.hostUserId ?? null });
    const windowInfo = windowInfoByBattleId.get(own.battleId)!;
    const selfScore: string | null = resolved.selfScore;

    let opponentTiktokId: string | null = null;
    let opponentDisplayId: string | null = null;
    let opponentNickName: string | null = null;
    let opponentAnchorId: string | null = null;
    let opponentCount: number | null = null;
    let opponentScore: string | null = null;

    if (resolved.kind === "1v1") {
      opponentScore = resolved.opponentScore;
      opponentAnchorId = resolved.opponentAnchorId;
      opponentAnchorIds.add(resolved.opponentAnchorId);

      const profile = (own.hostProfiles as HostProfiles | null)?.[resolved.opponentAnchorId];
      opponentDisplayId = profile?.displayId ?? null;
      opponentNickName = profile?.nickName ?? null;

      const opponentRoom = others.find((o) => o.hostUserIds.includes(resolved.opponentAnchorId));
      opponentTiktokId = opponentRoom ? otherRoomById.get(opponentRoom.roomId)?.tiktokId ?? null : null;
      opponentCount = 1;
    } else if (resolved.kind === "multi") {
      opponentCount = resolved.participantCount - 1;
    } else if (others.length > 0) {
      // anchorId ベースでは解決できなくても(hostUserId未解決・別人room混在等)、別 room の
      // 観測があれば相手候補として名前だけ出す。スコア対比は anchorId が特定できないので出さない。
      const firstOther = others[0];
      opponentTiktokId = otherRoomById.get(firstOther.roomId)?.tiktokId ?? null;
      opponentCount = otherRoomIds.length;
    }

    return {
      battleId: own.battleId,
      startedAt: own.startedAt.toISOString(),
      status: windowInfo.status,
      selfScore,
      opponentScore,
      selfTotalDiamonds: diamondsByBattleId.get(own.battleId) ?? 0,
      opponentTiktokId,
      opponentDisplayId,
      opponentNickName,
      opponentAnchorId,
      opponentCount,
    };
  });

  const opponentAvatarUrls = await resolveAvatarUrls("battle_host", [...opponentAnchorIds]);

  const battles: BattleListItem[] = pending.map((p) => ({
    battleId: p.battleId,
    startedAt: p.startedAt,
    status: p.status,
    opponent:
      p.opponentCount === null
        ? null
        : {
            tiktokId: p.opponentTiktokId,
            displayId: p.opponentDisplayId,
            nickName: p.opponentNickName,
            avatarUrl: p.opponentAnchorId ? opponentAvatarUrls.get(p.opponentAnchorId) ?? null : null,
            count: p.opponentCount,
          },
    selfScore: p.selfScore,
    opponentScore: p.opponentScore,
    selfTotalDiamonds: p.selfTotalDiamonds,
  }));

  return { battles };
}

export type BattleContributor = GiftAnalyticsUser;

/** 展開時に取得する、そのバトル区間だけの貢献者一覧。queryGifts と同じ集計・除外規則を使う。 */
export async function queryBattleContributors(
  roomId: string,
  viewerStreamerId: string,
  battleId: string,
  now: Date = new Date()
): Promise<{ contributors: BattleContributor[]; status: BattleWindow["status"] } | null> {
  const battle = await prisma.tiktokBattle.findUnique({
    where: { roomId_battleId: { roomId, battleId } },
    select: { action: true, startedAt: true, startedAtEstimated: true, endedAt: true, durationSec: true },
  });
  if (!battle) return null;

  const windowInfo = resolveBattleWindow(battle, now);
  if (windowInfo.window === null || windowInfo.window.end === null) {
    return { contributors: [], status: windowInfo.status };
  }

  const { users } = await queryGifts(roomId, viewerStreamerId, {
    receivedAt: { gte: windowInfo.window.start, lte: windowInfo.window.end },
  });
  return { contributors: users, status: windowInfo.status };
}
