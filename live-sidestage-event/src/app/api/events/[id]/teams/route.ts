import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireEventOwner } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { findPrefecture } from "@/lib/prefecture";
import { MAX_TEAMS, validateTeamInput, type TeamPreset } from "@/lib/validation";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { entryMode: true, teamPreset: true, _count: { select: { teams: true } } },
  });
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (event.entryMode !== "TEAM") {
    return NextResponse.json({ error: "個人戦のイベントにはチームを作れない。" }, { status: 400 });
  }
  if (event._count.teams >= MAX_TEAMS) {
    return NextResponse.json({ errors: [`チームは${MAX_TEAMS}個までです。`] }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    colorHex?: string | null;
    prefectureCode?: string | null;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const validated = validateTeamInput(
    {
      name: String(body.name ?? ""),
      colorHex: body.colorHex ?? null,
      prefectureCode: body.prefectureCode ?? null,
      teamPreset: event.teamPreset as TeamPreset,
    },
    (code) => findPrefecture(code)?.name ?? null
  );
  if (!validated.ok) {
    return NextResponse.json({ errors: validated.errors }, { status: 400 });
  }

  try {
    const created = await prisma.eventTeam.create({
      data: {
        eventId: params.id,
        ...validated.value,
        sortOrder: event._count.teams,
      },
      select: { id: true, name: true, colorHex: true, prefectureCode: true },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "同じチームがすでにある。" }, { status: 409 });
    }
    throw err;
  }
}
