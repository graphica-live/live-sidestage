// 開催日程(EventSession)の差分更新。**全置換にしない。**
//
// 対戦(`EventMatch.sessionId`)が日程を参照しているので、delete → create で作り直すと
// id が変わって割り当てが壊れる(外部キーは Restrict なのでそもそも消せない)。
//
// **必ず `acquireEventLock` を取った後の同じトランザクションから呼ぶこと。** 状態は
// すべてここで読み直す — トランザクションの外で読んだ一覧のまま判定すると、同時に走った
// 別の更新で消えた日程を「更新」してしまう。

import { formatJstRange } from "./datetime";
import type { NormalizedSession } from "./sessions";
import type { DbClient } from "./analytics-db";

export class SessionUpdateError extends Error {
  constructor(
    message: string,
    readonly code: "UNKNOWN_SESSION" | "SESSION_IN_USE" | "MATCH_OUT_OF_SESSION",
    /** HTTP の応答コード。入力の形式エラー(400)と現在の状態との競合(409)を分ける */
    readonly status: 400 | 409
  ) {
    super(message);
    this.name = "SessionUpdateError";
  }
}

/**
 * 日程を差分更新する。`id` を持つ入力は更新、持たない入力は新規、送られてこなかった
 * 既存の日程は削除。
 *
 * 拒否するのは3つ:
 *
 * - このイベントに存在しない `id`(他人のイベントの日程を書き換えさせない)
 * - 対戦がぶら下がっている日程の削除(**VOID も数える**。参照が残っていれば消せない)
 * - 縮めた日程から**実績のある対戦**がはみ出すこと。見るのは実際に観測した区間だけで、
 *   手動確定しただけの対戦(バトルの時刻を持たない)は対象にしない
 */
export async function applySessionDiff(
  tx: DbClient,
  eventId: string,
  sessions: NormalizedSession[]
): Promise<void> {
  const current = await tx.eventSession.findMany({
    where: { eventId },
    select: { id: true },
  });
  const currentIds = new Set(current.map((s) => s.id));

  const keepIds = new Set<string>();
  for (const session of sessions) {
    if (!session.id) continue;
    if (!currentIds.has(session.id)) {
      throw new SessionUpdateError(
        "このイベントに存在しない開催日程が指定されています。画面を再読み込みしてください。",
        "UNKNOWN_SESSION",
        400
      );
    }
    keepIds.add(session.id);
  }

  const removedIds = [...currentIds].filter((id) => !keepIds.has(id));
  if (removedIds.length > 0) {
    const blocking = await tx.eventMatch.count({
      where: { eventId, sessionId: { in: removedIds } },
    });
    if (blocking > 0) {
      throw new SessionUpdateError(
        `削除しようとした開催日程に対戦が${blocking}件あります。` +
          "先に対戦の日程を変えるか、対戦を削除してください。",
        "SESSION_IN_USE",
        409
      );
    }
  }

  const nextById = new Map(
    sessions.filter((s) => s.id).map((s) => [s.id as string, s] as const)
  );
  if (nextById.size > 0) {
    // **`EventMatch` のミラー列(1件)ではなく、`EventMatchBattleCandidate` の
    // 実効ゲーム集合(`selected=true`)を1件ずつ検証する。** 勝利条件(1本勝負/2本先取)
    // 対応で1対戦カードが複数の検知区間を持ちうるため、代表1件だけを見ると
    // 個々のゲームが日程の外に出ていても素通りしてしまう。
    const detected = await tx.eventMatchBattleCandidate.findMany({
      where: {
        selected: true,
        endedAt: { not: null },
        match: {
          eventId,
          status: { not: "VOID" },
          sessionId: { in: [...nextById.keys()] },
        },
      },
      select: {
        startedAt: true,
        endedAt: true,
        match: { select: { sessionId: true } },
      },
    });
    for (const candidate of detected) {
      const next = nextById.get(candidate.match.sessionId);
      if (!next) continue;
      if (candidate.startedAt < next.startAt || candidate.endedAt! > next.endAt) {
        throw new SessionUpdateError(
          `検知済みの対戦が新しい開催日程の外に出ます(最初は ${formatJstRange(candidate.startedAt, candidate.endedAt!)})。` +
            "先に対戦の検知をやり直すか、日程を見直してください。",
          "MATCH_OUT_OF_SESSION",
          409
        );
      }
    }
  }

  for (const id of removedIds) {
    await tx.eventSession.delete({ where: { id } });
  }

  for (const session of sessions) {
    if (session.id) {
      await tx.eventSession.update({
        where: { id: session.id },
        data: { startAt: session.startAt, endAt: session.endAt, name: session.name },
      });
      // 旧列への dual-write。日程を動かしたら、そこへ割り当てた対戦の旧枠も揃える
      // (読まないが、ローリング更新中の旧コードが参照する)。
      await tx.eventMatch.updateMany({
        where: { eventId, sessionId: session.id },
        data: { scheduledStartAt: session.startAt, scheduledEndAt: session.endAt },
      });
    } else {
      await tx.eventSession.create({
        data: {
          eventId,
          startAt: session.startAt,
          endAt: session.endAt,
          name: session.name,
        },
      });
    }
  }
}
