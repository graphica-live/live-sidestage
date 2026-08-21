import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAgencyByUserId, removeWatch } from "@/lib/agency/agency";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agency = await getAgencyByUserId(session.user.id);
  if (!agency) return NextResponse.json({ error: "事務所情報が見つかりません。" }, { status: 404 });

  // agencyIdもwhereに含めるため、他事務所のwatchは削除できない。
  const removed = await removeWatch(agency.id, params.id);
  if (!removed) {
    return NextResponse.json({ error: "監視対象が見つかりません。" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
