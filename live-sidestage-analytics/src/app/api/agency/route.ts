import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAgencyByEmail } from "@/lib/agency/agency";

// 事務所の作成は管理者操作(/api/admin/agencies)。ここは参照のみ。
// 管理者が登録していないアカウントでは agency: null が返り、コンソールは利用できない。
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agency = await getAgencyByEmail(session.user.email);
  return NextResponse.json({ agency });
}
