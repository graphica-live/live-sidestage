import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildEventSlug } from "@/event/slug";
import { parseSessionRequest } from "@/event/sessions";
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
  // `sessions` が無い body は、開始・終了を1日程とみなす(旧形式のクライアント)。
  const parsedSessions = parseSessionRequest(
    body.sessions !== undefined ? body.sessions : [{ startAt: body.startAt, endAt: body.endAt }]
  );
  if (!parsedSessions.ok) {
    return NextResponse.json({ errors: parsedSessions.errors }, { status: 400 });
  }

  const validated = validateEventInput({
    title: String(body.title ?? ""),
    description: body.description == null ? null : String(body.description),
    format: String(body.format ?? ""),
    entryMode: String(body.entryMode ?? ""),
    teamPreset: body.teamPreset == null ? undefined : String(body.teamPreset),
    visibility: body.visibility == null ? undefined : String(body.visibility),
    sessions: parsedSessions.value,
    prizeText: body.prizeText == null ? null : String(body.prizeText),
    noticeText: body.noticeText == null ? null : String(body.noticeText),
    matchRules: body.matchRules,
    bracketMethod: body.bracketMethod,
  });

  if (!validated.ok) {
    return NextResponse.json({ errors: validated.errors }, { status: 400 });
  }

  // 新規作成なので既存の rules(deathmatch名前空間等)は無い。マージ不要でそのまま書く。
  const { sessions, matchRules, bracketMethod, ...event } = validated.value;

  // slug はランダム suffix 付きなので実質衝突しないが、unique 制約に任せて数回リトライする。
  for (let attempt = 0; attempt < SLUG_RETRY; attempt++) {
    try {
      const created = await prisma.event.create({
        data: {
          ...event,
          rules: { matchRules, bracket: { method: bracketMethod } },
          slug: buildEventSlug(event.title),
          ownerUserId: session.user.id,
          status: "SCHEDULED",
          // 外枠(startAt/endAt)と日程は必ず同じトランザクションで書く。
          sessions: { create: sessions },
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
