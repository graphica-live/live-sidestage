import { NextRequest, NextResponse } from "next/server";
import { queryBattleReplayByShareToken } from "@/lib/battle-replay";

/**
 * シェアリンク用。**トークンだけが鍵**でセッションを見ない(`api/public` は middleware の
 * 保護対象外)。トークン入りURLのJSONを共有キャッシュ・検索インデックスへ載せないため、
 * 成否によらず `private, no-store` と `X-Robots-Tag: noindex` を明示する。
 */
const PUBLIC_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex",
};

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const result = await queryBattleReplayByShareToken(params.token);
  // **理由コードを載せない。** 載せると「トークンは実在するが再生できない」と
  // 「トークンが存在しない」を呼び出し側が区別でき、トークンの実在有無が漏れる。
  // 理由が要るのは所有者向けの私的APIだけ。
  if (!result.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: PUBLIC_HEADERS });
  }

  return NextResponse.json(result.payload, { headers: PUBLIC_HEADERS });
}
