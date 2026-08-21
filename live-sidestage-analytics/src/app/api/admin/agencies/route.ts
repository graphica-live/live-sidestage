import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

// 事務所の承認は管理者操作。Googleログインは一般公開されているため、
// 承認なしで監視対象を追加できるとアカウントを量産するだけでTikTok接続枠を消費できてしまう。
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agencies = await prisma.agency.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      approved: true,
      approvedAt: true,
      maxWatchTargets: true,
      createdAt: true,
      user: { select: { email: true } },
      _count: { select: { watches: true } },
    },
  });

  return NextResponse.json({
    agencies: agencies.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.user.email,
      approved: a.approved,
      approvedAt: a.approvedAt?.toISOString() ?? null,
      maxWatchTargets: a.maxWatchTargets,
      watchCount: a._count.watches,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { id?: unknown; approved?: unknown; maxWatchTargets?: unknown }
    | null;

  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "idを指定してください。" }, { status: 400 });

  const data: { approved?: boolean; approvedAt?: Date | null; maxWatchTargets?: number } = {};

  if (typeof body?.approved === "boolean") {
    data.approved = body.approved;
    data.approvedAt = body.approved ? new Date() : null;
  }

  if (body?.maxWatchTargets !== undefined) {
    const max = Number(body.maxWatchTargets);
    if (!Number.isInteger(max) || max < 0 || max > 1000) {
      return NextResponse.json(
        { error: "maxWatchTargetsは0〜1000の整数で指定してください。" },
        { status: 400 }
      );
    }
    data.maxWatchTargets = max;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "変更内容がありません。" }, { status: 400 });
  }

  const updated = await prisma.agency.update({
    where: { id },
    data,
    select: { id: true, approved: true, approvedAt: true, maxWatchTargets: true },
  });

  return NextResponse.json({
    agency: {
      id: updated.id,
      approved: updated.approved,
      approvedAt: updated.approvedAt?.toISOString() ?? null,
      maxWatchTargets: updated.maxWatchTargets,
    },
  });
}
