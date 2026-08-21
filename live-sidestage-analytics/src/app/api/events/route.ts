import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseJstLocal } from "@/event/datetime";
import { buildEventSlug } from "@/event/slug";
import { validateEventInput } from "@/event/validation";

const SLUG_RETRY = 5;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // datetime-local の値はサーバーのタイムゾーンに依存させず JST として解釈する。
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

  // slug はランダム suffix 付きなので実質衝突しないが、unique 制約に任せて数回リトライする。
  for (let attempt = 0; attempt < SLUG_RETRY; attempt++) {
    try {
      const created = await prisma.event.create({
        data: {
          ...validated.value,
          slug: buildEventSlug(validated.value.title),
          ownerUserId: session.user.id,
          status: "DRAFT",
        },
        select: { id: true, slug: true },
      });
      return NextResponse.json(created, { status: 201 });
    } catch (err) {
      const isSlugConflict =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!isSlugConflict) throw err;
    }
  }

  return NextResponse.json({ error: "URLの生成に失敗した。もう一度試すこと。" }, { status: 500 });
}
