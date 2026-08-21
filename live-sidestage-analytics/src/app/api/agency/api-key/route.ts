import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAgencyByEmail, issueAgencyApiKey } from "@/lib/agency/agency";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agency = await getAgencyByEmail(session.user.email);
  if (!agency) return NextResponse.json({ error: "事務所情報が見つかりません。" }, { status: 404 });

  return NextResponse.json({ hasApiKey: agency.hasApiKey });
}

// APIキーを新規発行(または再発行)する。発行時のみ平文を返す。
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agency = await getAgencyByEmail(session.user.email);
  if (!agency) return NextResponse.json({ error: "事務所情報が見つかりません。" }, { status: 404 });

  const apiKey = await issueAgencyApiKey(agency.id);
  // 平文キーを返す唯一の応答。中間キャッシュに残さない。
  return NextResponse.json({ apiKey }, { headers: { "Cache-Control": "no-store" } });
}
