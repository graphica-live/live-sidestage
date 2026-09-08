// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { addAmbassadorByEmail, claimAmbassadorInviteForNewUser, createInvite } from "./ambassador";

const PREFIX = "itest_ambassador";
let seq = 0;
const unique = () => `${PREFIX}_${Date.now()}_${seq++}`;

const userIds: string[] = [];
const inviteIds: string[] = [];

async function createUser(): Promise<string> {
  const user = await prisma.user.create({
    data: { email: `${unique()}@example.test` },
    select: { id: true },
  });
  userIds.push(user.id);
  return user.id;
}

afterEach(async () => {
  await prisma.ambassador.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.ambassadorInvite.deleteMany({ where: { id: { in: inviteIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  userIds.length = 0;
  inviteIds.length = 0;
});

describe("claimAmbassadorInviteForNewUser", () => {
  it("有効な招待を先着1名だけが消費してAmbassadorになる", async () => {
    const invite = await createInvite();
    inviteIds.push(invite.id);
    const userId = await createUser();

    const result = await claimAmbassadorInviteForNewUser(invite.token, userId);
    expect(result.ok).toBe(true);

    const ambassador = await prisma.ambassador.findUnique({ where: { userId } });
    expect(ambassador).not.toBeNull();

    const usedInvite = await prisma.ambassadorInvite.findUnique({ where: { id: invite.id } });
    expect(usedInvite?.usedAt).not.toBeNull();
    expect(usedInvite?.usedByUserId).toBe(userId);
  });

  it("同一招待を2人目が消費しようとすると失敗し、1人目のAmbassadorだけが残る", async () => {
    const invite = await createInvite();
    inviteIds.push(invite.id);
    const firstUserId = await createUser();
    const secondUserId = await createUser();

    const first = await claimAmbassadorInviteForNewUser(invite.token, firstUserId);
    expect(first.ok).toBe(true);

    const second = await claimAmbassadorInviteForNewUser(invite.token, secondUserId);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("invalid_or_used");

    const secondAmbassador = await prisma.ambassador.findUnique({ where: { userId: secondUserId } });
    expect(secondAmbassador).toBeNull();
  });

  it("期限切れの招待はclaimできない", async () => {
    const invite = await createInvite(-1);
    inviteIds.push(invite.id);
    const userId = await createUser();

    const result = await claimAmbassadorInviteForNewUser(invite.token, userId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_or_used");
  });

  it("存在しないtokenはclaimできない", async () => {
    const userId = await createUser();
    const result = await claimAmbassadorInviteForNewUser("nonexistent-token", userId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_or_used");
  });

  it("既にAmbassadorのuserIdが別の招待をclaimしようとすると招待は未消費のまま残る", async () => {
    const invite = await createInvite();
    inviteIds.push(invite.id);
    const userId = await createUser();
    await prisma.ambassador.create({ data: { userId } });

    const result = await claimAmbassadorInviteForNewUser(invite.token, userId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("already_ambassador");

    const untouchedInvite = await prisma.ambassadorInvite.findUnique({ where: { id: invite.id } });
    expect(untouchedInvite?.usedAt).toBeNull();
  });
});

describe("addAmbassadorByEmail", () => {
  it("空文字・空白のみのメールアドレスはinvalidを返す", async () => {
    const empty = await addAmbassadorByEmail("");
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.code).toBe("invalid");

    const blank = await addAmbassadorByEmail("   ");
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.code).toBe("invalid");
  });

  it("未登録のメールアドレスはnot_foundを返す", async () => {
    const result = await addAmbassadorByEmail(`${unique()}-not-registered@example.test`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("not_found");
  });

  it("前後空白・大文字混在のメールアドレスも正規化して既存ユーザーを見つける", async () => {
    const email = `${unique()}@example.test`;
    const user = await prisma.user.create({ data: { email }, select: { id: true } });
    userIds.push(user.id);

    const result = await addAmbassadorByEmail(`  ${email.toUpperCase()}  `);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ambassador.userId).toBe(user.id);
  });

  it("既にアンバサダーのユーザーを重複追加しようとするとduplicateを返す", async () => {
    const email = `${unique()}@example.test`;
    const user = await prisma.user.create({ data: { email }, select: { id: true } });
    userIds.push(user.id);

    const first = await addAmbassadorByEmail(email);
    expect(first.ok).toBe(true);

    const second = await addAmbassadorByEmail(email);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("duplicate");
  });
});
