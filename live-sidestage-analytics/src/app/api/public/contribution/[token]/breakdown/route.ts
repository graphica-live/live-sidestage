import { NextRequest, NextResponse } from "next/server";
import { queryContributionBreakdownByShareToken } from "@/lib/contribution-share";

/**
 * 公開ページのギフト内訳アコーディオン用。所有者向け `/api/analytics/gifts/breakdown` の
 * 公開トークン版(`api/public/contribution/[token]/route.ts` と同じ設計)。
 */
const PUBLIC_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
};

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const { searchParams } = new URL(req.url);
  const tiktokUid = searchParams.get("tiktokUid");
  if (!tiktokUid) {
    return NextResponse.json({ error: "tiktokUid is required" }, { status: 400, headers: PUBLIC_HEADERS });
  }

  const result = await queryContributionBreakdownByShareToken(params.token, tiktokUid);
  // **理由コードを載せない。** トークンの実在有無を第三者に漏らさない。
  if (!result.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: PUBLIC_HEADERS });
  }

  return NextResponse.json(result.value, { headers: PUBLIC_HEADERS });
}
