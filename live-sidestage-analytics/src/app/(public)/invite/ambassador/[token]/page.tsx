import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AmbassadorInvitePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const invite = await prisma.ambassadorInvite.findUnique({
    where: { token: params.token },
    select: { usedAt: true, expiresAt: true },
  });
  const valid = invite && invite.usedAt === null && invite.expiresAt > new Date();
  const showError = !valid || searchParams.error === "invalid";

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card max-w-md w-full space-y-4 text-center">
        <h1 className="text-lg font-bold text-brand">アンバサダー招待</h1>
        {showError ? (
          <p className="text-sm text-muted">
            この招待URLは無効です。期限切れ、または既に使用されている可能性があります。
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">
              このURLからアカウントを新規作成すると、アンバサダーとしてPROプランを無料でご利用いただけます。
            </p>
            <a
              href={`/api/ambassador/invite/start?token=${encodeURIComponent(params.token)}`}
              className="btn-primary w-full inline-block text-sm"
            >
              Googleでサインアップ
            </a>
          </>
        )}
      </div>
    </div>
  );
}
