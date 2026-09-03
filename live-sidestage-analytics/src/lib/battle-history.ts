import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BATTLE_ACTION, type HostProfiles, type HostTeams } from "@/lib/tiktok-battle";
import { getDateRange } from "@/lib/gift-analytics";
import { queryGifts, type GiftAnalyticsUser } from "@/lib/gift-analytics";
import { resolveAvatarUrls } from "@/lib/avatar-storage";
import { escapeLikePattern } from "@/lib/mobile-analytics-query";

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
export function asTeamEntries(value: unknown): [string, string][] {
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

/**
 * 陣営(faction)1つ分。**陣営数は2に限らない**(3陣営以上のマルチバトルをそのまま表現する)。
 *
 * `index === 0` は常に自分の陣営。以降は「anchorIdList上で最初に現れた順」で安定させる
 * (teamIdの文字列順は受信payload由来で意味を持たないため使わない)。
 */
export type BattleFaction = {
  index: number;
  isSelf: boolean;
  anchorIds: string[];
  /**
   * 陣営内メンバーのスコア合計(観測できたメンバーのみ加算)。1人も観測できなければ null。
   * 桁あふれを避けるため BigInt で合算して文字列で保持する。
   */
  score: string | null;
};

export type ResolvedBattleScore =
  | {
      kind: "1v1";
      selfScore: string | null;
      opponentAnchorId: string;
      opponentScore: string | null;
      factions: BattleFaction[];
    }
  | {
      kind: "teams";
      selfTeamAnchorIds: string[];
      /** 後方互換: 自陣以外の全メンバーを1つに畳んだもの。陣営の内訳は `factions` を見る。 */
      opponentTeamAnchorIds: string[];
      selfScore: string | null;
      factions: BattleFaction[];
    }
  | {
      kind: "multi";
      participantCount: number;
      anchorIds: string[];
      selfScore: string | null;
      /** チーム情報が無いので「1人=1陣営」として扱う。 */
      factions: BattleFaction[];
    }
  | { kind: "solo"; selfScore: string | null }
  | { kind: "unknown"; selfScore: null };

/** 陣営内メンバーのスコア合計。観測できたメンバーが1人もいなければ null(0に丸めない)。 */
function sumFactionScore(anchorIds: string[], merged: Map<string, bigint>): string | null {
  let total: bigint | null = null;
  for (const id of anchorIds) {
    const value = merged.get(id);
    if (value === undefined) continue;
    total = (total ?? 0n) + value;
  }
  return total === null ? null : total.toString();
}

/** anchorIdのグループ配列(先頭が自陣)からBattleFaction[]を作る。純粋関数。 */
function toFactions(groups: string[][], merged: Map<string, bigint>): BattleFaction[] {
  return groups.map((anchorIds, index) => ({
    index,
    isSelf: index === 0,
    anchorIds,
    score: sumFactionScore(anchorIds, merged),
  }));
}

/**
 * 消去法でスコアを解決する。純粋関数。
 *
 * `selfHostUserId` が未解決、または観測したバトルに自分が含まれていない(別人の room)場合は
 * `unknown` を返す(誤って相手のスコアを自分のものとして出すより、出さないほうがよい)。
 * 自分しか観測できていない場合(`solo`)は、相手情報こそ無いが自分のスコア自体は正しいので出す。
 *
 * `selfHostTeams`(自room行のhostTeams列)にanchorIds全員分のteamId割当があり、かつ
 * distinctなteamIdが2種類**以上**のとき`teams`を返す(3陣営以上もそのまま`factions`で表す)。
 * **チーム判定は自room行だけを見る**
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
      factions: toFactions([[input.selfHostUserId], [opponentAnchorId]], merged),
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

  if (allAssigned && selfTeamId !== undefined && distinctTeamCount >= 2) {
    // 自陣を先頭に、残りは anchorIdList 上の初出順で陣営を並べる(teamIdの文字列順は
    // 受信payload由来で意味を持たないため使わない)。
    const orderedTeamIds: string[] = [selfTeamId];
    for (const id of anchorIdList) {
      const teamId = teamOf.get(id)!;
      if (!orderedTeamIds.includes(teamId)) orderedTeamIds.push(teamId);
    }
    const groups = orderedTeamIds.map((teamId) => anchorIdList.filter((id) => teamOf.get(id) === teamId));
    return {
      kind: "teams",
      selfTeamAnchorIds: groups[0],
      // 3陣営以上でも旧UI(左右split)が壊れないよう、自陣以外は1つに畳んだものを残す。
      opponentTeamAnchorIds: anchorIdList.filter((id) => teamOf.get(id) !== selfTeamId),
      selfScore,
      factions: toFactions(groups, merged),
    };
  }

  // チーム分けが取れない3人以上の乱戦。**「自分1人 vs 残り全員」に丸めず**、1人=1陣営として
  // 全員分のスコアを個別に出せる形で返す(hostScoresはanchorId単位で観測できている)。
  return {
    kind: "multi",
    participantCount: anchorIds.size,
    anchorIds: anchorIdList,
    selfScore,
    factions: toFactions(
      [
        [input.selfHostUserId],
        ...anchorIdList.filter((id) => id !== input.selfHostUserId).map((id) => [id]),
      ],
      merged
    ),
  };
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

/**
 * 左右split表示1メンバーのうち、**恒久的に保存してよい部分**(署名付きURLを含まない)。
 * 確定スナップショット(BattleHistoryParticipant)へ保存するのはこの形。
 */
export type BattleParticipantIdentity = {
  anchorId: string;
  /** 登録済みならそのtiktokId。未登録ならnull(補助情報)。 */
  tiktokId: string | null;
  /** anchorInfo由来のTikTokハンドル。未登録でも取れる。ID併記用。 */
  displayId: string | null;
  /** 表示名。UIのメイン表示。 */
  nickName: string | null;
};

/** 左右split表示(vs)1メンバー分。1vs1・チーム戦の両方で使う共通の形。 */
export type BattleParticipant = BattleParticipantIdentity & {
  /** 自前ストレージのpresigned GET URL。無ければnull。24時間で失効するので保存しない。 */
  avatarUrl: string | null;
};

/**
 * 解決済みスコアから左右split表示のanchorId配列を決める。純粋関数。
 *
 * ライブ集計(buildBattleListItems)と確定処理(battle-history-finalize.ts)の両方から呼び、
 * 「確定前後で表示が変わらない」ことをこの1箇所で担保する。
 * solo/unknown、および自分のhostUserIdが未解決の場合はどちらもnull(左右split表示なし)。
 */
export function resolveBattleSides(
  resolved: ResolvedBattleScore,
  selfHostUserId: string | null
): { selfTeamAnchorIds: string[] | null; opponentTeamAnchorIds: string[] | null } {
  if (resolved.kind === "1v1") {
    // 1v1もteamsと同じ形(各サイド1人)に正規化し、UIが1vs1/2vs2/1vs3を同じ構造で扱えるようにする。
    if (selfHostUserId === null) return { selfTeamAnchorIds: null, opponentTeamAnchorIds: null };
    return { selfTeamAnchorIds: [selfHostUserId], opponentTeamAnchorIds: [resolved.opponentAnchorId] };
  }
  if (resolved.kind === "teams") {
    return {
      selfTeamAnchorIds: resolved.selfTeamAnchorIds,
      opponentTeamAnchorIds: resolved.opponentTeamAnchorIds,
    };
  }
  if (resolved.kind === "multi") {
    // チーム分けは不明だが、参加者全員のanchorIdは分かっている。「自分1人 vs 残り全員」として
    // 埋め、アイコン表示だけは3人以上でも出せるようにする(スコア対比は敵味方が不明なので出さない)。
    if (selfHostUserId === null) return { selfTeamAnchorIds: null, opponentTeamAnchorIds: null };
    return {
      selfTeamAnchorIds: [selfHostUserId],
      opponentTeamAnchorIds: resolved.anchorIds.filter((id) => id !== selfHostUserId),
    };
  }
  return { selfTeamAnchorIds: null, opponentTeamAnchorIds: null };
}

/**
 * 陣営1つ分の表示用データ。**陣営数は2に限らない**(3陣営以上のマルチバトルをそのまま返す)。
 * `index === 0` が自分の陣営。`selfTeam`/`opponentTeam`は後方互換のため残してあり、
 * `teams`はその上位互換(2陣営なら teams[0] === selfTeam、teams[1] === opponentTeam と一致する)。
 */
export type BattleTeam = {
  index: number;
  isSelf: boolean;
  /** 陣営内メンバーのスコア合計。1人も観測できていなければ null。 */
  score: string | null;
  participants: BattleParticipant[];
};

export type BattleListItem = {
  battleId: string;
  startedAt: string;
  status: BattleWindow["status"];
  opponent: BattleOpponent | null;
  /**
   * 左右split表示用。1vs1・チーム戦(2vs2/1vs3等でhostTeamsが解決できた場合)・
   * multi(3人以上でhostTeamsが2チームに解決できない乱戦。「自分1人 vs 残り全員」として
   * 埋める。敵味方が不明なためopponentScoreはnullのまま=スコア対比は出さず、アイコン表示のみに使う)
   * は、どちらも非null(selfTeamは常に自分を含む1件以上、opponentTeamも1件以上)。
   * 対戦相手不明・自分のhostUserId未解決のsolo/unknownの場合のみどちらもnull(UIは既存の
   * opponentでフォールバック表示する)。既存の`opponent`/`selfScore`/`opponentScore`は後方互換の
   * ためそのまま残す(モバイルアプリはこれらのみを参照する)。
   */
  selfTeam: BattleParticipant[] | null;
  opponentTeam: BattleParticipant[] | null;
  /**
   * 陣営ごとの内訳(3陣営以上をそのまま表現する)。solo/unknownのときのみnull。
   * 既存クライアントは`selfTeam`/`opponentTeam`/`selfScore`/`opponentScore`だけを見ればよく、
   * こちらは追加フィールド(後方互換を壊さない)。
   */
  teams: BattleTeam[] | null;
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
/** 与えたbattleIdのうち、確定済み(BattleHistory行がある)ものの集合。 */
async function listFinalizedBattleIds(roomId: string, battleIds: string[]): Promise<Set<string>> {
  if (battleIds.length === 0) return new Set();
  const rows = await prisma.battleHistory.findMany({
    where: { roomId, battleId: { in: battleIds } },
    select: { battleId: true },
  });
  return new Set(rows.map((r) => r.battleId));
}

/**
 * 確定済みバトルのうち、listenerQueryが貢献者(uniqueId/nickname)に一致するもの。
 *
 * 確定済みバトルの貢献者は「最新のニックネーム1件」に畳まれているため、バトル進行中に
 * 使っていた旧ニックネームでは一致しない(仕様変化。未確定バトルは従来どおりGiftを都度検索する)。
 */
async function matchFinalizedBattleIds(
  roomId: string,
  battleIds: string[],
  listenerQuery: string
): Promise<Set<string>> {
  if (battleIds.length === 0) return new Set();
  const pattern = escapeLikePattern(listenerQuery);
  const rows = await prisma.battleHistoryContributor.findMany({
    where: {
      battleHistory: { roomId, battleId: { in: battleIds } },
      OR: [
        { uniqueId: { contains: pattern, mode: Prisma.QueryMode.insensitive } },
        { nickname: { contains: pattern, mode: Prisma.QueryMode.insensitive } },
      ],
    },
    select: { battleHistory: { select: { battleId: true } } },
  });
  return new Set(rows.map((r) => r.battleHistory.battleId));
}

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

    // 同じチャンク内で確定済み/未確定を分類し、それぞれの一致判定の結果を合算する
    // (確定済みバトルだけでチャンク・件数上限を消費して未確定バトルを取りこぼさないため)。
    const matchedIdsInChunk = new Set<string>();

    const finalizedIds = await matchFinalizedBattleIds(
      roomId,
      chunk.map((b) => b.battleId),
      listenerQuery
    );
    const finalizedIdSet = await listFinalizedBattleIds(
      roomId,
      chunk.map((b) => b.battleId)
    );
    for (const id of finalizedIds) matchedIdsInChunk.add(id);

    const diamondWindows = chunk
      .filter((b) => !finalizedIdSet.has(b.battleId))
      .map((b) => ({ battleId: b.battleId, window: resolveBattleWindow(b, now).window }))
      .filter(
        (w): w is { battleId: string; window: { start: Date; end: Date } } =>
          w.window !== null && w.window.end !== null
      )
      .map((w) => ({ battleId: w.battleId, start: w.window.start, end: w.window.end }));

    if (diamondWindows.length > 0) {
      const gifts = await prisma.gift.findMany({
        where: {
          roomId,
          OR: diamondWindows.map((w) => ({ receivedAt: { gte: w.start, lte: w.end } })),
        },
        select: { receivedAt: true, uniqueId: true, nickname: true },
        orderBy: { receivedAt: "asc" },
      });
      const matching = gifts.filter((g) => giftMatchesListenerQuery(g, listenerQuery));
      for (const id of battleIdsWithGiftInWindow(
        matching.map((g) => g.receivedAt.getTime()),
        diamondWindows
      )) {
        matchedIdsInChunk.add(id);
      }
    }

    // chunkの順序(startedAt降順)のまま積む。
    matchedRows.push(...chunk.filter((b) => matchedIdsInChunk.has(b.battleId)));

    if (chunk.length < CHUNK_SIZE) break; // レンジ全体を走査し終えた
    cursor = chunk[chunk.length - 1].startedAt;
  }

  return matchedRows;
}

/**
 * ownBattles(表示対象として確定したバトル)から表示用アイテムを組み立てる。固定5クエリ
 * (N+1にしない): (1) 同 battleId の他 room 行 (2) 他 room の TiktokRoom (3) ダイヤ集計対象のGift
 * (4) 相手アイコンのTiktokAvatarAsset。(3)〜(4)はダイヤ集計対象・相手アイコンが1件も無ければ実行しない。
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
export function resolveParticipantIdentity(
  anchorId: string,
  hostProfiles: HostProfiles | null,
  candidateRoomIds: string[],
  otherRoomById: Map<string, { tiktokId: string; hostUserId: string | null }>,
  selfHostUserId: string | null,
  selfTiktokId: string | null
): BattleParticipantIdentity {
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
  };
}

/**
 * Phase2a(新構造dual-write)専用。参加者(anchorId)が所属するTiktokRoom.idを解決する。
 * resolveParticipantIdentityのtiktokId解決と同じ「hostUserId一致マッチ」を使うが、
 * 一致候補が2件以上ある(曖昧)場合は解決失敗としてnullに倒す(先勝ちにしない)。
 * 自分ならselfRoomId、相手はSidestageがそのroomを別途監視できていた場合のみ解決できる
 * (できなければ新構造ではその参加者の個々のギフトイベントを保存できない=null)。
 */
export function resolveParticipantRoomId(
  anchorId: string,
  candidateRoomIds: string[],
  otherRoomById: Map<string, { tiktokId: string; hostUserId: string | null }>,
  selfHostUserId: string | null,
  selfRoomId: string
): string | null {
  if (anchorId === selfHostUserId) return selfRoomId;
  const matches = [...new Set(candidateRoomIds)].filter((roomId) => otherRoomById.get(roomId)?.hostUserId === anchorId);
  return matches.length === 1 ? matches[0] : null;
}

function buildParticipant(
  anchorId: string,
  hostProfiles: HostProfiles | null,
  candidateRoomIds: string[],
  otherRoomById: Map<string, { tiktokId: string; hostUserId: string | null }>,
  avatarUrls: Map<string, string>,
  selfHostUserId: string | null,
  selfTiktokId: string | null
): BattleParticipant {
  const identity = resolveParticipantIdentity(
    anchorId,
    hostProfiles,
    candidateRoomIds,
    otherRoomById,
    selfHostUserId,
    selfTiktokId
  );
  return { ...identity, avatarUrl: avatarUrls.get(anchorId) ?? null };
}

/** 確定済みスナップショット(BattleHistory)1件分。読み出しに必要な列だけ。 */
export type FinalizedBattle = {
  battleId: string;
  status: string;
  selfScore: string | null;
  opponentScore: string | null;
  selfTotalDiamonds: number;
  participants: {
    /** 後方互換の2値。teamIndex===0が"self"、それ以外が"opponent"。 */
    side: string;
    /** 陣営番号。0が自分の陣営。3陣営以上はここでしか区別できない。 */
    teamIndex: number;
    position: number;
    anchorId: string;
    tiktokId: string | null;
    displayId: string | null;
    nickName: string | null;
    /** 確定時に観測できていたこのメンバーのスコア。未観測ならnull。 */
    score: string | null;
  }[];
};

/**
 * 確定済みバトルを battleId 単位で引く。**行が存在すること自体が「確定済み」を意味する**ので、
 * 見つからなかった battleId は未確定としてライブ集計へフォールバックする。
 */
async function loadFinalizedBattles(roomId: string, battleIds: string[]): Promise<Map<string, FinalizedBattle>> {
  if (battleIds.length === 0) return new Map();
  const rows = await prisma.battleHistory.findMany({
    where: { roomId, battleId: { in: battleIds } },
    select: {
      battleId: true,
      status: true,
      selfScore: true,
      opponentScore: true,
      selfTotalDiamonds: true,
      participants: {
        select: {
          side: true,
          teamIndex: true,
          position: true,
          anchorId: true,
          tiktokId: true,
          displayId: true,
          nickName: true,
          score: true,
        },
        orderBy: [{ teamIndex: "asc" }, { position: "asc" }],
      },
    },
  });
  return new Map(rows.map((r) => [r.battleId, r]));
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
  // 確定済みバトルは Gift も他room行も引かない(スナップショットで完結する)。
  const finalizedByBattleId = await loadFinalizedBattles(roomId, battleIds);
  const liveBattleIds = battleIds.filter((id) => !finalizedByBattleId.has(id));

  const otherRows =
    liveBattleIds.length > 0
      ? await prisma.tiktokBattle.findMany({
          where: { battleId: { in: liveBattleIds }, roomId: { not: roomId } },
          select: { battleId: true, roomId: true, hostUserIds: true, hostScores: true },
        })
      : [];

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
    if (finalizedByBattleId.has(own.battleId)) continue; // 確定済み: Gift集計そのものを行わない
    const windowInfo = resolveBattleWindow(own, now);
    windowInfoByBattleId.set(own.battleId, windowInfo);
    if (windowInfo.window !== null && windowInfo.window.end !== null) {
      diamondWindows.push({ battleId: own.battleId, start: windowInfo.window.start, end: windowInfo.window.end });
    }
  }

  let diamondsByBattleId = new Map<string, number>();
  if (diamondWindows.length > 0) {
    const gifts = await prisma.gift.findMany({
      where: {
        roomId,
        OR: diamondWindows.map((w) => ({ receivedAt: { gte: w.start, lte: w.end } })),
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
    /** 陣営ごとの内訳(3陣営以上をそのまま持つ)。solo/unknownのみnull。 */
    factions: { anchorIds: string[]; score: string | null }[] | null;
    hostProfiles: HostProfiles | null;
    /** このバトルで実際に観測された他roomのroomId一覧。buildParticipantの検索対象をこのバトルだけに絞る。 */
    otherRoomIdsForBattle: string[];
    /**
     * 確定済みバトルのみ非null。anchorId -> 保存済みの識別情報。
     * 非nullのときはhostProfiles/otherRoomByIdを引かず、この値をそのまま表示に使う。
     */
    storedIdentities: Map<string, BattleParticipantIdentity> | null;
  };

  // 左右split表示・旧opponentフィールドの両方に使うアイコンをdistinctで集め、まとめて1回だけ解決する。
  const avatarAnchorIds = new Set<string>();

  /**
   * 確定済みバトルの表示アイテムをスナップショットだけから組み立てる。
   * Gift・他room行・hostProfiles のいずれも参照しない。
   *
   * 旧 `opponent` フィールド(モバイルアプリが参照する後方互換フィールド)は、保存済み参加者の
   * サイド人数から復元する。確定対象は 1v1 / teams / multi のいずれかに限られる(solo・unknown は
   * 確定しない)ため、self と opponent は必ず1人以上いる。self=1 かつ opponent=1 なら 1v1、
   * それ以外は teams/multi と同じ「人数のみ」の形にする(ライブ集計と同じ規則)。
   */
  function buildFinalizedPendingItem(own: OwnBattleRow, finalized: FinalizedBattle): PendingItem {
    // 3陣営以上ではsideが同じでも陣営が違う(position はその陣営内の連番)ので、
    // 旧フィールド用に畳むときは teamIndex → position の順で並べる。
    const byTeamThenPosition = (a: FinalizedBattle["participants"][number], b: FinalizedBattle["participants"][number]) =>
      a.teamIndex - b.teamIndex || a.position - b.position;
    const selfParticipants = finalized.participants.filter((p) => p.side === "self").sort(byTeamThenPosition);
    const opponentParticipants = finalized.participants.filter((p) => p.side === "opponent").sort(byTeamThenPosition);

    // 陣営はteamIndexで復元する。**teamIndex列の導入前に確定した行はすべて0**なので、
    // 2陣営以上に分かれていなければ従来どおりside(self/opponent)から2陣営を作る。
    const teamIndexes = [...new Set(finalized.participants.map((p) => p.teamIndex))].sort((a, b) => a - b);
    const factionGroups: typeof finalized.participants[] =
      teamIndexes.length >= 2
        ? teamIndexes.map((i) =>
            finalized.participants.filter((p) => p.teamIndex === i).sort((a, b) => a.position - b.position)
          )
        : [selfParticipants, opponentParticipants].filter((g) => g.length > 0);

    const factions = factionGroups.map((group, index) => {
      let total: bigint | null = null;
      for (const p of group) {
        if (p.score === null) continue;
        total = (total ?? 0n) + BigInt(p.score);
      }
      // score列の導入前に確定した行はスコアを持たないので、BattleHistory側の
      // selfScore/opponentScore(2陣営のときのみ意味がある)で補う。
      const legacy =
        index === 0 ? finalized.selfScore : factionGroups.length === 2 ? finalized.opponentScore : null;
      return { anchorIds: group.map((p) => p.anchorId), score: total === null ? legacy : total.toString() };
    });

    const storedIdentities = new Map<string, BattleParticipantIdentity>(
      finalized.participants.map((p) => [
        p.anchorId,
        { anchorId: p.anchorId, tiktokId: p.tiktokId, displayId: p.displayId, nickName: p.nickName },
      ])
    );
    for (const anchorId of storedIdentities.keys()) avatarAnchorIds.add(anchorId);

    const isOneVsOne = selfParticipants.length === 1 && opponentParticipants.length === 1;
    const opponentCount =
      opponentParticipants.length === 0 ? null : selfParticipants.length + opponentParticipants.length - 1;
    const soleOpponent = isOneVsOne ? opponentParticipants[0] : null;

    return {
      battleId: own.battleId,
      startedAt: own.startedAt.toISOString(),
      status: finalized.status as BattleWindow["status"],
      selfScore: finalized.selfScore,
      opponentScore: finalized.opponentScore,
      selfTotalDiamonds: finalized.selfTotalDiamonds,
      opponentTiktokId: soleOpponent?.tiktokId ?? null,
      opponentDisplayId: soleOpponent?.displayId ?? null,
      opponentNickName: soleOpponent?.nickName ?? null,
      opponentAnchorId: soleOpponent?.anchorId ?? null,
      opponentCount,
      selfTeamAnchorIds: selfParticipants.length > 0 ? selfParticipants.map((p) => p.anchorId) : null,
      opponentTeamAnchorIds: opponentParticipants.length > 0 ? opponentParticipants.map((p) => p.anchorId) : null,
      factions: factions.length > 0 ? factions : null,
      hostProfiles: null,
      otherRoomIdsForBattle: [],
      storedIdentities,
    };
  }

  const pending: PendingItem[] = ownBattles.map((own): PendingItem => {
    const finalized = finalizedByBattleId.get(own.battleId);
    if (finalized) return buildFinalizedPendingItem(own, finalized);

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

    // 左右split表示のanchorId配列は確定処理と同じ関数で決める(確定前後で表示を変えないため)。
    const { selfTeamAnchorIds, opponentTeamAnchorIds } = resolveBattleSides(resolved, selfHostUserId);
    for (const id of selfTeamAnchorIds ?? []) avatarAnchorIds.add(id);
    for (const id of opponentTeamAnchorIds ?? []) avatarAnchorIds.add(id);

    if (resolved.kind === "1v1") {
      opponentScore = resolved.opponentScore;
      opponentAnchorId = resolved.opponentAnchorId;

      const profile = (own.hostProfiles as HostProfiles | null)?.[resolved.opponentAnchorId];
      opponentDisplayId = profile?.displayId ?? null;
      opponentNickName = profile?.nickName ?? null;

      const opponentRoom = others.find((o) => o.hostUserIds.includes(resolved.opponentAnchorId));
      opponentTiktokId = opponentRoom ? otherRoomById.get(opponentRoom.roomId)?.tiktokId ?? null : null;
      opponentCount = 1;
    } else if (resolved.kind === "teams") {
      // 旧opponentフィールドはmulti時代と同じ形(人数のみ、名前・アイコンは出さない)で後方互換を保つ。
      // モバイルアプリはopponent.countだけを見て「複数人バトル(N人)」に分岐している。
      opponentCount = resolved.selfTeamAnchorIds.length + resolved.opponentTeamAnchorIds.length - 1;
    } else if (resolved.kind === "multi") {
      // チーム分けは不明だが、参加者全員のanchorIdは分かっている(resolveBattleSidesが
      // 「自分1人 vs 残り全員」として埋める)。アイコン表示だけは3人以上でも出すが、
      // 敵味方が不明なのでスコア対比は出さない(opponentScoreはnullのまま)。
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
      factions:
        resolved.kind === "1v1" || resolved.kind === "teams" || resolved.kind === "multi"
          ? resolved.factions.map((f) => ({ anchorIds: f.anchorIds, score: f.score }))
          : null,
      hostProfiles: own.hostProfiles as HostProfiles | null,
      otherRoomIdsForBattle: others.map((o) => o.roomId),
      storedIdentities: null,
    };
  });

  const avatarUrls = await resolveAvatarUrls("battle_host", [...avatarAnchorIds]);

  /** 確定済みは保存済みの識別情報、未確定はライブ解決。どちらもアイコンだけは都度署名する。 */
  const participantOf = (anchorId: string, p: PendingItem): BattleParticipant => {
    const stored = p.storedIdentities?.get(anchorId);
    if (stored) return { ...stored, avatarUrl: avatarUrls.get(anchorId) ?? null };
    return buildParticipant(
      anchorId,
      p.hostProfiles,
      p.otherRoomIdsForBattle,
      otherRoomById,
      avatarUrls,
      selfHostUserId,
      selfTiktokId
    );
  };

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
    selfTeam: p.selfTeamAnchorIds?.map((id) => participantOf(id, p)) ?? null,
    opponentTeam: p.opponentTeamAnchorIds?.map((id) => participantOf(id, p)) ?? null,
    teams:
      p.factions?.map((f, index) => ({
        index,
        isSelf: index === 0,
        score: f.score,
        participants: f.anchorIds.map((id) => participantOf(id, p)),
      })) ?? null,
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

/** BattleHistoryGiftEvent 1行分(集計に使う列だけ)。rowsは呼び出し側で
 * `[{occurredAt:"desc"},{sourceGiftId:"desc"}]` 済みである前提(「最初に見た行を採用」で
 * nicknameを最新行のものに固定するため)。 */
export type GiftEventForContribution = {
  senderUniqueIdSnapshot: string;
  senderNicknameSnapshot: string;
  repeatCount: number;
  totalDiamonds: number;
  occurredAt: Date;
  sourceGiftId: string;
};

/**
 * BattleHistoryGiftEvent群を送信者ごとに集計し、旧 aggregateGiftUsers と同じ形へ変換する純関数。
 * 集計規則はaggregateGiftUsers(gift-analytics.ts)に合わせる:
 * giftCount=ΣrepeatCount, totalDiamonds=ΣtotalDiamonds, lastGiftAt=max(occurredAt),
 * nickname=最新occurredAt行のsnapshot。sourceGiftIdの重複(書き込み経路上は起きない想定だが
 * 保険)はSetで弾き、二重計上を防ぐ。profileImageUrlは呼び出し側でresolveAvatarUrlsして埋める。
 */
export function aggregateGiftEventsToContributors(rows: GiftEventForContribution[]): BattleContributor[] {
  const seenSourceIds = new Set<string>();
  const byUniqueId = new Map<
    string,
    { nickname: string; giftCount: number; totalDiamonds: number; lastGiftAt: Date }
  >();
  for (const row of rows) {
    if (seenSourceIds.has(row.sourceGiftId)) continue;
    seenSourceIds.add(row.sourceGiftId);
    const existing = byUniqueId.get(row.senderUniqueIdSnapshot);
    if (existing) {
      existing.giftCount += row.repeatCount;
      existing.totalDiamonds += row.totalDiamonds;
      if (row.occurredAt > existing.lastGiftAt) existing.lastGiftAt = row.occurredAt;
    } else {
      byUniqueId.set(row.senderUniqueIdSnapshot, {
        nickname: row.senderNicknameSnapshot,
        giftCount: row.repeatCount,
        totalDiamonds: row.totalDiamonds,
        lastGiftAt: row.occurredAt,
      });
    }
  }
  return [...byUniqueId.entries()]
    .map(([uniqueId, v]) => ({
      uniqueId,
      nickname: v.nickname,
      profileImageUrl: null as string | null,
      giftCount: v.giftCount,
      totalDiamonds: v.totalDiamonds,
      lastGiftAt: v.lastGiftAt.toISOString(),
    }))
    .sort((a, b) => {
      if (b.totalDiamonds !== a.totalDiamonds) return b.totalDiamonds - a.totalDiamonds;
      if (a.lastGiftAt !== b.lastGiftAt) return a.lastGiftAt < b.lastGiftAt ? 1 : -1;
      return a.uniqueId < b.uniqueId ? -1 : a.uniqueId > b.uniqueId ? 1 : 0;
    });
}

/** Phase2c以前(dual-write開始前)に確定した行向けの旧経路フォールバック。
 * 新経路(自room participantのgiftEvents)が0件の場合だけ遅延で叩く(常時同時取得しない)。 */
async function queryLegacyContributors(roomId: string, battleId: string): Promise<BattleContributor[]> {
  const legacy = await prisma.battleHistory.findUnique({
    where: { roomId_battleId: { roomId, battleId } },
    select: {
      contributors: {
        select: { uniqueId: true, nickname: true, giftCount: true, totalDiamonds: true, lastGiftAt: true },
        orderBy: [{ totalDiamonds: "desc" }, { lastGiftAt: "desc" }, { uniqueId: "asc" }],
      },
    },
  });
  return (legacy?.contributors ?? []).map((c) => ({
    uniqueId: c.uniqueId,
    nickname: c.nickname,
    profileImageUrl: null,
    giftCount: c.giftCount,
    totalDiamonds: c.totalDiamonds,
    lastGiftAt: c.lastGiftAt.toISOString(),
  }));
}

/**
 * 展開時に取得する、そのバトル区間だけの貢献者一覧。
 *
 * 確定済み(BattleHistory行がある)なら Gift に触れずスナップショットから返す。
 * 未確定なら従来どおり queryGifts と同じ集計規則でライブ集計する。
 *
 * Phase2c(Cutover): 確定済みは新構造(BattleHistoryParticipant配下のBattleHistoryGiftEvent、
 * Phase2aでdual-write済み)から再構成する。参加者の絞り込みは`isSelf`ではなく
 * `participant.roomId === このBattleHistory行の自room(=roomId引数)`で行う — isSelfはteam戦
 * (2v2等)で味方も含んでしまうが、roomIdが自roomに一致するのはresolveParticipantRoomId
 * (battle-history.ts)の設計上、本人だけ(味方は別roomか未解決null)。DB側のwhereで絞り込み、
 * 相手/味方roomのgiftEventsは転送しない(事務所配下同士の対戦で無駄な読み取りを避ける)。
 * バックフィル済みデータはself側全員が自roomのroomIdを持つ場合があるが、giftEventsを
 * 実際に持つのは本人1人だけなのでflattenしても結果は変わらない。
 * Phase2a以前に確定した行はgiftEventsが0件になるため、旧`contributors`へフォールバックする
 * (過去データの表示が空欄化しないための後方互換措置)。
 */
export async function queryBattleContributors(
  roomId: string,
  viewerStreamerId: string,
  battleId: string,
  now: Date = new Date()
): Promise<{ contributors: BattleContributor[]; status: BattleWindow["status"] } | null> {
  const finalized = await prisma.battleHistory.findUnique({
    where: { roomId_battleId: { roomId, battleId } },
    select: {
      status: true,
      participants: {
        where: { roomId },
        select: {
          giftEvents: {
            select: {
              senderUniqueIdSnapshot: true,
              senderNicknameSnapshot: true,
              repeatCount: true,
              totalDiamonds: true,
              occurredAt: true,
              sourceGiftId: true,
            },
            orderBy: [{ occurredAt: "desc" }, { sourceGiftId: "desc" }],
          },
        },
      },
    },
  });

  if (finalized) {
    const selfGiftEventRows = finalized.participants.flatMap((p) => p.giftEvents);

    const contributors =
      selfGiftEventRows.length > 0
        ? aggregateGiftEventsToContributors(selfGiftEventRows)
        : await queryLegacyContributors(roomId, battleId);

    // アバターだけは署名付きURLなので保存せず都度解決する(TiktokAvatarAssetはGift非依存の恒久キャッシュ)。
    const avatarUrls = await resolveAvatarUrls(
      "gift_sender",
      contributors.map((c) => c.uniqueId)
    );
    return {
      contributors: contributors.map((c) => ({ ...c, profileImageUrl: avatarUrls.get(c.uniqueId) ?? null })),
      status: finalized.status as BattleWindow["status"],
    };
  }

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
