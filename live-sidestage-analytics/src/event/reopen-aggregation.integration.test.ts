// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
//
// `reopenAggregation()` の締切ガード(終了 + AGGREGATE_GRACE_MS = 1週間)を実DBで固定する。
// このガードがあるからこそ、90日retentionの削除ガードは「未確定(`finalizedAt IS NULL`)の
// イベントだけ保護すればよい」まで単純化できる(src/lib/gift-retention.ts の不変条件5)。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { AGGREGATE_GRACE_MS } from "./aggregate-deadline";
import {
  AggregationDeadlinePassedError,
  isAggregationDeadlinePassed,
  reopenAggregation,
} from "./reopen-aggregation";

const PREFIX = "itest_reopen";
let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const eventIds: string[] = [];

async function createEvent(params: { endAt: Date; finalizedAt: Date | null }) {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 締切ガード`,
      ownerUserId: `${PREFIX}_owner`,
      format: "DIAMOND_RACE",
      entryMode: "SOLO",
      status: "FINISHED",
      startAt: new Date(params.endAt.getTime() - 86_400_000),
      endAt: params.endAt,
      finalizedAt: params.finalizedAt,
    },
    select: { id: true },
  });
  eventIds.push(event.id);
  return event.id;
}

afterAll(async () => {
  if (eventIds.length > 0) {
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  }
});

describe("reopenAggregation() の締切ガード", () => {
  it("締切前の確定済みイベントは従来どおり finalizedAt を戻せる", async () => {
    const eventId = await createEvent({
      endAt: new Date(Date.now() - 60_000),
      finalizedAt: new Date(),
    });

    await prisma.$transaction(async (tx) => {
      await reopenAggregation(tx, eventId);
    });

    const after = await prisma.event.findUnique({
      where: { id: eventId },
      select: { finalizedAt: true },
    });
    expect(after?.finalizedAt).toBeNull();
  });

  it("締切(終了+1週間)を過ぎた確定済みイベントは例外になり、finalizedAt は変化しない", async () => {
    const finalizedAt = new Date();
    const eventId = await createEvent({
      endAt: new Date(Date.now() - AGGREGATE_GRACE_MS - 60_000),
      finalizedAt,
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await reopenAggregation(tx, eventId);
      })
    ).rejects.toBeInstanceOf(AggregationDeadlinePassedError);

    const after = await prisma.event.findUnique({
      where: { id: eventId },
      select: { finalizedAt: true },
    });
    expect(after?.finalizedAt?.getTime()).toBe(finalizedAt.getTime());
  });

  it("例外が投げられると呼び出し元のトランザクション全体がロールバックする", async () => {
    const eventId = await createEvent({
      endAt: new Date(Date.now() - AGGREGATE_GRACE_MS - 60_000),
      finalizedAt: new Date(),
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.event.update({ where: { id: eventId }, data: { title: "変更後タイトル" } });
        await reopenAggregation(tx, eventId);
      })
    ).rejects.toSatisfy(isAggregationDeadlinePassed);

    const after = await prisma.event.findUnique({
      where: { id: eventId },
      select: { title: true },
    });
    expect(after?.title).toBe(`${PREFIX} 締切ガード`);
  });

  it("未確定(finalizedAt IS NULL)なら締切を過ぎていても no-op として通る", async () => {
    // 戻すべき finalizedAt が無い以上「確定済みの結果を覆す」操作ではないので、
    // 締切を過ぎた未確定イベントへの通常のミューテーションを巻き添えで失敗させない。
    const eventId = await createEvent({
      endAt: new Date(Date.now() - AGGREGATE_GRACE_MS - 60_000),
      finalizedAt: null,
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await reopenAggregation(tx, eventId);
      })
    ).resolves.toBeUndefined();
  });

  it("存在しないイベントは従来どおり no-op", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await reopenAggregation(tx, `${PREFIX}_missing_${uniqueSuffix()}`);
      })
    ).resolves.toBeUndefined();
  });
});
