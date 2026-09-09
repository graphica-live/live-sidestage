import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/agency/agency";

const INVITE_EXPIRES_IN_DAYS = 30;

export type AmbassadorInviteRecord = {
  id: string;
  token: string;
  createdAt: string;
  expiresAt: string;
};

export type AmbassadorRecord = {
  id: string;
  principalId: string;
  createdAt: string;
  userEmail: string | null;
  userName: string | null;
};

function generateInviteToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

// 招待URLを1件発行する。同時に複数発行してよい(tokenはそれぞれ独立)。
export async function createInvite(
  expiresInDays: number = INVITE_EXPIRES_IN_DAYS
): Promise<AmbassadorInviteRecord> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);
  const invite = await prisma.ambassadorInvite.create({
    data: { token: generateInviteToken(), expiresAt },
    select: { id: true, token: true, createdAt: true, expiresAt: true },
  });
  return {
    id: invite.id,
    token: invite.token,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt.toISOString(),
  };
}

// 未使用かつ期限内の招待一覧(管理画面表示用)。使用済み・期限切れは
// ambassador-invite-retention.ts の定期削除に任せてここには出さない。
export async function listActiveInvites(): Promise<AmbassadorInviteRecord[]> {
  const invites = await prisma.ambassadorInvite.findMany({
    where: { usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, token: true, createdAt: true, expiresAt: true },
  });
  return invites.map((i) => ({
    id: i.id,
    token: i.token,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
  }));
}

// 未使用の招待を即時失効させる(削除)。使用済みの招待は消せない
// (すでにAmbassadorが確定しているため、取り消しはremoveAmbassadorで行う)。
export async function revokeInvite(id: string): Promise<boolean> {
  const result = await prisma.ambassadorInvite.deleteMany({ where: { id, usedAt: null } });
  return result.count > 0;
}

export async function listAmbassadors(): Promise<AmbassadorRecord[]> {
  const ambassadors = await prisma.ambassador.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      principalId: true,
      createdAt: true,
      user: { select: { email: true, name: true } },
    },
  });
  return ambassadors.map((a) => ({
    id: a.id,
    principalId: a.principalId,
    createdAt: a.createdAt.toISOString(),
    userEmail: a.user.email,
    userName: a.user.name,
  }));
}

export type AddAmbassadorResult =
  | { ok: true; ambassador: AmbassadorRecord }
  | { ok: false; code: "not_found" | "duplicate" | "invalid"; error: string };

// 既存ユーザーをメールアドレスで検索して直接アンバサダーに指定する。
export async function addAmbassadorByEmail(rawEmail: string): Promise<AddAmbassadorResult> {
  const email = normalizeEmail(rawEmail ?? "");
  if (!email) return { ok: false, code: "invalid", error: "メールアドレスを入力してください。" };

  const user = await prisma.principal.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    return { ok: false, code: "not_found", error: "このメールアドレスのユーザーが見つかりません。" };
  }

  try {
    const ambassador = await prisma.ambassador.create({
      data: { principalId: user.id },
      select: {
        id: true,
        principalId: true,
        createdAt: true,
        user: { select: { email: true, name: true } },
      },
    });
    return {
      ok: true,
      ambassador: {
        id: ambassador.id,
        principalId: ambassador.principalId,
        createdAt: ambassador.createdAt.toISOString(),
        userEmail: ambassador.user.email,
        userName: ambassador.user.name,
      },
    };
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      return { ok: false, code: "duplicate", error: "このユーザーはすでにアンバサダーです。" };
    }
    throw err;
  }
}

export type RemoveAmbassadorResult = {
  removed: boolean;
  /** 差額ULTRA(アンバサダー特典)を購読中に解除された場合の警告。Stripe側の実契約は自動で変更しない。 */
  hadActiveAmbassadorUltraSubscription: boolean;
};

// アンバサダー資格を外す。Stripe側の既存購読(差額ULTRA等)は自動キャンセルしない
// (要件外。解除前にStripe管理画面側で契約を確認するようUI側で案内する)。
export async function removeAmbassador(id: string): Promise<RemoveAmbassadorResult> {
  const ambassador = await prisma.ambassador.findUnique({ where: { id }, select: { principalId: true } });
  if (!ambassador) return { removed: false, hadActiveAmbassadorUltraSubscription: false };

  const activeUltra = await prisma.subscription.findFirst({
    where: {
      principalId: ambassador.principalId,
      plan: "ULTRA",
      entitlementActive: true,
      OR: [{ provider: null }, { provider: "STRIPE" }],
    },
    select: { id: true },
  });

  const result = await prisma.ambassador.deleteMany({ where: { id } });
  return { removed: result.count > 0, hadActiveAmbassadorUltraSubscription: Boolean(activeUltra) };
}

export type ClaimInviteResult = { ok: true } | { ok: false; reason: "invalid_or_used" | "already_ambassador" };

// 招待URL経由で新規作成されたUserだけがここへ到達する(呼び出し元:
// authOptions.events.createUser)。updateManyの条件付き更新で「先着1名」を
// 原子的に決定し、成功した場合だけAmbassador作成まで同一トランザクションで行う。
// Ambassador作成が失敗した場合は招待の消費ごとロールバックし、招待を再利用可能な
// ままにする(招待だけ失われて誰もアンバサダーになれない状態を防ぐ)。
export async function claimAmbassadorInviteForNewUser(
  token: string,
  principalId: string
): Promise<ClaimInviteResult> {
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const consumed = await tx.ambassadorInvite.updateMany({
        where: { token, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now, usedByPrincipalId: principalId },
      });
      if (consumed.count !== 1) return { ok: false, reason: "invalid_or_used" as const };

      await tx.ambassador.create({ data: { principalId } });
      return { ok: true as const };
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      // 同一User(重複createUserイベント等)が既にAmbassadorだった場合。
      // $transaction内の例外なのでupdateManyの招待消費もロールバック済み
      // (招待は未消費のまま残るので、別の人が引き続き使える)。
      return { ok: false, reason: "already_ambassador" };
    }
    throw err;
  }
}
