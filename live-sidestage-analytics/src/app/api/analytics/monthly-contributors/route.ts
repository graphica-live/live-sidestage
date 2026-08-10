import { NextRequest, NextResponse } from "next/server";
import { resolveStreamerByApiKey } from "@/lib/api-auth";
import { getDateRange, queryGifts, type GiftAnalyticsUser } from "@/lib/gift-analytics";

type Contributor = Pick<GiftAnalyticsUser, "uniqueId" | "nickname" | "profileImageUrl" | "totalDiamonds">;

function toContributor(u: GiftAnalyticsUser): Contributor {
  return { uniqueId: u.uniqueId, nickname: u.nickname, profileImageUrl: u.profileImageUrl, totalDiamonds: u.totalDiamonds };
}

// 降順ソート済みユーザーからMVP(最大値、同率含む)とTOP5(MVPを除いた上位5番目までの値以上、同率含む)を算出する。
function splitMvpAndTop5(sortedUsers: GiftAnalyticsUser[]): { mvp: Contributor[]; top5: Contributor[] } {
  if (!sortedUsers.length) return { mvp: [], top5: [] };

  const mvpValue = sortedUsers[0].totalDiamonds;
  const mvp = sortedUsers.filter((u) => u.totalDiamonds === mvpValue);

  const rest = sortedUsers.filter((u) => u.totalDiamonds !== mvpValue);
  let top5: GiftAnalyticsUser[] = [];
  if (rest.length) {
    const cutoffValue = rest[Math.min(4, rest.length - 1)].totalDiamonds;
    top5 = rest.filter((u) => u.totalDiamonds >= cutoffValue);
  }

  return { mvp: mvp.map(toContributor), top5: top5.map(toContributor) };
}

export async function GET(req: NextRequest) {
  const streamer = await resolveStreamerByApiKey(req);
  if (!streamer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month");

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "monthはYYYY-MM形式で指定してください。" }, { status: 400 });
  }

  const { start, end } = getDateRange("month", `${month}-01`);
  const { users } = await queryGifts(streamer.id, { dayKey: { gte: start, lte: end } });

  const sorted = [...users].sort((a, b) => b.totalDiamonds - a.totalDiamonds);
  const { mvp, top5 } = splitMvpAndTop5(sorted);

  return NextResponse.json({ month, mvp, top5 });
}
