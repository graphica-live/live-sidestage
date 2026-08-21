import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { agencyAuthOptions } from "@/lib/agency/auth";
import { getAgencyByEmail } from "@/lib/agency/agency";

// 事務所の作成は管理者操作(/api/admin/agencies)。ここは参照のみ。
// 管理者が登録していないアカウントでは agency: null が返り、コンソールは利用できない。
//
// セッションは配信者側(authOptions)ではなく事務所側(agencyAuthOptions)を見る。
// Cookie が別なので、配信者としてログイン中でもここは 401 になる。
export async function GET() {
  const session = await getServerSession(agencyAuthOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agency = await getAgencyByEmail(session.user.email);
  return NextResponse.json({ agency });
}
