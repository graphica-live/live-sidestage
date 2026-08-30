import { prisma } from "@/lib/prisma";
import { BATTLE_ACTION, type HostProfiles, type HostTeams } from "@/lib/tiktok-battle";
import { getDateRange } from "@/lib/gift-analytics";
import { queryGifts, resolveHiddenGiftIds, type GiftAnalyticsUser } from "@/lib/gift-analytics";
import { resolveAvatarUrls } from "@/lib/avatar-storage";

const BATTLE_SELECT = {
  battleId: true,
  action: true,
  startedAt: true,
  startedAtEstimated: true,
  endedAt: true,
  durationSec: true,
  hostUserIds: true,
  hostScores: true,
  hostProfiles: true,
  hostTeams: true,
} as const;

type OwnBattleRow = {
  battleId: string;
  action: number;
  startedAt: Date;
  startedAtEstimated: boolean;
  endedAt: Date | null;
  durationSec: number | null;
  hostUserIds: string[];
  hostScores: unknown;
  hostProfiles: unknown;
  hostTeams: unknown;
};

type ScanRow = {
  battleId: string;
  action: number;
  startedAt: Date;
  startedAtEstimated: boolean;
  endedAt: Date | null;
  durationSec: number | null;
};

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

/** hostTeams(anchorId -> teamId)から妥当なエントリだけを取り出す。値は非空文字列であることのみ検証。 */
function asTeamEntries(value: unknown): [string, string][] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([anchorId, teamId]) =>
    typeof teamId === "string" && teamId.length > 0 ? [[anchorId, teamId] as [string, string]] : []
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
  | {
      kind: "teams";
      selfTeamAnchorIds: string[];
      opponentTeamAnchorIds: string[];
      selfScore: string | null;
    }
  | { kind: "multi"; participantCount: number; selfScore: string | null }
  | { kind: "solo"; selfScore: string | null }
  | { kind: "unknown"; selfScore: null };

/**
 * 消去法でスコアを解決する。純粋関数。
 *
 * `selfHostUserId` が未解決、または観測したバトルに自分が含まれていない(別人の room)場合は
 * `unknown` を返す(誤って相手のスコアを自分のものとして出すより、出さないほうがよい)。
 * 自分しか観測できていない場合(`solo`)は、相手情報こそ無いが自分のスコア自体は正しいので出す。
 *
 * `selfHostTeams`(自room行のhostTeams列)にanchorIds全員分のteamId割当があり、かつ
 * distinctなteamIdがちょうど2種類のときだけ`teams`を返す。**チーム判定は自room行だけを見る**
 * (相手room行とはマージしない)。teamIdが受信room視点の相対値である可能性が未検証なため、
 * 複数roomのhostTeamsを混ぜると視点の異なる誤ったチーム分けを「割当済み」のまま表示しうる。
 * teamArmiesは両チーム分を1payloadに含むので、自room行だけで判定が完結する。
 */
export function resolveBattleScore(input: {
  rows: BattleRow[];
  selfHostUserId: string | null;
  selfHostTeams: unknown;
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

  const teamOf = new Map(asTeamEntries(input.selfHostTeams));
  const anchorIdList = [...anchorIds];
  const allAssigned = anchorIdList.every((id) => teamOf.has(id));
  const selfTeamId = teamOf.get(input.selfHostUserId);
  // hostTeamsに現在の参加者以外の値が(通常起きないが)残っていても巻き込まないよう、
  // 実際のanchorIdList分だけでdistinct数を数える。
  const distinctTeamCount = new Set(anchorIdList.map((id) => teamOf.get(id))).size;

  if (allAssigned && selfTeamId !== undefined && distinctTeamCount === 2) {
    return {
      kind: "teams",
      selfTeamAnchorIds: anchorIdList.filter((id) => teamOf.get(id) === selfTeamId),
      opponentTeamAnchorIds: anchorIdList.filter((id) => teamOf.get(id) !== selfTeamId),
      selfScore,
    };
  }

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

/** 左右split表示(vs)1メンバー分。1vs1・チーム戦の両方で使う共通の形。 */
export type BattleParticipant = {
  anchorId: string;
  /** 登録済みならそのtiktokId。未登録ならnull(補助情報)。 */
  tiktokId: string | null;
  /** anchorInfo由来のTikTokハンドル。未登録でも取れる。ID併記用。 */
  displayId: string | null;
  /** 表示名。UIのメイン表示。 */
  nickName: string | null;
  /** 自前ストレージのpresigned GET URL。無ければnull。 */
  avatarUrl: string | null;
};

export type BattleListItem = {
  battleId: string;
  startedAt: string;
  status: BattleWindow["status"];
  opponent: BattleOpponent | null;
  /**
   * 左右split表示用。1vs1・チーム戦(2vs2/1vs3等でhostTeamsが解決できた場合)は
   * どちらも非null(selfTeamは常に自分を含む1件以上、opponentTeamも1件以上)。
   * 対戦相手不明・チーム未解決のmulti・soloの場合はどちらもnull(UIは既存のopponentで
   * フォールバック表示する)。既存の`opponent`/`selfScore`/`opponentScore`は後方互換のため
   * そのまま残す(モバイルアプリはこれらのみを参照する)。
   */
  selfTeam: BattleParticipant[] | null;
  opponentTeam: BattleParticipant[] | null;
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

/** listenerQueryがgift(uniqueId/nickname)にマッチするか(大小文字を無視した部分一致)。 */
export function giftMatchesListenerQuery(
  gift: { uniqueId: string; nickname: string },
  listenerQuery: string
): boolean {
  const q = listenerQuery.toLowerCase();
  return gift.uniqueId.toLowerCase().includes(q) || gift.nickname.toLowerCase().includes(q);
}

/**
 * 各windowに、マッチ済みgiftが1件でも含まれるか。純粋関数。giftReceivedAtMsは昇順ソート済みで
 * 渡すこと(sumDiamondsPerWindowと同じ規約)。存在確認だけなので二分探索の結果を1点だけ見れば足りる。
 */
export function battleIdsWithGiftInWindow(
  giftReceivedAtMs: number[],
  windows: { battleId: string; start: Date; end: Date }[]
): Set<string> {
  const matched = new Set<string>();
  function lowerBound(target: number): number {
    let lo = 0;
    let hi = giftReceivedAtMs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (giftReceivedAtMs[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  for (const w of windows) {
    const i = lowerBound(w.start.getTime());
    if (i < giftReceivedAtMs.length && giftReceivedAtMs[i] <= w.end.getTime()) matched.add(w.battleId);
  }
  return matched;
}

const DISPLAY_LIMIT = 200;
const CHUNK_SIZE = 1000; // 1回のfindManyで取得するバトル件数(listenerQuery指定時のみ使う)
const MAX_SCAN_CHUNKS = 10; // 安全弁。CHUNK_SIZE*MAX_SCAN_CHUNKS=10,000件相当。1年で1万バトルは
                             // 現実の配信頻度を大きく超えるため、MAX_RANGE_DAYS等と同種の
                             // 「実用上は到達しない安全弁」として扱う(理論上は境界が残ることを明記)。

/**
 * リスナー名フィルタ有効時、一致するバトルをDISPLAY_LIMIT+1件見つかるまでチャンク走査する。
 * `startedAt`を降順カーソルにしてCHUNK_SIZE件ずつ取得し、各チャンクごとに一致判定に必要な
 * 最小限の列(receivedAt/uniqueId/nickname)だけでギフトを取得して判定する
 * (取得済み候補全件ぶんの表示用列・ダイヤ合計は表示対象が確定してから別途取得する)。
 *
 * 一括take(例: 5000件)で取得してから絞り込む設計だと、取得件数の上限を超えた位置にしか
 * 一致が無い場合に検索結果から漏れる(queryGiftHistoryが「limit後にfilterしない」のと同じ
 * 理由でNG)。チャンク走査ならレンジ全体を尽きるまで(またはDISPLAY_LIMIT+1件見つかるまで)
 * 走査を続けられる。
 */
async function scanMatchingBattleIds(
  roomId: string,
  viewerStreamerId: string,
  range: { start: Date; end: Date },
  listenerQuery: string,
  now: Date
): Promise<ScanRow[]> {
  const matchedRows: ScanRow[] = [];
  let cursor = range.end;

  for (let i = 0; i < MAX_SCAN_CHUNKS && matchedRows.length <= DISPLAY_LIMIT; i++) {
    const chunk: ScanRow[] = await prisma.tiktokBattle.findMany({
      where: { roomId, startedAt: { gte: range.start, lt: cursor } },
      orderBy: { startedAt: "desc" },
      take: CHUNK_SIZE,
      select: {
        battleId: true,
        action: true,
        startedAt: true,
        startedAtEstimated: true,
        endedAt: true,
        durationSec: true,
      },
    });
    if (chunk.length === 0) break;

    const diamondWindows = chunk
      .map((b) => ({ battleId: b.battleId, window: resolveBattleWindow(b, now).window }))
      .filter(
        (w): w is { battleId: string; window: { start: Date; end: Date } } =>
          w.window !== null && w.window.end !== null
      )
      .map((w) => ({ battleId: w.battleId, start: w.window.start, end: w.window.end }));

    if (diamondWindows.length > 0) {
      const hiddenIds = await resolveHiddenGiftIds(roomId, viewerStreamerId);
      const gifts = await prisma.gift.findMany({
        where: {
          roomId,
          OR: diamondWindows.map((w) => ({ receivedAt: { gte: w.start, lte: w.end } })),
          ...(hiddenIds.length > 0 ? { id: { notIn: hiddenIds } } : {}),
        },
        select: { receivedAt: true, uniqueId: true, nickname: true },
        orderBy: { receivedAt: "asc" },
      });
      const matching = gifts.filter((g) => giftMatchesListenerQuery(g, listenerQuery));
      const matchedIdsInChunk = battleIdsWithGiftInWindow(
        matching.map((g) => g.receivedAt.getTime()),
        diamondWindows
      );
      matchedRows.push(...chunk.filter((b) => matchedIdsInChunk.has(b.battleId)));
    }

    if (chunk.length < CHUNK_SIZE) break; // レンジ全体を走査し終えた
    cursor = chunk[chunk.length - 1].startedAt;
  }

  return matchedRows;
}

/**
 * ownBattles(表示対象として確定したバトル)から表示用アイテムを組み立てる。固定6クエリ
 * (N+1にしない): (1) 同 battleId の他 room 行 (2) 他 room の TiktokRoom (3) 非表示ギフトID
 * (4) ダイヤ集計対象のGift (5) 相手アイコンのTiktokAvatarAsset。(3)〜(5)はダイヤ集計対象・
 * 相手アイコンが1件も無ければ実行しない。
 */
/**
 * 左右split表示1メンバー分を組み立てる。selfHostUserId本人はselfTiktokIdで補う(自room由来なので確実)。
 *
 * チーム戦(3人以上)では「同じbattleIdを持つ他room行」が複数存在しうり、しかもその
 * hostUserIds は各roomが観測した battle payload 由来で**参加者全員分**が入る(自分だけの
 * IDに絞られていない。teamArmiesは両チーム分を1payloadに含むため、どのroomが観測しても
 * 同じ全員分のhostUserIdsになる)。そのため「hostUserIdsにanchorIdが含まれるroom」で
 * 検索すると、どの他room行がヒットしても真になってしまい、2人以上の他room行が絡む
 * チーム戦でtiktokIdを取り違える(誤って別参加者のtiktokIdを割り当てる)。
 * 「そのroom自身の所有者(TiktokRoom.hostUserId)がanchorIdと一致するか」で照合する。
 *
 * **検索対象は`candidateRoomIds`(このバトルで実際に観測された他room)だけに絞る。**
 * `TiktokRoom.tiktokId`はuniqueだが`hostUserId`にunique制約は無く、ハンドル変更で
 * 旧ハンドルのroom行が残ると同じhostUserIdを持つroomが複数存在しうる(手続きは
 * `src/lib/tiktok-host-id.ts`が一度入った値を上書きしない前提のため、新ハンドルの
 * roomは別行として作られる)。`otherRoomById`(このクエリ全体でまとめて取得した、
 * 表示対象の全バトル分の他room)を無条件に全探索すると、hostUserIdが重複するroomの
 * うちどれが先にヒットするかが不定になり、別バトル・別ハンドルのtiktokIdを取り違える。
 */
function buildParticipant(
  anchorId: string,
  hostProfiles: HostProfiles | null,
  candidateRoomIds: string[],
  otherRoomById: Map<string, { tiktokId: string; hostUserId: string | null }>,
  avatarUrls: Map<string, string>,
  selfHostUserId: string | null,
  selfTiktokId: string | null
): BattleParticipant {
  const profile = hostProfiles?.[anchorId];
  let tiktokId: string | null = null;
  if (anchorId === selfHostUserId) {
    tiktokId = selfTiktokId;
  } else {
    for (const roomId of candidateRoomIds) {
      const room = otherRoomById.get(roomId);
      if (room?.hostUserId === anchorId) {
        tiktokId = room.tiktokId;
        break;
      }
    }
  }
  return {
    anchorId,
    tiktokId,
    displayId: profile?.displayId ?? null,
    nickName: profile?.nickName ?? null,
    avatarUrl: avatarUrls.get(anchorId) ?? null,
  };
}

async function buildBattleListItems(
  ownBattles: OwnBattleRow[],
  roomId: string,
  viewerStreamerId: string,
  selfHostUserId: string | null,
  selfTiktokId: string | null,
  now: Date
): Promise<BattleListItem[]> {
  if (ownBattles.length === 0) return [];

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
    /** 左右split表示用。1v1/teamsに解決できた場合のみ非null(hostProfiles解決前の生anchorId)。 */
    selfTeamAnchorIds: string[] | null;
    opponentTeamAnchorIds: string[] | null;
    hostProfiles: HostProfiles | null;
    /** このバトルで実際に観測された他roomのroomId一覧。buildParticipantの検索対象をこのバトルだけに絞る。 */
    otherRoomIdsForBattle: string[];
  };

  // 左右split表示・旧opponentフィールドの両方に使うアイコンをdistinctで集め、まとめて1回だけ解決する。
  const avatarAnchorIds = new Set<string>();

  const pending: PendingItem[] = ownBattles.map((own): PendingItem => {
    const others = otherRowsByBattleId.get(own.battleId) ?? [];
    const rows: BattleRow[] = [
      { battleId: own.battleId, hostUserIds: own.hostUserIds, hostScores: own.hostScores },
      ...others.map((o) => ({ battleId: o.battleId, hostUserIds: o.hostUserIds, hostScores: o.hostScores })),
    ];

    const resolved = resolveBattleScore({ rows, selfHostUserId, selfHostTeams: own.hostTeams });
    const windowInfo = windowInfoByBattleId.get(own.battleId)!;
    const selfScore: string | null = resolved.selfScore;

    let opponentTiktokId: string | null = null;
    let opponentDisplayId: string | null = null;
    let opponentNickName: string | null = null;
    let opponentAnchorId: string | null = null;
    let opponentCount: number | null = null;
    let opponentScore: string | null = null;
    let selfTeamAnchorIds: string[] | null = null;
    let opponentTeamAnchorIds: string[] | null = null;

    if (resolved.kind === "1v1") {
      opponentScore = resolved.opponentScore;
      opponentAnchorId = resolved.opponentAnchorId;

      const profile = (own.hostProfiles as HostProfiles | null)?.[resolved.opponentAnchorId];
      opponentDisplayId = profile?.displayId ?? null;
      opponentNickName = profile?.nickName ?? null;

      const opponentRoom = others.find((o) => o.hostUserIds.includes(resolved.opponentAnchorId));
      opponentTiktokId = opponentRoom ? otherRoomById.get(opponentRoom.roomId)?.tiktokId ?? null : null;
      opponentCount = 1;

      // 1v1もteamsと同じ形(各サイド1人)に正規化し、UIが1vs1/2vs2/1vs3を同じ構造で扱えるようにする。
      if (selfHostUserId !== null) {
        selfTeamAnchorIds = [selfHostUserId];
        opponentTeamAnchorIds = [resolved.opponentAnchorId];
        avatarAnchorIds.add(selfHostUserId);
        avatarAnchorIds.add(resolved.opponentAnchorId);
      }
    } else if (resolved.kind === "teams") {
      // 旧opponentフィールドはmulti時代と同じ形(人数のみ、名前・アイコンは出さない)で後方互換を保つ。
      // モバイルアプリはopponent.countだけを見て「複数人バトル(N人)」に分岐している。
      opponentCount = resolved.selfTeamAnchorIds.length + resolved.opponentTeamAnchorIds.length - 1;
      selfTeamAnchorIds = resolved.selfTeamAnchorIds;
      opponentTeamAnchorIds = resolved.opponentTeamAnchorIds;
      for (const id of resolved.selfTeamAnchorIds) avatarAnchorIds.add(id);
      for (const id of resolved.opponentTeamAnchorIds) avatarAnchorIds.add(id);
    } else if (resolved.kind === "multi") {
      opponentCount = resolved.participantCount - 1;
    } else if (others.length > 0) {
      // anchorId ベースでは解決できなくても(hostUserId未解決・別人room混在等)、別 room の
      // 観測があれば相手候補として名前だけ出す。スコア対比は anchorId が特定できないので出さない。
      const firstOther = others[0];
      opponentTiktokId = otherRoomById.get(firstOther.roomId)?.tiktokId ?? null;
      // count は「このバトルの」相手room数。otherRoomIds は全バトル分の他roomを合算した
      // 集合なので使わない(使うと別バトルの相手数まで混入する)。
      const thisBattleOtherRoomIds = new Set(others.map((o) => o.roomId));
      opponentCount = thisBattleOtherRoomIds.size;
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
      selfTeamAnchorIds,
      opponentTeamAnchorIds,
      hostProfiles: own.hostProfiles as HostProfiles | null,
      otherRoomIdsForBattle: others.map((o) => o.roomId),
    };
  });

  const avatarUrls = await resolveAvatarUrls("battle_host", [...avatarAnchorIds]);

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
            avatarUrl: p.opponentAnchorId ? avatarUrls.get(p.opponentAnchorId) ?? null : null,
            count: p.opponentCount,
          },
    selfTeam:
      p.selfTeamAnchorIds?.map((id) =>
        buildParticipant(id, p.hostProfiles, p.otherRoomIdsForBattle, otherRoomById, avatarUrls, selfHostUserId, selfTiktokId)
      ) ?? null,
    opponentTeam:
      p.opponentTeamAnchorIds?.map((id) =>
        buildParticipant(id, p.hostProfiles, p.otherRoomIdsForBattle, otherRoomById, avatarUrls, selfHostUserId, selfTiktokId)
      ) ?? null,
    selfScore: p.selfScore,
    opponentScore: p.opponentScore,
    selfTotalDiamonds: p.selfTotalDiamonds,
  }));

  return battles;
}

/**
 * roomId の観測済みバトル一覧を返す。
 *
 * listenerQuery省略時は既存どおり直近DISPLAY_LIMIT件を1回のfindManyで取得する。指定時は
 * scanMatchingBattleIdsでチャンク走査により一致するバトルを探し、表示対象(最大
 * DISPLAY_LIMIT件)が確定してから初めて表示用の全列とダイヤ合計用のギフトを取得する
 * (絞り込みで除外されたバトルの相手情報取得・ダイヤ集計を無駄にしないため)。
 */
export async function queryBattles(
  roomId: string,
  viewerStreamerId: string,
  range: { start: Date; end: Date },
  options: { listenerQuery?: string | null; now?: Date } = {}
): Promise<{ battles: BattleListItem[]; hasMore: boolean }> {
  const { listenerQuery = null, now = new Date() } = options;

  const selfRoom = await prisma.tiktokRoom.findUnique({
    where: { id: roomId },
    select: { hostUserId: true, tiktokId: true },
  });
  const selfHostUserId = selfRoom?.hostUserId ?? null;
  const selfTiktokId = selfRoom?.tiktokId ?? null;

  if (!listenerQuery) {
    const ownBattles = await prisma.tiktokBattle.findMany({
      where: { roomId, startedAt: { gte: range.start, lt: range.end } },
      orderBy: { startedAt: "desc" },
      take: DISPLAY_LIMIT,
      select: BATTLE_SELECT,
    });
    const battles = await buildBattleListItems(ownBattles, roomId, viewerStreamerId, selfHostUserId, selfTiktokId, now);
    return { battles, hasMore: ownBattles.length >= DISPLAY_LIMIT };
  }

  const matchedRows = await scanMatchingBattleIds(roomId, viewerStreamerId, range, listenerQuery, now);
  const hasMore = matchedRows.length > DISPLAY_LIMIT;
  const battlesToRenderIds = matchedRows.slice(0, DISPLAY_LIMIT).map((b) => b.battleId);
  if (battlesToRenderIds.length === 0) return { battles: [], hasMore: false };

  const battlesToRenderUnsorted = await prisma.tiktokBattle.findMany({
    where: { roomId, battleId: { in: battlesToRenderIds } },
    select: BATTLE_SELECT,
  });
  const orderById = new Map(battlesToRenderIds.map((id, i) => [id, i]));
  const ownBattles = battlesToRenderUnsorted.sort(
    (a, b) => orderById.get(a.battleId)! - orderById.get(b.battleId)!
  );

  const battles = await buildBattleListItems(ownBattles, roomId, viewerStreamerId, selfHostUserId, selfTiktokId, now);
  return { battles, hasMore };
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
