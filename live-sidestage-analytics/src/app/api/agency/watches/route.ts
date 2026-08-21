import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { agencyAuthOptions } from "@/lib/agency/auth";
import { addWatch, getAgencyByEmail, listWatches } from "@/lib/agency/agency";

const STATUS_BY_CODE = {
  invalid: 400,
  limit: 400,
  duplicate: 409,
  conflict: 409,
} as const;

export async function GET() {
  const session = await getServerSession(agencyAuthOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agency = await getAgencyByEmail(session.user.email);
  if (!agency) return NextResponse.json({ error: "事務所情報が見つかりません。" }, { status: 404 });

  const watches = await listWatches(agency.id);
  return NextResponse.json({
    watches,
    maxWatchTargets: agency.maxWatchTargets,
    remaining: Math.max(0, agency.maxWatchTargets - watches.length),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(agencyAuthOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agency = await getAgencyByEmail(session.user.email);
  if (!agency) return NextResponse.json({ error: "事務所情報が見つかりません。" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as
    | { tiktokId?: unknown; label?: unknown }
    | null;
  const tiktokId = typeof body?.tiktokId === "string" ? body.tiktokId : "";
  const label = typeof body?.label === "string" ? body.label : null;

  if (label && label.trim().length > 100) {
    return NextResponse.json({ error: "管理名は100文字以内で入力してください。" }, { status: 400 });
  }

  const result = await addWatch(agency.id, tiktokId, label);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS_BY_CODE[result.code] });
  }

  return NextResponse.json({ watch: result.watch }, { status: 201 });
}
