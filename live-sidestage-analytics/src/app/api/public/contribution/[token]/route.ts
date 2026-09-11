import { NextRequest, NextResponse } from "next/server";
import { queryContributionRankingByShareToken } from "@/lib/contribution-share";

/**
 * シェアリンク用。**トークンだけが鍵**でセッションを見ない(`api/public` は middleware の
 * 保護対象外)。トークン入りURLのJSONを共有キャッシュ・検索インデックスへ載せないため、
 * 成否によらず `private, no-store` と `X-Robots-Tag: noindex` を明示する
 * (`api/public/battles/[token]/replay/route.ts` と同じ設計)。
 */
const PUBLIC_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
};

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const result = await queryContributionRankingByShareToken(params.token);
  // **理由コードを載せない。** トークンの実在有無を第三者に漏らさない。
  if (!result.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: PUBLIC_HEADERS });
  }

  return NextResponse.json(result.payload, { headers: PUBLIC_HEADERS });
}
