// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { autoFinishOverdueEvents, AUTO_FINISH_GRACE_MS } from "./auto-finish";

const PREFIX = "itest_autofinish";
let seq = 0;
const uniqueSuffix = () => `${Date.now()}_${seq++}`;

const createdEventIds: string[] = [];

// `updatedAt` は Prisma の `@updatedAt` が create/update のたびに現在時刻で上書きするため、
// 「猶予より前に更新された」状態をテストで作るには raw SQL で直接書き換える必要がある。
async function createEvent(
  status: "SCHEDULED" | "RUNNING" | "FINISHED" | "ARCHIVED",
  endAt: Date,
  updatedAt?: Date
) {
  const event = await prisma.event.create({
    data: {
      slug: `${PREFIX}-${uniqueSuffix()}`,
      title: `${PREFIX} 自動終了テスト`,
      ownerUserId: `${PREFIX}_owner_${uniqueSuffix()}`,
      format: "DIAMOND_RACE",
      entryMode: "SOLO",
      visibility: "PRIVATE",
      status,
      startAt: new Date(endAt.getTime() - 60 * 60 * 1000),
      endAt,
    },
    select: { id: true },
  });
  createdEventIds.push(event.id);
  if (updatedAt) {
    await prisma.$executeRaw`UPDATE "event"."Event" SET "updatedAt" = ${updatedAt}::timestamptz WHERE id = ${event.id}`;
  }
  return event;
}

afterAll(async () => {
  for (const id of createdEventIds) {
    await prisma.event.delete({ where: { id } }).catch(() => {});
  }
  await prisma.$disconnect();
});

describe("autoFinishOverdueEvents", () => {
  it("endAt + 2日を過ぎてもRUNNINGのままなら FINISHED へ遷移させる", async () => {
    const now = new Date();
    const longAgo = new Date(now.getTime() - AUTO_FINISH_GRACE_MS - 1000);
    const event = await createEvent("RUNNING", longAgo, longAgo);

    const result = await autoFinishOverdueEvents(now);

    expect(result.finished).toBeGreaterThanOrEqual(1);
    const updated = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.status).toBe("FINISHED");
  });

  it("猶予内のRUNNINGは対象にしない", async () => {
    const now = new Date();
    const event = await createEvent("RUNNING", new Date(now.getTime() - 1000));

    await autoFinishOverdueEvents(now);

    const updated = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.status).toBe("RUNNING");
  });

  it("開催準備中(SCHEDULED)のまま放置されたイベントは対象にしない", async () => {
    const now = new Date();
    const longAgo = new Date(now.getTime() - AUTO_FINISH_GRACE_MS - 1000);
    const event = await createEvent("SCHEDULED", longAgo, longAgo);

    await autoFinishOverdueEvents(now);

    const updated = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.status).toBe("SCHEDULED");
  });

  it("すでに FINISHED / ARCHIVED のイベントは触らない", async () => {
    const now = new Date();
    const longAgo = new Date(now.getTime() - AUTO_FINISH_GRACE_MS - 1000);
    const finished = await createEvent("FINISHED", longAgo, longAgo);
    const archived = await createEvent("ARCHIVED", longAgo, longAgo);

    await autoFinishOverdueEvents(now);

    expect((await prisma.event.findUniqueOrThrow({ where: { id: finished.id } })).status).toBe("FINISHED");
    expect((await prisma.event.findUniqueOrThrow({ where: { id: archived.id } })).status).toBe("ARCHIVED");
  });

  it("endAtは猶予を過ぎていても、主催者が最近手動でRUNNINGへ戻したイベントは対象にしない", async () => {
    const now = new Date();
    const longAgo = new Date(now.getTime() - AUTO_FINISH_GRACE_MS - 1000);
    // endAtは猶予を過ぎているが、updatedAt(手動でRUNNINGへ戻した時刻)は猶予内。
    const event = await createEvent("RUNNING", longAgo, new Date(now.getTime() - 1000));

    const result = await autoFinishOverdueEvents(now);

    expect(result.finished).toBe(0);
    const updated = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.status).toBe("RUNNING");
  });
});
