import { prisma } from "@/lib/prisma";

// 開催終了(endAt到来)後も主催者がstatusをFINISHEDへ切り替え忘れ、RUNNINGのまま
// 放置され続けるイベントを自動的にFINISHEDへ遷移させる。
//
// **これは表示上の状態合わせでしかなく、集計・監視のロジックには一切影響しない。**
// 「終了判定にstatusを使わない」という既存原則(status-transition.ts / docs/EVENT.md)は
// そのまま — 集計の打ち切りは今までどおり締切(endAt + AGGREGATE_GRACE_MS)後の
// finalizedAt確定で行い、room監視の終了も今までどおりmonitorUntil(endAt + LEASE_GRACE_MS)
// の失効で行う。ここで書き換えるのはEvent.statusだけ。

/** 開催終了からRUNNINGのまま放置されているイベントを自動でFINISHEDにするまでの猶予。 */
export const AUTO_FINISH_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * `endAt` + 猶予を過ぎてもなお `RUNNING` のイベントを `FINISHED` へ遷移させる。
 *
 * 対象は `RUNNING` だけ(`status-transition.ts` の `STATUS_TRANSITIONS` で
 * `RUNNING → FINISHED` が許可されている遷移そのもの)。`SCHEDULED` のまま
 * 放置されたイベントは対象にしない — 開催準備中のまま終了扱いにすると、
 * 一度も開催中にならなかったイベントの意味が変わってしまう。
 *
 * **`updatedAt` も猶予より前であることを要求する。** 主催者が結果修正のため
 * `FINISHED` → `RUNNING` へ手動で戻す(`reopenAggregation()` 経由)と `updatedAt` が
 * 更新される。この条件が無いと、`endAt` が2日以上前の(=大抵のケースに該当する)
 * イベントを手動で再開した直後、次の周回(最大1時間後)でサイレントに `FINISHED` へ
 * 戻されてしまう — 主催者の明示操作を無言で覆すことになるため、猶予期間ぶんは
 * 対象から除外する。
 */
export async function autoFinishOverdueEvents(now: Date = new Date()): Promise<{ finished: number }> {
  const threshold = new Date(now.getTime() - AUTO_FINISH_GRACE_MS);
  const targets = await prisma.event.findMany({
    where: { status: "RUNNING", endAt: { lt: threshold }, updatedAt: { lt: threshold } },
    select: { id: true },
  });
  if (targets.length === 0) return { finished: 0 };

  const result = await prisma.event.updateMany({
    where: { id: { in: targets.map((t) => t.id) }, status: "RUNNING" },
    data: { status: "FINISHED" },
  });
  if (result.count > 0) {
    console.log(`[auto-finish] 自動終了: ${targets.map((t) => t.id).join(", ")}`);
  }
  return { finished: result.count };
}
