import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { parseBreakdownRange, queryGiftBreakdown } from "@/lib/gift-breakdown";

// admin専用: 一般ユーザー向け /api/analytics/gifts/breakdown と違い roomId を直接指定できる
// (getAdminSession()配下。URLでroomId指定不可という一般ユーザー側の認可は変更しない)。
export async function GET(req: NextRequest, { params }: { params: { roomId: string } }) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const uniqueId = searchParams.get("uniqueId");
  if (!uniqueId) return NextResponse.json({ error: "uniqueId is required" }, { status: 400 });

  const range = parseBreakdownRange(searchParams);
  if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });

  const result = await queryGiftBreakdown(params.roomId, uniqueId, range.where);
  return NextResponse.json({ ...result, dateRange: range.dateRange });
}
