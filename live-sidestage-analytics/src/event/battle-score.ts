import { fetchRoomHostUserIds, type DbClient } from "./analytics-db";

// TikTok 側が配信するバトルスコア(`hostScore`)を、対戦カードのサイドへ帰属させる。
//
// **勝敗には一切関与しない。** 勝敗は当サービスが gifts から集計したダイヤで決める
// (match-results.ts)。ここで扱うのは表示専用の参考値で、解決できなければ何も出さない。
//
// 帰属の仕組み:
//   hostScores のキー = anchorIdStr(TikTok の数値 userId)
//   TiktokRoom.hostUserId = 同じ数値 userId(src/lib/tiktok-host-id.ts が補完する)
//   EventMatchSideParticipant -> EventParticipant.roomId -> TiktokRoom
// この鎖が1箇所でも切れているサイドは**出さない**。誤った数字を出すより出さないほうがよい。
//
// 集計時に EventMatchSide へ保存せず読み取り時に解決しているのは、
//   - VOID / reopen / reopenAggregation() の整合を新たに背負わずに済む
//   - detectedBattleId が付いた時点(LIVE 中)から出せる
// ため。クエリはマッチ数に依らず2本で、N+1 にはならない。

/** 保存できる形の hostScore か。`"12.5"` や `"1e+21"` を BigInt() に渡して落ちないようにする。 */
const SCORE_PATTERN = /^\d{1,30}$/;

/** `DetectedBattle` 1行分。room ごとに1行あり、**1行に両サイド全員分のスコアが入る**。 */
export type BattleScoreRow = {
  hostUserIds: string[];
  hostScores: unknown;
};

export type ScoreSideInput = {
  sideId: string;
  /** そのサイドの出場者の roomId。空なら未確定のサイドなので解決しない。 */
  roomIds: string[];
};

function asScoreEntries(value: unknown): [string, string][] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([anchorId, score]) =>
    typeof score === "string" && SCORE_PATTERN.test(score) ? [[anchorId, score] as [string, string]] : []
  );
}

/**
 * 同じ battleId の行から、サイドごとのバトルスコアを決める。純粋関数。
 *
 * 行のマージは **anchorId ごとに最大値**を採る。理由:
 * バトル中のスコアは単調増加で、片側の room の接続が落ちるとその行だけ古い値で凍る。
 * `DetectedBattle.updatedAt` は `ingestBattles` が毎周 upsert するので鮮度の判定に使えない。
 * 単純な上書きマージだと行の返却順しだいで古い値が新しい値を潰す。
 *
 * 返すのは解決できたサイドだけ。片方しか解決できなくても、解決できたほうは返す。
 */
export function resolveSideTiktokScores(input: {
  rows: BattleScoreRow[];
  sides: ScoreSideInput[];
  hostUserIdByRoomId: Map<string, string>;
}): Map<string, string> {
  const resolved = new Map<string, string>();
  if (input.rows.length === 0) return resolved;

  const merged = new Map<string, bigint>();
  const observedHosts = new Set<string>();
  for (const row of input.rows) {
    for (const anchorId of row.hostUserIds) observedHosts.add(anchorId);
    for (const [anchorId, score] of asScoreEntries(row.hostScores)) {
      const value = BigInt(score);
      const current = merged.get(anchorId);
      if (current === undefined || value > current) merged.set(anchorId, value);
    }
  }

  // サイドごとに出場者の hostUserId を集める。1人でも欠けたらそのサイドは出さない(部分和にしない)。
  const hostsBySide = new Map<string, string[]>();
  for (const side of input.sides) {
    if (side.roomIds.length === 0) continue;

    const hosts: string[] = [];
    let complete = true;
    for (const roomId of side.roomIds) {
      const hostUserId = input.hostUserIdByRoomId.get(roomId);
      // 「解決できない」= hostUserId が未取得 / そのバトルに出ていない / スコアが観測できていない。
      if (
        hostUserId === undefined ||
        !observedHosts.has(hostUserId) ||
        !merged.has(hostUserId)
      ) {
        complete = false;
        break;
      }
      hosts.push(hostUserId);
    }
    if (complete) hostsBySide.set(side.sideId, hosts);
  }

  // 同じ hostUserId が複数のサイド/room から出るのは、ハンドル改名で旧 room と新 room が
  // 同じ配信者を指している場合など。二重加算・誤帰属になるのでマッチごと出さない。
  const seen = new Set<string>();
  for (const hosts of hostsBySide.values()) {
    for (const hostUserId of hosts) {
      if (seen.has(hostUserId)) return new Map();
      seen.add(hostUserId);
    }
  }

  for (const [sideId, hosts] of hostsBySide) {
    let total = 0n;
    for (const hostUserId of hosts) total += merged.get(hostUserId) ?? 0n;
    resolved.set(sideId, total.toString());
  }

  return resolved;
}

export type MatchForTiktokScore = {
  detectedBattleId: string | null;
  sides: ScoreSideInput[];
};

/**
 * マッチの各サイドの TikTok バトルスコアを引く。返すのは `sideId -> スコア文字列`。
 *
 * 呼び出し側で「どのマッチに出してよいか」(status / detectionConfidence)を絞ってから渡すこと。
 * ここは絞り込みを知らない。
 */
export async function loadMatchTiktokScores(
  client: DbClient,
  matches: MatchForTiktokScore[]
): Promise<Map<string, string>> {
  const battleIds = [
    ...new Set(matches.flatMap((m) => (m.detectedBattleId === null ? [] : [m.detectedBattleId]))),
  ];
  if (battleIds.length === 0) return new Map();

  const roomIds = [...new Set(matches.flatMap((m) => m.sides.flatMap((s) => s.roomIds)))];

  const [rows, hostUserIdByRoomId] = await Promise.all([
    client.detectedBattle.findMany({
      where: { battleId: { in: battleIds } },
      select: { battleId: true, hostUserIds: true, hostScores: true },
    }),
    fetchRoomHostUserIds(client, roomIds),
  ]);

  const rowsByBattleId = new Map<string, BattleScoreRow[]>();
  for (const row of rows) {
    const list = rowsByBattleId.get(row.battleId);
    if (list) list.push(row);
    else rowsByBattleId.set(row.battleId, [row]);
  }

  const resolved = new Map<string, string>();
  for (const match of matches) {
    if (match.detectedBattleId === null) continue;
    const matchRows = rowsByBattleId.get(match.detectedBattleId);
    if (!matchRows) continue;

    const scores = resolveSideTiktokScores({
      rows: matchRows,
      sides: match.sides,
      hostUserIdByRoomId,
    });
    for (const [sideId, score] of scores) resolved.set(sideId, score);
  }

  return resolved;
}

/** そのマッチでスコアを出してよいか。公開側は誤解のコストが大きいので `exact` に限る。 */
export function canShowTiktokScore(
  match: { status: string; detectionConfidence: string | null },
  audience: "public" | "admin"
): boolean {
  if (!["LIVE", "DETECTED", "FINISHED"].includes(match.status)) return false;
  // partial は「相手が部外者でも唯一候補なら付く」ので、カード上の対戦相手と別の戦いの
  // スコアが載りうる。管理側は detectionConfidence のバッジが出ているので許容する。
  if (audience === "public" && match.detectionConfidence !== "exact") return false;
  return true;
}
