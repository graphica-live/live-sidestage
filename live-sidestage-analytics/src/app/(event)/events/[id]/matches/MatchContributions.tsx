"use client";

import { useState } from "react";
// 型だけを取る。`match-contributions.ts` は prisma を引いているので、
// 値を import するとクライアントバンドルに入りうる(`import type` は消える)。
import type { MatchContributionResult, MatchSlotRow } from "@/event/match-contributions";
import { formatNumber, formatPoints } from "@/event/public-event";

// 対戦の詳細に出す「枠ごとのリスナー貢献」。
//
// **開いたときに初めて取得する。** `MatchCard` は一覧モードでも全対戦ぶん描画されるので、
// 無条件に fetch すると1画面で数十本の API が飛ぶ。
//
// バトルスコア(TikTok の hostScore)は**サイド単位**でしか出せない(リスナー別の内訳が
// payload に存在しない)。サイドに枠が2つある 2vs2 では、左端の枠にだけ「サイド合計」
// として出す — 両方に同じ数字を並べると、枠ごとの値だと誤読される。

const STATUS_NOTES: Record<string, string> = {
  "no-detection": "まだバトルを検知していない。検知されるとここに枠ごとの内訳が出る。",
  "no-end":
    "バトルの終了を観測できていないため、集計する区間が確定していない。勝者を手動で確定するか、検知をやり直す。",
  "no-window":
    "検知した区間が開催日程の外にある。日程を動かした場合は「検知をやり直す」で付け直す。",
};

export type ContributionSide = {
  sideIndex: number;
  /** サーバー側で整形済みのバトルスコア。帰属できなければ null */
  tiktokScore: string | null;
};

export function MatchContributions({
  eventId,
  matchId,
  sides,
  winnerDecidedBy,
}: {
  eventId: string;
  matchId: string;
  sides: ContributionSide[];
  winnerDecidedBy: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<MatchContributionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/matches/${matchId}/contributions`);
      if (!res.ok) {
        setError("リスナー貢献を読み込めなかった。");
        return;
      }
      setData((await res.json()) as MatchContributionResult);
    } catch {
      setError("リスナー貢献を読み込めなかった。");
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (!data) void load();
        }}
        className="text-xs text-gray-400 hover:text-white"
      >
        リスナー貢献を見る
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg bg-white/5 p-3">
      <div className="flex items-center gap-3">
        <h3 className="text-xs font-semibold text-gray-300">枠ごとのリスナー貢献</h3>
        <button
          type="button"
          disabled={loading}
          onClick={() => void load()}
          className="text-xs text-gray-400 hover:text-white disabled:opacity-50"
        >
          {loading ? "読み込み中..." : "更新"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-auto text-xs text-gray-500 hover:text-gray-300"
        >
          閉じる
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {!data && loading && <p className="text-xs text-gray-500">読み込み中...</p>}

      {data && data.status !== "ok" && (
        <p className="text-xs leading-relaxed text-gray-500">
          {STATUS_NOTES[data.status] ?? "この対戦は集計できない。"}
        </p>
      )}

      {data && data.status === "ok" && (
        <Slots data={data} sides={sides} winnerDecidedBy={winnerDecidedBy} />
      )}
    </div>
  );
}

function Slots({
  data,
  sides,
  winnerDecidedBy,
}: {
  data: Extract<MatchContributionResult, { status: "ok" }>;
  sides: ContributionSide[];
  winnerDecidedBy: string | null;
}) {
  // サイドに枠が何個あるか。2つ以上なら「サイド合計」と断って左端の枠にだけ出す。
  const slotsPerSide = new Map<number, number>();
  for (const slot of data.slots) {
    slotsPerSide.set(slot.sideIndex, (slotsPerSide.get(slot.sideIndex) ?? 0) + 1);
  }
  const firstOfSide = new Set<string>();
  const seenSide = new Set<number>();
  for (const slot of data.slots) {
    if (seenSide.has(slot.sideIndex)) continue;
    seenSide.add(slot.sideIndex);
    firstOfSide.add(slot.participantId);
  }

  const scoreBySide = new Map(sides.map((s) => [s.sideIndex, s.tiktokScore]));
  const manual = winnerDecidedBy === "MANUAL" || winnerDecidedBy === "DRAW";
  // 片側だけ帰属できているとき、スコア行のぶんだけ列の頭がずれる。
  // 1つでも出るなら全列で行を確保して、リスナーの1位どうしを横に並べる。
  const reserveScoreRow = sides.some((s) => s.tiktokScore !== null);

  return (
    <>
      {data.provisional && (
        <p className="text-xs leading-relaxed text-yellow-200/70">
          バトルが進行中のため、現在までの暫定値。バトルの終了を観測するまで順位表には反映されない。
        </p>
      )}
      {data.unconfirmed && (
        <p className="text-xs leading-relaxed text-yellow-200/70">
          この対戦はまだ確定していない。どのバトルの区間かが確定していないため参考値として見ること。
        </p>
      )}
      {manual && (
        <p className="text-xs leading-relaxed text-gray-500">
          主催者が結果を確定した対戦のため、上のサイド表示のダイヤは集計されていない（0
          のまま）。ここの数字は検知した区間から数え直したもので、順位表と同じ母集団。
        </p>
      )}

      {data.slots.length === 0 ? (
        <p className="text-xs text-gray-500">出場者が確定していない。</p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {data.slots.map((slot) => (
            <SlotColumn
              key={slot.participantId}
              slot={slot}
              hasMultiplier={data.hasMultiplier}
              tiktokScore={
                firstOfSide.has(slot.participantId)
                  ? scoreBySide.get(slot.sideIndex) ?? null
                  : null
              }
              scoreIsSideTotal={(slotsPerSide.get(slot.sideIndex) ?? 0) > 1}
              reserveScoreRow={reserveScoreRow}
            />
          ))}
        </div>
      )}
    </>
  );
}

function SlotColumn({
  slot,
  hasMultiplier,
  tiktokScore,
  scoreIsSideTotal,
  reserveScoreRow,
}: {
  slot: MatchSlotRow;
  hasMultiplier: boolean;
  tiktokScore: string | null;
  scoreIsSideTotal: boolean;
  /** スコアの無い列にも空の行を置いて、列どうしの頭を揃えるか */
  reserveScoreRow: boolean;
}) {
  return (
    <div className="min-w-[13rem] flex-1 rounded-lg bg-white/5 p-2">
      <div className="truncate text-sm font-medium" title={`@${slot.tiktokId}`}>
        {slot.displayName}
      </div>
      <div className="mt-0.5 text-xs text-gray-400">
        {formatNumber(slot.diamonds)} ダイヤ
        {hasMultiplier && (
          <span className="ml-2 text-gray-500">{formatPoints(slot.points)} pt</span>
        )}
      </div>
      {tiktokScore !== null ? (
        <div className="text-xs text-gray-500">
          バトルスコア {tiktokScore}
          {scoreIsSideTotal && <span className="ml-1 text-gray-600">(サイド合計)</span>}
        </div>
      ) : reserveScoreRow ? (
        <div className="text-xs text-gray-500" aria-hidden>
          &nbsp;
        </div>
      ) : null}

      {slot.listeners.length === 0 ? (
        <p className="mt-2 text-xs text-gray-600">この区間のギフトなし</p>
      ) : (
        <ol className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
          {slot.listeners.map((listener, index) => (
            <li key={listener.uniqueId} className="flex items-center gap-1.5 text-xs">
              <span className="w-4 shrink-0 text-right text-gray-500">{index + 1}</span>
              {listener.profileImageUrl ? (
                // 外部(TikTok CDN)の画像なので next/image の最適化は通さない。
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={listener.profileImageUrl}
                  alt=""
                  className="h-5 w-5 shrink-0 rounded-full object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="h-5 w-5 shrink-0 rounded-full bg-white/10" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate" title={`@${listener.uniqueId}`}>
                {listener.nickname}
              </span>
              <span className="shrink-0 tabular-nums text-gray-400">
                {hasMultiplier ? formatPoints(listener.points) : formatNumber(listener.diamonds)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
