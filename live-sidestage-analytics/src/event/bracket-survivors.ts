import type { BracketMatchDto, BracketSideDto } from "./public-event";

// 公開トーナメント表で「まだ敗退していない参加者/チームが勝った試合」を求める。
// BracketTree.tsx がこの集合に入っている match.id のカードだけ、生存ツリーの
// 装飾(赤枠+走光)を出す。
//
// 出場者/チームの同一性は sideEntrants(sorted participantId 結合)で追跡する。
// tournament.ts は表生成時点で全ラウンドのサイドを作り、勝ち上がりのたびに
// match-results.ts が勝者の participantId 群をそのまま下流へコピーするので、
// このキーはラウンドをまたいで安定する(チームの途中組み替えは仕様上ない)。

function sideKey(side: Pick<BracketSideDto, "entrants">): string | null {
  if (side.entrants.length === 0) return null;
  return side.entrants
    .map((e) => e.participantId)
    .sort()
    .join(",");
}

type SurvivorMatch = Pick<BracketMatchDto, "id" | "status" | "sides">;

/**
 * 敗退済みキーの集合。次の2パターンで敗退とみなす:
 *
 * - 決着済み試合(いずれかの side が isWinner)の、勝者でない側
 * - VOID になった試合の両側 — 勝者なしで下流の枠を空にする(match-results.ts)ので、
 *   敗北ではないがそこで進めなくなる
 *
 * NO_SHOW は主催者が後から手動確定できる保留状態なので、ここでは敗退にしない
 * (両者とも生存のまま扱う)。
 */
function findEliminatedKeys(matches: SurvivorMatch[]): Set<string> {
  const eliminated = new Set<string>();

  for (const match of matches) {
    if (match.status === "VOID") {
      for (const side of match.sides) {
        const k = sideKey(side);
        if (k) eliminated.add(k);
      }
      continue;
    }

    const hasWinner = match.sides.some((s) => s.isWinner);
    if (!hasWinner) continue;

    for (const side of match.sides) {
      if (side.isWinner) continue;
      const k = sideKey(side);
      if (k) eliminated.add(k);
    }
  }

  return eliminated;
}

/**
 * まだ敗退していない出場者/チームが勝った試合の id 集合を返す。
 *
 * `finalMatchId` を渡すと、その試合(決勝)は結果集合には含めない
 * (決勝は専用の枠+優勝バナーを既に持つため)。ただし決勝の敗者を捕まえる
 * 必要があるので、`findEliminatedKeys` の計算には決勝も含めたまま渡すこと。
 */
export function findSurvivorMatchIds(
  matches: SurvivorMatch[],
  finalMatchId?: string
): Set<string> {
  const eliminated = findEliminatedKeys(matches);
  const survivorMatchIds = new Set<string>();

  for (const match of matches) {
    if (match.id === finalMatchId) continue;
    const winner = match.sides.find((s) => s.isWinner);
    if (!winner) continue;
    const k = sideKey(winner);
    if (k && !eliminated.has(k)) survivorMatchIds.add(match.id);
  }

  return survivorMatchIds;
}
