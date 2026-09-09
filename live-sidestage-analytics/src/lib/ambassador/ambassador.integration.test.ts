// ローカルテストDBが必要。`npm run test:integration` 経由で実行すること。
import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { addAmbassadorByEmail, claimAmbassadorInviteForNewUser, createInvite } from "./ambassador";

const PREFIX = "itest_ambassador";
let seq = 0;
const unique = () => `${PREFIX}_${Date.now()}_${seq++}`;

const principalIds: string[] = [];
const inviteIds: string[] = [];

async function createUser(): Promise<string> {
  const user = await prisma.principal.create({
    data: { email: `${unique()}@example.test` },
    select: { id: true },
  });
  principalIds.push(user.id);
  return user.id;
}

afterEach(async () => {
  await prisma.ambassador.deleteMany({ where: { principalId: { in: principalIds } } });
  await prisma.ambassadorInvite.deleteMany({ where: { id: { in: inviteIds } } });
  await prisma.principal.deleteMany({ where: { id: { in: principalIds } } });
  principalIds.length = 0;
  inviteIds.length = 0;
});

describe("claimAmbassadorInviteForNewUser", () => {
  it("有効な招待を先着1名だけが消費してAmbassadorになる", async () => {
    const invite = await createInvite();
    inviteIds.push(invite.id);
    const principalId = await createUser();

    const result = await claimAmbassadorInviteForNewUser(invite.token, principalId);
    expect(result.ok).toBe(true);

    const ambassador = await prisma.ambassador.findUnique({ where: { principalId } });
    expect(ambassador).not.toBeNull();

    const usedInvite = await prisma.ambassadorInvite.findUnique({ where: { id: invite.id } });
    expect(usedInvite?.usedAt).not.toBeNull();
    expect(usedInvite?.usedByPrincipalId).toBe(principalId);
  });

  it("同一招待を2人目が消費しようとすると失敗し、1人目のAmbassadorだけが残る", async () => {
    const invite = await createInvite();
    inviteIds.push(invite.id);
    const firstPrincipalId = await createUser();
    const secondPrincipalId = await createUser();

    const first = await claimAmbassadorInviteForNewUser(invite.token, firstPrincipalId);
    expect(first.ok).toBe(true);

    const second = await claimAmbassadorInviteForNewUser(invite.token, secondPrincipalId);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("invalid_or_used");

    const secondAmbassador = await prisma.ambassador.findUnique({ where: { principalId: secondPrincipalId } });
    expect(secondAmbassador).toBeNull();
  });

  it("期限切れの招待はclaimできない", async () => {
    const invite = await createInvite(-1);
    inviteIds.push(invite.id);
    const principalId = await createUser();

    const result = await claimAmbassadorInviteForNewUser(invite.token, principalId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_or_used");
  });

  it("存在しないtokenはclaimできない", async () => {
    const principalId = await createUser();
    const result = await claimAmbassadorInviteForNewUser("nonexistent-token", principalId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_or_used");
  });

  it("既にAmbassadorのprincipalIdが別の招待をclaimしようとすると招待は未消費のまま残る", async () => {
    const invite = await createInvite();
    inviteIds.push(invite.id);
    const principalId = await createUser();
    await prisma.ambassador.create({ data: { principalId } });

    const result = await claimAmbassadorInviteForNewUser(invite.token, principalId);
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
    const user = await prisma.principal.create({ data: { email }, select: { id: true } });
    principalIds.push(user.id);

    const result = await addAmbassadorByEmail(`  ${email.toUpperCase()}  `);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ambassador.principalId).toBe(user.id);
  });

  it("既にアンバサダーのユーザーを重複追加しようとするとduplicateを返す", async () => {
    const email = `${unique()}@example.test`;
    const user = await prisma.principal.create({ data: { email }, select: { id: true } });
    principalIds.push(user.id);

    const first = await addAmbassadorByEmail(email);
    expect(first.ok).toBe(true);

    const second = await addAmbassadorByEmail(email);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("duplicate");
  });
});
