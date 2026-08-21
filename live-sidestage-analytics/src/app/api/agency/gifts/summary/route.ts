import { NextRequest, NextResponse } from "next/server";
import { resolveAgencyByApiKey } from "@/lib/api-auth";
import { listWatchedRooms } from "@/lib/agency/agency";
import { parseDateRange, parseTiktokIdsParam, selectWatchedRooms } from "@/lib/agency/params";
import { emptySummary, queryRoomSummariesRaw } from "@/lib/agency/summary";

// 企業向けBatch API。監視対象ライバーを複数まとめて期間集計する。
//
//   GET /api/agency/gifts/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&tiktokIds=a,b,c
//   Header: x-api-key: <Agency.apiKey>
//
// 数値はオリジナル生データ基準(GiftEdit非適用)。レスポンスの basis: "raw" がその契約を示す。
export async function GET(req: NextRequest) {
  const agency = await resolveAgencyByApiKey(req);
  if (!agency) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  const range = parseDateRange(searchParams.get("from"), searchParams.get("to"));
  if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });

  const parsedIds = parseTiktokIdsParam(searchParams.get("tiktokIds"));
  if (!parsedIds.ok) return NextResponse.json({ error: parsedIds.error }, { status: 400 });

  const requested = parsedIds.value;
  if (requested && requested.length > agency.maxWatchTargets) {
    return NextResponse.json(
      { error: `tiktokIdsは最大${agency.maxWatchTargets}件までです。` },
      { status: 400 }
    );
  }

  // 認可境界: 集計対象をこの事務所の監視対象だけに閉じる。
  const watched = await listWatchedRooms(agency.id);
  const { selected, unknownTiktokIds } = selectWatchedRooms(watched, requested);

  const summaries = await queryRoomSummariesRaw(
    selected.map((w) => w.roomId),
    range.value
  );

  // ギフト0件の監視対象も0埋めで含める(企業側が安定した行数を得られるようにするため)。
  // Giftは配信を観測した部屋(TiktokRoom)単位で共有されるため、監視対象に加える前の期間の
  // データも含まれうる。「本当に0件だった」のか「まだ監視していなかった」のかを区別できるよう
  // watchStartedAt を必ず返す。
  const livers = selected.map((w) => {
    const s = summaries.get(w.roomId) ?? emptySummary(w.roomId);
    return {
      // 正規化済みの値を返す。そのまま tiktokIds パラメータへ渡せる形にしておくため、
      // 事務所が入力した表記(@付き・大文字混じり)は displayName 側に置く。
      tiktokId: w.normalizedTiktokId,
      displayName: w.tiktokId,
      label: w.label,
      watchStartedAt: w.watchStartedAt,
      listenerStatus: w.listenerStatus,
      listenerUpdatedAt: w.listenerUpdatedAt,
      giftCount: s.giftCount,
      totalDiamonds: s.totalDiamonds,
      supporterCount: s.supporterCount,
      lastGiftAt: s.lastGiftAt,
    };
  });

  const total = livers.reduce(
    (acc, l) => ({
      giftCount: acc.giftCount + l.giftCount,
      totalDiamonds: acc.totalDiamonds + l.totalDiamonds,
    }),
    { giftCount: 0, totalDiamonds: 0 }
  );

  return NextResponse.json(
    {
      from: range.value.from,
      to: range.value.to,
      // from/to は日本時間の日付として解釈される(ギフトの集計キーがJSTの日付のため)。
      timezone: "Asia/Tokyo",
      basis: "raw",
      livers,
      total,
      unknownTiktokIds,
    },
    // 企業の契約データなので中間キャッシュに残さない。
    { headers: { "Cache-Control": "no-store" } }
  );
}
