import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createAgency, getAgencyByUserId } from "@/lib/agency/agency";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agency = await getAgencyByUserId(session.user.id);
  return NextResponse.json({ agency });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await getAgencyByUserId(session.user.id);
  if (existing) {
    return NextResponse.json({ error: "すでに事務所が作成されています。" }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "事務所名を入力してください。" }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "事務所名は100文字以内で入力してください。" }, { status: 400 });
  }

  const agency = await createAgency(session.user.id, name);
  return NextResponse.json({ agency }, { status: 201 });
}
