import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatJst, formatJstRange } from "@/event/datetime";
import {
  BOOSTER_LEVEL_LABELS,
  ENTRY_MODE_LABELS,
  FORMAT_LABELS,
  GLOVE_LEVEL_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS,
  VIOLATION_HANDLING_LABELS,
} from "@/event/labels";
import { hasMatchRules, parseMatchRules } from "@/event/match-rules";
import { findPublicEvent, loadBracket, loadEventSnapshot } from "@/event/public-event";
import { resolveEventWindows } from "@/event/sessions";
import type { EntryMode, EventFormat, EventStatus } from "@/event/validation";
import { getCoverImageUrl } from "@/lib/media-storage";
import { BracketTree } from "./bracket/BracketTree";
import { EventResults } from "./EventResults";
import { NoticeSection } from "./NoticeSection";
import { ParticipantRoster } from "./ParticipantRoster";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
  if (!event) return { title: "イベントが見つからない" };

  const description =
    event.description?.slice(0, 120) ??
    `${FORMAT_LABELS[event.format as EventFormat]} / ${formatJst(event.startAt)} 〜 ${formatJst(event.endAt)}`;

  return {
    title: `${event.title} | LIVE Sidestage Event`,
    description,
    openGraph: {
      title: event.title,
      description,
      type: "website",
    },
    // 非公開(オーナーのプレビュー)は検索避けする。
    robots: event.visibility === "PUBLIC" ? undefined : { index: false, follow: false },
  };
}

export default async function PublicEventPage({ params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions);
  const event = await findPublicEvent(params.slug, session?.user?.id);
  if (!event) notFound();

  const [snapshot, matchCount, coverImageUrl] = await Promise.all([
    loadEventSnapshot(event),
    event.format === "TOURNAMENT"
      ? prisma.eventMatch.count({ where: { eventId: event.id } })
      : Promise.resolve(0),
    getCoverImageUrl(event.coverImageKey),
  ]);
  const hasBracket = matchCount > 0;
  const bracket = event.format === "TOURNAMENT" && hasBracket ? await loadBracket(event.id) : null;
  const windows = resolveEventWindows(event);
  const matchRules = hasMatchRules(event.rules) ? parseMatchRules(event.rules) : null;

  const entrantCount = event.entryMode === "TEAM" ? event._count.teams : event._count.participants;
  const entrantUnit = event.entryMode === "TEAM" ? "チーム" : "人";
  const formatOverviewLine =
    event.format === "TOURNAMENT"
      ? `${entrantCount}${entrantUnit} ・ シングルエリミネーション`
      : FORMAT_LABELS[event.format as EventFormat];

  return (
    <main className="min-h-screen px-4 py-12">
      {/* hero: イベントPOP + タイトル */}
      <div className="mx-auto w-full max-w-2xl">
        {coverImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImageUrl}
            alt=""
            className="mb-4 max-h-[420px] w-full rounded-xl border border-border object-contain"
          />
        )}

        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES[event.status as EventStatus]}`}>
            {STATUS_LABELS[event.status as EventStatus]}
          </span>
          <span className="text-xs text-gray-500">
            {FORMAT_LABELS[event.format as EventFormat]} ・{" "}
            {ENTRY_MODE_LABELS[event.entryMode as EntryMode]}
          </span>
        </div>

        <h1 className="mt-3 text-2xl font-bold">{event.title}</h1>

        {/* 開催概要 */}
        <section className="mt-6">
          <h2 className="text-base font-semibold text-white">開催概要</h2>

          {/* 日程が複数あるイベントは1行にまとめない。外枠だけ出すと、
              集計されない隙間(1日目の終了〜2日目の開始)まで開催中に見えてしまう。 */}
          {windows.length === 1 ? (
            <p className="mt-2 font-mono text-sm text-gray-400">
              {formatJst(event.startAt)} 〜 {formatJst(event.endAt)}
            </p>
          ) : (
            <ul className="mt-2 grid gap-1">
              {windows.map((w, index) => (
                <li key={index} className="flex flex-wrap items-baseline gap-x-2 text-sm text-gray-400">
                  <span className="text-xs text-gray-500">{w.name || `${index + 1}日目`}</span>
                  <span className="font-mono">{formatJstRange(w.start, w.end)}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-sm text-gray-400">{formatOverviewLine}</p>

          {event.description && (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
              {event.description}
            </p>
          )}
        </section>
      </div>

      {/* トーナメント表: カード幅が広いのでここだけ横幅を広げる */}
      {bracket && (
        <div className="mx-auto mt-8 w-full max-w-5xl">
          <section>
            <h2 className="text-base font-semibold text-white">トーナメント表</h2>
            <p className="mt-1 text-sm text-gray-400">
              勝敗は当サービスが受信したギフトのダイヤで決まる。バトル中に投げられたぶんが対象。
            </p>
            <div className="mt-4">
              <BracketTree roundCount={bracket.roundCount} matches={bracket.matches} />
            </div>
          </section>
        </div>
      )}

      <div className="mx-auto mt-8 w-full max-w-2xl">
        {/* 賞品 */}
        {event.prizeText && (
          <section className="mt-8 first:mt-0">
            <h2 className="text-base font-semibold text-white">賞品</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
              {event.prizeText}
            </p>
          </section>
        )}

        {/* ルール */}
        {matchRules && (
          <section className="mt-8 first:mt-0">
            <h2 className="text-base font-semibold text-white">ルール</h2>
            <dl className="mt-2 grid gap-1.5 text-sm">
              <RuleRow label="グローブ">{GLOVE_LEVEL_LABELS[matchRules.glove]}</RuleRow>
              <RuleRow label="ブースター">{BOOSTER_LEVEL_LABELS[matchRules.booster]}</RuleRow>
              <RuleRow label="ボーナスタイム">{matchRules.bonusTime ? "あり" : "なし"}</RuleRow>
              <RuleRow label="ミスト">{matchRules.mist ? "あり" : "なし"}</RuleRow>
              <RuleRow label="違反時の取り扱い">
                {VIOLATION_HANDLING_LABELS[matchRules.violation]}
              </RuleRow>
            </dl>
          </section>
        )}

        {/* 出場者一覧・プロフィール */}
        <section className="mt-8">
          <h2 className="text-base font-semibold text-white">出場者一覧</h2>
          <div className="mt-3">
            <ParticipantRoster
              participants={snapshot.participants}
              teams={snapshot.teams}
              entryMode={event.entryMode}
            />
          </div>
        </section>

        <EventResults
          slug={event.slug}
          status={event.status}
          entryMode={event.entryMode}
          format={event.format}
          initial={{ ...snapshot, participantContributions: null }}
        />

        {/* 注意事項とFAQ */}
        {event.noticeText && (
          <section className="mt-8">
            <NoticeSection text={event.noticeText} />
          </section>
        )}

        <p className="mt-8 text-xs leading-relaxed text-gray-600">
          集計は当サービスが受信したギフトに基づく。通信状況により実際の数値と差が出る場合がある。
        </p>
      </div>
    </main>
  );
}

function RuleRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      <dt className="w-32 shrink-0 text-xs text-gray-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-gray-200">{children}</dd>
    </div>
  );
}
