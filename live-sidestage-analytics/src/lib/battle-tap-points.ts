// バトルのタップ点(いいね由来のスコア)の読み出し。
//
// 公式スコアは「ギフト点 x 倍率 + タップ点」で増える。初ギフトx倍の逆算
// (battle-opening-multiplier.ts)はギフトのダイヤ数とスコア増分の比を見るので、タップ点を
// 差し引かないと比が一方向に上振れし、正しい倍率が「判定不能」として棄却される。
//
// **inferOpeningMultiplier() の呼び出し元2箇所(確定時の computeBattleSnapshot と、
// 既確定バトルへの後付けの attachReplayData)が同じ入力を組むための共有ヘルパ。**
// 片方だけ差し引くと、同じバトルの確定値と後付け値が食い違う。

import { prisma } from "@/lib/prisma";
import type { OpeningTapPoint } from "@/lib/battle-opening-multiplier";

export type BattleTapPointInput = {
  tapPoints: OpeningTapPoint[];
  /** バトル開始から取りこぼしなく観測できた anchor。ここに居ない anchor は差し引かない。 */
  tapTrackedAnchorIds: Set<string>;
};

export const EMPTY_TAP_POINT_INPUT: BattleTapPointInput = {
  tapPoints: [],
  tapTrackedAnchorIds: new Set(),
};

/**
 * そのバトルのタップ点と、差し引いてよい anchor の集合を読む。
 *
 * **battleId だけで引き、行の anchorId をそのまま使う。** participant 由来の roomId は介さない
 * (`BattleHistoryParticipant.roomId` は absorbRooms の移送対象に入っていないので、TikTok ID の
 * 改名で room が合流した後は旧 roomId のままになり、移送済みのタップ点に一致しなくなる)。
 *
 * `tapPointsTracked` は room 単位のフラグなので、同じ battleId の TiktokBattle 行
 * (両サイドを監視していれば相手room分も存在する)を読み、その roomId のタップ点が持つ
 * anchorId へ紐づける。
 */
export async function loadTapPointsForBattle(battleId: string): Promise<BattleTapPointInput> {
  const [rows, battles] = await Promise.all([
    prisma.tiktokBattleTapPoint.findMany({
      where: { battleId },
      select: { roomId: true, anchorId: true, occurredAt: true, points: true },
      orderBy: [{ occurredAt: "asc" }, { anchorId: "asc" }],
    }),
    prisma.tiktokBattle.findMany({
      where: { battleId },
      select: { roomId: true, tapPointsTracked: true },
    }),
  ]);

  const trackedRoomIds = new Set(battles.filter((b) => b.tapPointsTracked).map((b) => b.roomId));

  const tapPoints: OpeningTapPoint[] = [];
  const tapTrackedAnchorIds = new Set<string>();
  for (const row of rows) {
    tapPoints.push({ anchorId: row.anchorId, occurredAt: row.occurredAt, points: row.points });
    if (trackedRoomIds.has(row.roomId)) tapTrackedAnchorIds.add(row.anchorId);
  }

  // **タップ点が0件でも計測済みなら anchor を tracked に入れる。** 「誰も10タップに到達しなかった」
  // は正常な観測結果で、差し引き0を適用してよい。行が無いと anchorId が判らないので、
  // TiktokBattle.hostUserIds ではなくこの経路では拾えない anchor が残るが、その場合は
  // 差し引かない(= 従来と同じ判定)ので安全側に倒れる。
  return { tapPoints, tapTrackedAnchorIds };
}
