// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { runAmbassadorInviteRetentionCycle } from "./ambassador-invite-retention";

const PREFIX = "itest_ambassador_invite_retention";
let seq = 0;
const uniqueToken = () => `${PREFIX}_${Date.now()}_${seq++}`;

const NOW = new Date();
const EXPIRED_AT = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
const ACTIVE_AT = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);

const inviteIds: string[] = [];

async function createInvite(expiresAt: Date): Promise<string> {
  const invite = await prisma.ambassadorInvite.create({
    data: { token: uniqueToken(), expiresAt },
    select: { id: true },
  });
  inviteIds.push(invite.id);
  return invite.id;
}

afterAll(async () => {
  if (inviteIds.length > 0) {
    await prisma.ambassadorInvite.deleteMany({ where: { id: { in: inviteIds } } });
  }
});

describe("runAmbassadorInviteRetentionCycle", () => {
  it("dry-runでは何も削除せず、期限切れ件数だけ報告する", async () => {
    const expiredId = await createInvite(EXPIRED_AT);
    const activeId = await createInvite(ACTIVE_AT);

    const result = await runAmbassadorInviteRetentionCycle({ dryRun: true, now: NOW });
    expect(result.dryRun).toBe(true);
    if (result.dryRun) expect(result.deletableRows).toBeGreaterThanOrEqual(1);

    const stillThere = await prisma.ambassadorInvite.findMany({
      where: { id: { in: [expiredId, activeId] } },
    });
    expect(stillThere).toHaveLength(2);
  });

  it("dryRun:falseで期限切れの招待だけ削除し、有効な招待は残す", async () => {
    const expiredId = await createInvite(EXPIRED_AT);
    const activeId = await createInvite(ACTIVE_AT);

    const result = await runAmbassadorInviteRetentionCycle({ dryRun: false, now: NOW });
    expect(result.dryRun).toBe(false);
    if (!result.dryRun) expect(result.deletedRows).toBeGreaterThanOrEqual(1);

    const expired = await prisma.ambassadorInvite.findUnique({ where: { id: expiredId } });
    expect(expired).toBeNull();

    const active = await prisma.ambassadorInvite.findUnique({ where: { id: activeId } });
    expect(active).not.toBeNull();
  });

  it("使用済みかどうかを問わず期限切れなら削除する", async () => {
    const usedExpiredId = await createInvite(EXPIRED_AT);
    await prisma.ambassadorInvite.update({
      where: { id: usedExpiredId },
      data: { usedAt: NOW },
    });

    await runAmbassadorInviteRetentionCycle({ dryRun: false, now: NOW });

    const usedExpired = await prisma.ambassadorInvite.findUnique({ where: { id: usedExpiredId } });
    expect(usedExpired).toBeNull();
  });
});
