import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toJstInputValue } from "@/event/datetime";
import { parseMatchRules } from "@/event/match-rules";
import { evaluateEventReadiness, loadReadinessInput } from "@/event/readiness";
import { resolveEventWindows } from "@/event/sessions";
import { ENTRY_MODE_LABELS, FORMAT_LABELS } from "@/event/labels";
import { getCoverImageUrl, isCoverUploadEnabled } from "@/lib/media-storage";
import { canonicalOrigin } from "@/lib/canonical-origin";
import { EventForm, type EventFormValues } from "../EventForm";
import { EventAdminControls } from "./EventAdminControls";
import { EventCoverUpload } from "./EventCoverUpload";
import type { EntryMode, EventFormat, TeamPreset, Visibility } from "@/event/validation";

/**
 * 種目ごとの対戦管理への導線。**選んだ種目のものだけ出す。**
 * 獲得ダイヤレースに対戦は無いので出さない(ただし対戦が既にあるイベントは下で救済する)。
 */
const MATCH_LINK_LABELS: Partial<Record<EventFormat, string>> = {
  TOURNAMENT: "トーナメント表",
  DEATHMATCH: "対戦カード",
};

export const dynamic = "force-dynamic";

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const event = await prisma.event.findFirst({
    where: { id: params.id, ownerUserId: session!.user.id },
    include: {
      sessions: { orderBy: { startAt: "asc" } },
      _count: { select: { participants: true, matches: true } },
    },
  });

  if (!event) notFound();

  const initial: EventFormValues = {
    title: event.title,
    description: event.description ?? "",
    format: event.format as EventFormat,
    entryMode: event.entryMode as EntryMode,
    teamPreset: event.teamPreset as TeamPreset,
    visibility: event.visibility as Visibility,
    // 日程を持たないイベント(この機能より前に作られたもの)は外枠を1日程として出す。
    // **id を落とさない。** 更新APIはこれで差分更新するので、落とすと日程が作り直しになり、
    // 対戦がぶら下がっていると保存できなくなる。
    sessions: resolveEventWindows(event).map((w) => ({
      ...(w.id ? { id: w.id } : {}),
      name: w.name ?? "",
      startAt: toJstInputValue(w.start),
      endAt: toJstInputValue(w.end),
    })),
    prizeText: event.prizeText ?? "",
    noticeText: event.noticeText ?? "",
    matchRules: parseMatchRules(event.rules),
  };

  const coverImageUrl = await getCoverImageUrl(event.coverImageKey);
  const uploadEnabled = isCoverUploadEnabled();

  // 開催までの残タスク。**API のゲートと同じ関数・同じクエリで出す**
  // (画面では「まだできる」と見えるのにサーバーが弾く、を避ける)。
  const readinessTasks = evaluateEventReadiness(await loadReadinessInput(prisma, event));

  const format = event.format as EventFormat;
  // 種目と噛み合わない対戦が残っている既存イベント(種目を変更できた頃に作られたもの)でも
  // 対戦管理へ行けるようにする。導線ごと消すと、残った対戦を片付けられなくなる。
  const matchLinkLabel = MATCH_LINK_LABELS[format] ?? (event._count.matches > 0 ? "対戦" : null);

  return (
    <div>
      <Link href="/events" className="text-xs text-gray-500 hover:text-white">
        ← イベント一覧
      </Link>
      <h1 className="mb-2 mt-2 truncate text-xl font-bold">{event.title}</h1>
      {/* 選んだ種目だけを出す。他の種目は作成後に選べないので並べない。 */}
      <p className="mb-6 text-xs text-gray-400">
        {FORMAT_LABELS[format]} ・ {ENTRY_MODE_LABELS[event.entryMode as EntryMode]}
      </p>

      <EventAdminControls
        id={event.id}
        slug={event.slug}
        status={event.status}
        visibility={event.visibility}
        readinessTasks={readinessTasks}
        eventsOrigin={canonicalOrigin("events")}
      />

      <div className="mt-4">
        <EventCoverUpload
          eventId={event.id}
          initialImageUrl={coverImageUrl}
          uploadEnabled={uploadEnabled}
        />
      </div>

      <Link
        href={`/events/${event.id}/participants`}
        className="card mt-4 flex items-center justify-between hover:border-brand/40"
      >
        <span className="text-sm font-medium">参加者</span>
        <span className="text-xs text-gray-500">
          {event._count.participants} 人 →
        </span>
      </Link>

      {matchLinkLabel && (
        <Link
          href={`/events/${event.id}/matches`}
          className="card mt-2 flex items-center justify-between hover:border-brand/40"
        >
          <span className="text-sm font-medium">{matchLinkLabel}</span>
          <span className="text-xs text-gray-500">
            {event._count.matches > 0
              ? `${event._count.matches} 試合 →`
              : format === "TOURNAMENT"
                ? "表を作る →"
                : "対戦を組む →"}
          </span>
        </Link>
      )}

      {/* 参加者と無関係なイベント全体の設定。新規作成後はあまり触らないのでアコーディオンで畳んでおく。 */}
      <details className="group mt-8 rounded-lg border border-border bg-panel">
        <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-3 text-sm font-semibold text-gray-300">
          設定
          <span className="text-xs font-normal text-gray-500 group-open:hidden">開く ▾</span>
          <span className="hidden text-xs font-normal text-gray-500 group-open:inline">閉じる ▴</span>
        </summary>
        <div className="border-t border-border p-4">
          <EventForm eventId={event.id} initial={initial} />
        </div>
      </details>
    </div>
  );
}
