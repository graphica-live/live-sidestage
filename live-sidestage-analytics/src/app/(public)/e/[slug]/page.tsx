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
  RETRY_LEVEL_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS,
  VIOLATION_HANDLING_LABELS,
} from "@/event/labels";
import { hasMatchRules, parseMatchRules } from "@/event/match-rules";
import { findPublicEvent, loadBracket, loadEventSnapshot } from "@/event/public-event";
import { resolveEventWindows } from "@/event/sessions";
import type { EntryMode, EventFormat, EventStatus } from "@/event/validation";
import { getCoverImageUrl } from "@/lib/media-storage";
import { CARD_CLIP, TAG_SKEW, TAG_UNSKEW } from "./battle-ui";
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
  const isLive = event.status === "RUNNING";

  return (
    <main className="px-4 py-10 md:py-14">
      {/* hero: イベントPOP + タイトル */}
      <div className="mx-auto w-full max-w-2xl">
        <div className={`relative overflow-hidden border-2 border-white/10 bg-panel ${CARD_CLIP}`}>
          {coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverImageUrl} alt="" className="max-h-[380px] w-full object-cover" />
          ) : (
            <div
              className="flex h-40 items-center justify-center bg-[#141414]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(-45deg, rgba(254,44,85,0.10) 0px, rgba(254,44,85,0.10) 2px, transparent 2px, transparent 18px)",
              }}
            >
              <span className="font-[family-name:var(--font-battle)] text-4xl font-black italic tracking-tighter text-white/10">
                BATTLE
              </span>
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-panel via-transparent to-transparent" />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 ${TAG_SKEW} border border-white/10 px-3 py-1 text-xs font-bold tracking-wide ${STATUS_CLASSES[event.status as EventStatus]}`}
          >
            <span className={`inline-flex items-center gap-1.5 ${TAG_UNSKEW}`}>
              {isLive && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="motion-safe:absolute motion-safe:inline-flex motion-safe:h-full motion-safe:w-full motion-safe:animate-ping motion-safe:rounded-full motion-safe:bg-green-400/75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
                </span>
              )}
              {STATUS_LABELS[event.status as EventStatus]}
            </span>
          </span>
          <span className="text-xs font-medium tracking-wide text-gray-500">
            {FORMAT_LABELS[event.format as EventFormat]} ・{" "}
            {ENTRY_MODE_LABELS[event.entryMode as EntryMode]}
          </span>
        </div>

        <h1 className="mt-3 font-[family-name:var(--font-battle)] text-3xl font-black leading-tight tracking-tight text-white md:text-4xl">
          {event.title}
        </h1>

        {/* 開催概要 */}
        <section className={`relative mt-6 border border-white/10 bg-white/[0.03] p-4 ${CARD_CLIP}`}>
          <SectionEyebrow>開催概要</SectionEyebrow>

          {/* 日程が複数あるイベントは1行にまとめない。外枠だけ出すと、
              集計されない隙間(1日目の終了〜2日目の開始)まで開催中に見えてしまう。 */}
          {windows.length === 1 ? (
            <p className="mt-3 font-mono text-sm text-gray-300">
              {formatJst(event.startAt)} 〜 {formatJst(event.endAt)}
            </p>
          ) : (
            <ul className="mt-3 grid gap-1.5">
              {windows.map((w, index) => (
                <li key={index} className="flex flex-wrap items-baseline gap-x-2 text-sm text-gray-300">
                  <span className="text-xs text-gray-500">{w.name || `${index + 1}日目`}</span>
                  <span className="font-mono">{formatJstRange(w.start, w.end)}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2 text-sm font-semibold text-brand">{formatOverviewLine}</p>

          {event.description && (
            <p className="mt-4 whitespace-pre-wrap border-t border-white/10 pt-4 text-sm leading-relaxed text-gray-300">
              {event.description}
            </p>
          )}
        </section>
      </div>

      {/* トーナメント表: カード幅が広いのでここだけ横幅を広げる */}
      {bracket && (
        <div className="mx-auto mt-10 w-full max-w-5xl">
          <section>
            <SectionHeading>トーナメント表</SectionHeading>
            <p className="mt-2 text-sm text-gray-400">
              勝敗は当サービスが受信したギフトのダイヤで決まる。バトル中に投げられたぶんが対象。
            </p>
            <div className="mt-5">
              <BracketTree roundCount={bracket.roundCount} matches={bracket.matches} />
            </div>
          </section>
        </div>
      )}

      <div className="mx-auto mt-10 w-full max-w-2xl">
        {/* 賞品 */}
        {event.prizeText && (
          <section className="mt-10 first:mt-0">
            <SectionHeading>賞品</SectionHeading>
            <p className={`mt-3 whitespace-pre-wrap border border-brand/30 bg-brand/[0.06] p-4 text-sm leading-relaxed text-gray-200 ${CARD_CLIP}`}>
              {event.prizeText}
            </p>
          </section>
        )}

        {/* ルール */}
        {matchRules && (
          <section className="mt-10 first:mt-0">
            <SectionHeading>ルール</SectionHeading>
            <dl className={`mt-3 grid gap-2 border border-white/10 bg-white/[0.03] p-4 text-sm ${CARD_CLIP}`}>
              <RuleRow label="グローブ">{GLOVE_LEVEL_LABELS[matchRules.glove]}</RuleRow>
              <RuleRow label="ブースター">{BOOSTER_LEVEL_LABELS[matchRules.booster]}</RuleRow>
              <RuleRow label="ボーナスタイム">{matchRules.bonusTime ? "あり" : "なし"}</RuleRow>
              <RuleRow label="ミスト">{matchRules.mist ? "あり" : "なし"}</RuleRow>
              <RuleRow label="違反時の取り扱い">
                {VIOLATION_HANDLING_LABELS[matchRules.violation]}
              </RuleRow>
              <RuleRow label="やり直し">{RETRY_LEVEL_LABELS[matchRules.retry]}</RuleRow>
            </dl>
          </section>
        )}

        {/* 出場者一覧・プロフィール */}
        <section className="mt-10">
          <SectionHeading>出場者一覧</SectionHeading>
          <div className="mt-4">
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
          <section className="mt-10">
            <NoticeSection text={event.noticeText} />
          </section>
        )}

        <p className="mt-10 text-xs leading-relaxed text-gray-600">
          集計は当サービスが受信したギフトに基づく。通信状況により実際の数値と差が出る場合がある。
        </p>
      </div>
    </main>
  );
}

/** 大見出し。左に太いブランドバーを添えるだけで、AI生成テンプレ特有の連番アイキャッチは使わない。 */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5 font-[family-name:var(--font-battle)] text-xl font-black tracking-tight text-white">
      <span className="h-5 w-1.5 shrink-0 -skew-x-12 bg-brand" aria-hidden />
      {children}
    </h2>
  );
}

/** 小さいセクション内ラベル(SectionHeadingより一段小さい、カード内で使う)。 */
function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-gray-400">
      <span className="h-3 w-1 shrink-0 -skew-x-12 bg-brand/70" aria-hidden />
      {children}
    </h3>
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
