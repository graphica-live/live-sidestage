import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseJstLocal } from "@/lib/datetime";
import { EVENT_STATUSES, validateEventInput, type EventStatus } from "@/lib/validation";

async function requireOwnedEvent(id: string): Promise<{ ownerUserId: string } | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const event = await prisma.event.findUnique({
    where: { id },
    select: { ownerUserId: true },
  });
  if (!event || event.ownerUserId !== session.user.id) return null;

  return event;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireOwnedEvent(params.id);
  if (!owned) {
    // 存在しないのか権限がないのかを区別しない(他人のイベントIDの存在を漏らさない)。
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // ステータス変更だけの更新
  if (typeof body.status === "string" && body.title === undefined) {
    if (!EVENT_STATUSES.includes(body.status as EventStatus)) {
      return NextResponse.json({ errors: ["ステータスの指定が不正です。"] }, { status: 400 });
    }
    const updated = await prisma.event.update({
      where: { id: params.id },
      data: { status: body.status },
      select: { id: true, slug: true, status: true },
    });
    return NextResponse.json(updated);
  }

  const startAt = parseJstLocal(String(body.startAt ?? ""));
  const endAt = parseJstLocal(String(body.endAt ?? ""));
  if (!startAt || !endAt) {
    return NextResponse.json({ errors: ["開始日時と終了日時を入力してください。"] }, { status: 400 });
  }

  const validated = validateEventInput({
    title: String(body.title ?? ""),
    description: body.description == null ? null : String(body.description),
    format: String(body.format ?? ""),
    entryMode: String(body.entryMode ?? ""),
    teamPreset: body.teamPreset == null ? undefined : String(body.teamPreset),
    visibility: body.visibility == null ? undefined : String(body.visibility),
    startAt,
    endAt,
  });

  if (!validated.ok) {
    return NextResponse.json({ errors: validated.errors }, { status: 400 });
  }

  const updated = await prisma.event.update({
    where: { id: params.id },
    data: validated.value,
    select: { id: true, slug: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireOwnedEvent(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.event.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
