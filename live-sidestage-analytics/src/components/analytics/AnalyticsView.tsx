"use client";

import { memo, useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { BattleDetailModal } from "./BattleDetailModal";
import { Avatar, BattleScoreLine, BattleVersus, BATTLE_STATUS_LABELS, tiktokProfileUrl, type BattleListItem, type BattleStatus } from "./battle-types";
import { GIFT_HISTORY_MAX_RANGE_DAYS } from "@/lib/range-limits";
import { useBattleFilterSettings } from "./useBattleFilterSettings";

type Period = "day" | "week" | "month" | "year" | "custom";
type SortKey = "diamonds" | "count" | "name" | "recent";
type HistorySortKey = "time" | "diamonds" | "user" | "gift";
type SortOrder = "asc" | "desc";
type ViewMode = "ranking" | "history" | "battles";

// サーバ側の型は src/lib/gift-analytics.ts の `GiftAnalyticsUser`。
// **同一性キーは tiktokUid。** tiktokHandle / nickname は TikTokUser から順引きした現在値の
// スナップショットで、未観測なら null になる(表示・検索でそのまま触らない)。
interface GiftUser {
  tiktokUid: string;
  tiktokHandle: string | null;
  nickname: string | null;
  profileImageUrl: string | null;
  giftCount: number;
  totalDiamonds: number;
  lastGiftAt: string;
}

interface AnalyticsData {
  users: GiftUser[];
  dateRange: { start: string; end: string };
  total: { giftCount: number; totalDiamonds: number };
  verified?: boolean;
}

// 貢献ランキングの行を展開したときに出す、その送信者のギフト名別内訳。
// 明細(Gift)は90日で削除されるので、古い期間は coverage.detailAvailable=false で返ってくる
// (エラーではない。src/lib/gift-breakdown.ts 参照)。
interface GiftBreakdownEntry {
  giftId: number;
  giftName: string;
  giftPictureUrl: string | null;
  repeatCount: number;
  diamondCount: number;
  totalDiamonds: number;
  lastReceivedAt: string;
}

interface GiftBreakdownData {
  tiktokUid: string;
  gifts: GiftBreakdownEntry[];
  total: { repeatCount: number; totalDiamonds: number };
  coverage: { detailAvailable: boolean; rawFrom: string | null; partial: boolean };
  truncated?: boolean;
  dateRange: { start: string; end: string };
}

type BreakdownState =
  | { status: "loading" }
  | { status: "ready"; data: GiftBreakdownData }
  | { status: "error" };

// サーバ側の型は src/lib/gift-history.ts の `GiftHistoryEvent`(GiftUser と同じ規律)。
interface GiftEvent {
  id: string;
  tiktokUid: string;
  tiktokHandle: string | null;
  nickname: string | null;
  profileImageUrl: string | null;
  giftId: number;
  giftName: string;
  giftPictureUrl: string | null;
  repeatCount: number;
  totalDiamonds: number;
  receivedAt: string;
}

interface HistoryData {
  events: GiftEvent[];
  dateRange: { start: string; end: string };
  total: { count: number; diamonds: number };
  verified?: boolean;
}

interface BattlesData {
  battles: BattleListItem[];
  dateRange: { start: string; end: string };
  verified?: boolean;
}

const SORT_LABELS: Record<SortKey, string> = {
  diamonds: "コイン数",
  count: "ギフト数",
  name: "名前",
  recent: "最終ギフト",
};

const HISTORY_SORT_LABELS: Record<HistorySortKey, string> = {
  time: "時刻",
  diamonds: "コイン数",
  user: "ユーザー",
  gift: "ギフト名",
};

function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatCustomRangeLabel(start: string, end: string): string {
  const fmt = (d: Date) =>
    d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${fmt(new Date(start))} 〜 ${fmt(new Date(end))}`;
}

function todayStr() {
  // サーバー(UTC想定)とクライアント(JST)でローカル時刻の「今日」がズレると
  // hydration mismatchが起きるため、常にAsia/Tokyoで計算する
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, n: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(date: string, n: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

function addYears(date: string, n: number): string {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
}

function formatPeriodLabel(period: Period, date: string): string {
  const d = new Date(date + "T00:00:00");
  if (period === "day") {
    return d.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    });
  }
  if (period === "week") {
    const day = d.getDay();
    const daysToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setDate(d.getDate() + daysToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const fmt = (dt: Date) =>
      `${dt.getMonth() + 1}/${dt.getDate()}`;
    return `${mon.getFullYear()}年 ${fmt(mon)} 〜 ${fmt(sun)}`;
  }
  if (period === "month") {
    return d.toLocaleDateString("ja-JP", { year: "numeric", month: "long" });
  }
  return d.toLocaleDateString("ja-JP", { year: "numeric" });
}

function navigateDate(period: Period, date: string, dir: -1 | 1): string {
  if (period === "day") return addDays(date, dir);
  if (period === "week") return addDays(date, dir * 7);
  if (period === "month") return addMonths(date, dir);
  return addYears(date, dir);
}

function formatEventTime(iso: string, period: Period): string {
  const d = new Date(iso);
  if (period === "day") {
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// 表示名。TikTokUser を未観測なら nickname も tiktokHandle も null になりうるので、
// 最後は tiktokUid まで落とす(`@null` や空欄を出さない)。
function displayNameOf(u: {
  nickname: string | null;
  tiktokHandle: string | null;
  tiktokUid: string;
}): string {
  return u.nickname ?? u.tiktokHandle ?? u.tiktokUid;
}

// ギフト履歴の送信者表示。ハンドルが無い(TikTokUser 未観測)ならプロフィールリンクを出さない。
function SenderIdentity({
  sender,
  nameClassName,
  handleClassName,
}: {
  sender: {
    tiktokUid: string;
    tiktokHandle: string | null;
    nickname: string | null;
    profileImageUrl: string | null;
  };
  nameClassName: string;
  handleClassName: string;
}) {
  const name = displayNameOf(sender);
  const profileUrl = sender.tiktokHandle ? tiktokProfileUrl(sender.tiktokHandle) : null;
  return (
    <div className="flex items-center gap-2 min-w-0">
      {profileUrl ? (
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="TikTokプロフィールを開く"
          className="shrink-0"
        >
          <Avatar src={sender.profileImageUrl} alt={name} />
        </a>
      ) : (
        <span className="shrink-0">
          <Avatar src={sender.profileImageUrl} alt={name} />
        </span>
      )}
      <div className="min-w-0">
        {profileUrl ? (
          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="TikTokプロフィールを開く"
            className={`${nameClassName} hover:text-brand transition-colors block`}
          >
            {name}
          </a>
        ) : (
          <span className={`${nameClassName} block`}>{name}</span>
        )}
        {sender.tiktokHandle && (
          <div className={handleClassName}>@{sender.tiktokHandle}</div>
        )}
      </div>
    </div>
  );
}

function downloadCSV(
  rows: (GiftUser & { rank: number })[],
  period: Period,
  date: string
) {
  const header = "順位,TikTokID,ニックネーム,ギフト数,コイン数\n";
  const body = rows
    .map(
      (r) =>
        `${r.rank},"${r.tiktokHandle ?? ""}","${(r.nickname ?? "").replace(/"/g, '""')}",${r.giftCount},${r.totalDiamonds}`
    )
    .join("\n");
  const blob = new Blob(["﻿" + header + body], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `live-sidestage-analytics_${period}_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadHistoryCSV(events: GiftEvent[], period: Period, date: string) {
  const header = "時刻,TikTokID,ニックネーム,ギフト名,個数,コイン数\n";
  const body = events
    .map(
      (e) =>
        `"${new Date(e.receivedAt).toLocaleString("ja-JP")}","${e.tiktokHandle ?? ""}","${(e.nickname ?? "").replace(/"/g, '""')}","${e.giftName.replace(/"/g, '""')}",${e.repeatCount},${e.totalDiamonds}`
    )
    .join("\n");
  const blob = new Blob(["﻿" + header + body], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `live-sidestage-analytics_history_${period}_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function battleStatusClass(status: BattleStatus): string {
  if (status === "live") return "text-brand";
  if (status === "cut_short") return "text-red-600 dark:text-red-400";
  return "text-muted";
}

/** 対戦相手セル。テーブル行(sm以上)とモバイルカードの両方で使う共通表示。 */
function BattleOpponentInfo({ battle }: { battle: BattleListItem }) {
  const opponent = battle.opponent;
  if (battle.selfTeam && battle.opponentTeam) {
    return <BattleVersus selfTeam={battle.selfTeam} opponentTeam={battle.opponentTeam} size="sm" />;
  }
  if (opponent === null) {
    return <span className="text-muted">対戦相手不明</span>;
  }
  if (opponent.count > 1) {
    return <span className="text-muted">複数人バトル({opponent.count + 1}人)</span>;
  }
  if (opponent.nickname || opponent.tiktokHandle) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <Avatar src={opponent.avatarUrl} alt={opponent.nickname ?? opponent.tiktokHandle ?? "?"} />
        <div className="min-w-0">
          <div className="font-medium truncate max-w-[160px]">
            {opponent.nickname ?? `@${opponent.tiktokHandle}`}
          </div>
          {opponent.tiktokHandle && (
            <div className="text-xs text-muted truncate max-w-[160px]">
              @{opponent.tiktokHandle}
            </div>
          )}
        </div>
      </div>
    );
  }
  return <span className="text-muted">対戦相手不明</span>;
}

/** ギフト名の表示。テーブル行(sm以上)とモバイルカードの両方で使う共通表示。 */
function GiftNameDisplay({ ev }: { ev: GiftEvent }) {
  return (
    <>
      {ev.giftPictureUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ev.giftPictureUrl}
          alt={ev.giftName}
          className="w-6 h-6 object-contain shrink-0"
        />
      )}
      <span className="truncate">
        {ev.giftName}
        {ev.repeatCount > 1 && <span className="text-muted ml-1">×{ev.repeatCount}</span>}
      </span>
    </>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** ギフト画像の下地。透過PNGが多いので、読み込み前後で行の高さと見え方を揃えるために敷く。 */
const GIFT_TILE_BG = "rgba(127,127,127,.12)";
const SKELETON_BG = "rgba(127,127,127,.16)";

const BREAKDOWN_HEADING = (
  <span className="text-[.68rem] tracking-[.06em] font-semibold text-muted">ギフト内訳</span>
);

function BreakdownMessage({ title, body }: { title: string; body?: string }) {
  return (
    <div className="text-[.78rem] text-muted pt-1.5 pb-0.5">
      <b className="block text-[.8rem] font-semibold text-strong mb-0.5">{title}</b>
      {body}
    </div>
  );
}

// ranking表の仮想化(window virtualizer)で使う定数。
// RANKING_ROW_HEIGHT: 通常行(RankingRow)の実測高さ(px)。`estimateSize`にそのまま使い、
// 通常行には`measureElement`を付けない(固定高さのためResizeObserverでの実測コストを避ける)。
// dev:localでPC幅(1000px程度)・スマホ幅(390px程度)双方の実描画をPlaywrightで計測して確定した値
// (実測55.15625pxをtransform/spacer計算の誤差蓄積を避けるため小数のまま採用)。
const RANKING_ROW_HEIGHT = 55.15625;
// RANKING_PANEL_ESTIMATED_HEIGHT: 開閉パネル(RankingBreakdownRow)の初期見積り高さ(px)。
// 実際の高さはgifts件数・ローディング/エラー状態で変わるため、`measureElement`で実測して補正する。
// ここでの値は初回描画時のレイアウトジャンプを減らすための目安に過ぎない。
const RANKING_PANEL_ESTIMATED_HEIGHT = 160;
// overscan: 可視範囲の前後に余分に実描画しておく行数。体感速度とDOM生成コストのバランス。
const RANKING_OVERSCAN = 8;
// ranking表のth列数(#/ユーザー/コイン数/hidden sm/hidden md/展開アイコン)。spacer行・パネル行のcolSpanと揃える。
const RANKING_COLUMN_COUNT = 6;

// history表の仮想化(window virtualizer)で使う定数。
// HISTORY_ROW_HEIGHT: PC用テーブルの1行(tr)の実測高さ(px)。
// dev:local(PC幅1000px)でPlaywrightにより連続する2行の描画位置の差分(top座標の差)を実測して確定した値
// (2026-09-11実測。隣接行間の距離=行自体の高さで、border等の誤差を含めて吸収している)。
const HISTORY_ROW_HEIGHT = 53;
// HISTORY_CARD_HEIGHT: モバイル用カード(div)の実測高さ(px)。
// 単なるカード自体の高さ(126px)ではなく、flex gap-2(0.5rem=8px)を含めた
// 「1カードが占める合計高さ」(連続する2カードの描画位置の差分)で測ること。
// dev:local(スマホ幅390px)でPlaywrightにより実測して確定した値(2026-09-11)。
const HISTORY_CARD_HEIGHT = 134;
// overscan: 可視範囲の前後に余分に実描画しておく行数。体感速度とDOM生成コストのバランス。
// ranking表の RANKING_OVERSCAN=8 に倣い初期値を8とする。
const HISTORY_OVERSCAN = 8;
// history表のth列数(時刻/ユーザー/ギフト/コイン数)。spacer行のcolSpanと揃える。
const HISTORY_COLUMN_COUNT = 4;

// ranking行の通常部分(固定高さ)。sortedFiltered.mapの中でインライン定義していると、内訳の開閉
// (setOpenTiktokUid / setBreakdowns)のたびにAnalyticsView全体が再レンダーされ、視聴者数が多い
// 配信者ではdiffコストが行数に比例して重くなる(ギフト内訳の件数とは無関係)。memoで切り出し、
// 実際に変化した行だけ(以前開いていた行と新しく開いた行)を再レンダー対象にする。
//
// 仮想化(window virtualizer)の「1アイテム=1<tr>」という単位に合わせるため、以前
// Fragmentで2本の<tr>(行本体+開閉パネル)を返していたコンポーネントを分割した。行本体は
// RankingRow、開閉パネルはRankingBreakdownRowが別アイテムとして描画を担う。
// propsは`user`(キーはuser.tiktokUid/user.rank)のみを安定値として使い、配列内位置
// (仮想化アイテムのindex)には一切依存しない。パネル挿入で後続行のインデックスがずれても
// 無関係行のpropsが変わらないため、memo化の効果(開閉時に無関係な行を再レンダーしない)が
// 仮想化後も維持される。
const RankingRow = memo(function RankingRow({
  user,
  open,
  toggleBreakdown,
}: {
  user: GiftUser & { rank: number };
  open: boolean;
  toggleBreakdown: (tiktokUid: string) => void;
}) {
  const panelId = `gift-breakdown-${user.tiktokUid}`;
  const name = displayNameOf(user);
  // TikTokUser 未観測ならハンドルが無く、プロフィールURLを作れない。
  const profileUrl = user.tiktokHandle ? tiktokProfileUrl(user.tiktokHandle) : null;

  return (
    <tr
      // 行全体をポインタでの展開トリガにする。行内のリンク・ボタン
      // (プロフィールリンク、チェブロン)を押したときは展開しない。
      // 個々の子要素の stopPropagation に頼ると、後から要素を足したときに
      // 黙って展開が誤発火するため、ここで一括して弾く。
      // キーボード操作はチェブロンの <button> が担う(行に role/tabIndex を
      // 足すとネストしたインタラクティブ要素になり、かえってa11yが壊れる)。
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        toggleBreakdown(user.tiktokUid);
      }}
      className={`border-b border-row-border hover:bg-row-hover transition-colors cursor-pointer ${
        open ? "bg-row-hover" : user.rank === 1 ? "bg-yellow-500/5" : ""
      }`}
    >
      <td className="py-[9px] px-3 text-right text-muted font-mono text-xs">
        {user.rank}
      </td>
      <td className="py-[9px] px-3">
        <div className="flex items-center gap-2 min-w-0">
          {profileUrl ? (
            <a
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="TikTokプロフィールを開く"
              className="shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <Avatar src={user.profileImageUrl} alt={name} />
            </a>
          ) : (
            <span className="shrink-0">
              <Avatar src={user.profileImageUrl} alt={name} />
            </span>
          )}
          <div className="min-w-0">
            {profileUrl ? (
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="TikTokプロフィールを開く"
                className="font-semibold text-strong truncate max-w-[140px] sm:max-w-none hover:text-brand transition-colors block"
                onClick={(e) => e.stopPropagation()}
              >
                {name}
              </a>
            ) : (
              <span className="font-semibold text-strong truncate max-w-[140px] sm:max-w-none block">
                {name}
              </span>
            )}
            {user.tiktokHandle && profileUrl && (
              <div className="flex items-center gap-1 text-xs text-muted">
                <span className="truncate max-w-[100px]">
                  @{user.tiktokHandle}
                </span>
                <a
                  href={profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted hover:text-brand transition-colors shrink-0"
                  title="TikTokプロフィールを開く"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLinkIcon />
                </a>
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="py-[9px] px-3 text-right font-mono font-bold text-strong">
        {user.totalDiamonds.toLocaleString()}
      </td>
      <td className="py-[9px] px-3 text-right text-muted hidden sm:table-cell">
        {user.giftCount.toLocaleString()}
      </td>
      <td className="py-[9px] px-3 text-right text-muted text-xs hidden md:table-cell">
        {formatRelativeTime(user.lastGiftAt)}
      </td>
      <td className="py-[9px] px-0 text-center">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${name} のギフト内訳を${open ? "閉じる" : "開く"}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleBreakdown(user.tiktokUid);
          }}
          className={`w-[26px] h-[26px] inline-flex items-center justify-center rounded-lg motion-safe:transition-transform duration-150 ${
            open ? "text-brand rotate-180" : "text-muted"
          }`}
        >
          <ChevronDownIcon />
        </button>
      </td>
    </tr>
  );
});

// ranking行の開閉パネル部分(可変高さ)。`openTiktokUid`がセットされているときだけ仮想化
// アイテム配列へ挿入される、独立した1アイテム=1<tr>。可変高さのため、呼び出し元で
// `rowVirtualizer.measureElement`をrefとして渡し、実測させる(通常行は固定高さのため
// 計測しない)。
const RankingBreakdownRow = memo(function RankingBreakdownRow({
  user,
  breakdownState,
  fetchBreakdown,
  index,
  measureRef,
}: {
  user: GiftUser & { rank: number };
  breakdownState: BreakdownState | undefined;
  fetchBreakdown: (tiktokUid: string, opts?: { silent?: boolean }) => Promise<void>;
  index: number;
  measureRef: (node: Element | null) => void;
}) {
  const panelId = `gift-breakdown-${user.tiktokUid}`;
  return (
    <tr ref={measureRef} data-index={index} className="border-b border-row-border">
      <td id={panelId} colSpan={RANKING_COLUMN_COUNT} className="p-0 bg-panel">
        <div className="breakdown-enter pt-2.5 pb-3 px-3 sm:pl-[52px]">
          <GiftBreakdownPanel
            state={breakdownState}
            onRetry={() => void fetchBreakdown(user.tiktokUid)}
          />
        </div>
      </td>
    </tr>
  );
});

function GiftBreakdownPanel({
  state,
  onRetry,
}: {
  state: BreakdownState | undefined;
  onRetry: () => void;
}) {
  if (!state || state.status === "loading") {
    return (
      <div aria-busy="true">
        <div className="mb-2.5">{BREAKDOWN_HEADING}</div>
        {/* パネル幅いっぱいに伸ばすと縞模様に見えるので、ギフト1行ぶんの幅に収める。 */}
        <div className="max-w-[380px]">
          {["78%", "60%", "69%"].map((w) => (
            <div
              key={w}
              className="h-3 rounded my-[9px]"
              style={{ width: w, backgroundColor: SKELETON_BG }}
            />
          ))}
        </div>
        <span className="sr-only">ギフト内訳を読み込み中</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div>
        <div className="mb-2.5">{BREAKDOWN_HEADING}</div>
        <BreakdownMessage title="内訳を取得できませんでした" body="通信に失敗しました。" />
        <button
          type="button"
          onClick={onRetry}
          className="btn-secondary mt-2 text-[.75rem] px-2.5 py-1"
        >
          再試行
        </button>
      </div>
    );
  }

  const { gifts, coverage, truncated } = state.data;

  if (!coverage.detailAvailable) {
    return (
      <div>
        <div className="mb-2.5">{BREAKDOWN_HEADING}</div>
        <BreakdownMessage
          title="この期間の内訳は残っていません"
          body="ギフト明細は90日で削除されます。合計コイン数は集計から表示しています。"
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 flex-wrap mb-2.5">
        {BREAKDOWN_HEADING}
        {coverage.partial && coverage.rawFrom && (
          <span className="ml-auto text-[.68rem] text-muted">{coverage.rawFrom} 以降のみ</span>
        )}
        {truncated && (
          <span className="ml-auto text-[.68rem] text-muted">上位{gifts.length}件のみ表示</span>
        )}
      </div>

      {gifts.length === 0 ? (
        <div className="text-[.78rem] text-muted pt-1.5 pb-0.5">この期間の内訳はありません</div>
      ) : (
        <div className="grid grid-cols-1 gap-y-0.5">
          {gifts.map((g) => (
            <div
              key={g.giftId}
              className="flex items-center gap-2 min-w-0 py-[7px] border-b border-row-border"
            >
              {g.giftPictureUrl ? (
                <img
                  src={g.giftPictureUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-6 h-6 shrink-0 object-contain rounded-md"
                  style={{ backgroundColor: GIFT_TILE_BG }}
                />
              ) : (
                <div
                  className="w-6 h-6 shrink-0 rounded-md"
                  style={{ backgroundColor: GIFT_TILE_BG }}
                  aria-hidden="true"
                />
              )}
              <span className="flex-1 min-w-0 truncate text-[.8rem] text-strong">{g.giftName}</span>
              <span className="shrink-0 font-mono text-[.72rem] text-muted">
                ×{g.repeatCount.toLocaleString()}
              </span>
              <span className="shrink-0 font-mono text-[.8rem] font-bold text-strong min-w-[56px] text-right">
                {g.totalDiamonds.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AnalyticsView({
  apiBase,
  persistBattleFilter,
}: {
  apiBase: string;
  persistBattleFilter?: boolean;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const [currentDate, setCurrentDate] = useState(todayStr());
  const [viewMode, setViewMode] = useState<ViewMode>("ranking");
  const [sortKey, setSortKey] = useState<SortKey>("diamonds");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [historySortKey, setHistorySortKey] = useState<HistorySortKey>("time");
  const [historySortOrder, setHistorySortOrder] = useState<SortOrder>("desc");
  const [filter, setFilter] = useState("");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [historyData, setHistoryData] = useState<HistoryData | null>(null);
  const [battlesData, setBattlesData] = useState<BattlesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [battlesLoading, setBattlesLoading] = useState(false);
  const [openBattleId, setOpenBattleId] = useState<string | null>(null);
  const [openTiktokUid, setOpenTiktokUid] = useState<string | null>(null);
  const [breakdowns, setBreakdowns] = useState<Record<string, BreakdownState>>({});
  const [thresholdDraft, setThresholdDraft] = useState("100");
  const {
    hideLowDiamondEnabled: hideLowDiamond,
    threshold,
    error: settingsError,
    setHideLowDiamond,
    commitThreshold,
  } = useBattleFilterSettings({ enabled: persistBattleFilter ?? false });
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return toLocalDatetimeString(d);
  });
  const [customEnd, setCustomEnd] = useState(() => {
    const d = new Date(); d.setHours(23, 59, 59, 0); return toLocalDatetimeString(d);
  });
  const [pendingStart, setPendingStart] = useState(customStart);
  const [pendingEnd, setPendingEnd] = useState(customEnd);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(
    async (p: Period, d: string, silent = false) => {
      if (!silent) setLoading(true);
      try {
        let url: string;
        if (p === "custom") {
          url = `${apiBase}/gifts?startDatetime=${encodeURIComponent(new Date(customStart).toISOString())}&endDatetime=${encodeURIComponent(new Date(customEnd).toISOString())}&sort=${sortKey}&order=${sortOrder}`;
        } else {
          url = `${apiBase}/gifts?period=${p}&date=${d}&sort=${sortKey}&order=${sortOrder}`;
        }
        const res = await fetch(url);
        if (res.ok) {
          const json = await res.json();
          setData(json);
          setLastRefreshed(new Date());
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [apiBase, sortKey, sortOrder, customStart, customEnd]
  );

  // 内訳キャッシュの有効範囲キー。期間が変わったら内訳は別物になるので破棄する。
  const rangeKey = useMemo(
    () => (period === "custom" ? `custom|${customStart}|${customEnd}` : `${period}|${currentDate}`),
    [period, currentDate, customStart, customEnd]
  );
  // 内訳が属する取得スコープ。期間だけでなく apiBase(admin の対象room)も含める。
  // room を切り替えても同じ期間なら鍵が一致してしまい、旧roomの応答が新roomへ混ざるため。
  const scopeKey = `${apiBase}|${rangeKey}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  // ユーザーごとの発行連番。期間を往復して同じ鍵に戻る(A→B→A)ときは鍵だけでは
  // 追い越しを検出できないので、最新の発行だけを採用する。
  // **スコープが変わってもリセットしない。** リセットすると連番が 1 に戻り、
  // 往復前に投げた古い応答と往復後の新しい応答が同じ番号になって判定が効かなくなる。
  const seqRef = useRef<Record<string, number>>({});

  // thresholdDraft を threshold の変更に同期する(初期 GET 反映時など)
  useEffect(() => {
    setThresholdDraft(threshold.toString());
  }, [threshold]);

  useEffect(() => {
    setOpenTiktokUid(null);
    setBreakdowns({});
  }, [scopeKey]);

  const fetchBreakdown = useCallback(
    async (tiktokUid: string, opts?: { silent?: boolean }) => {
      // 取得中に期間やroomが変わったら、遅れて返ってきた応答でキャッシュを汚さない。
      const issuedFor = scopeRef.current;
      const seq = (seqRef.current[tiktokUid] ?? 0) + 1;
      seqRef.current[tiktokUid] = seq;
      const apply = (next: BreakdownState) => {
        if (scopeRef.current !== issuedFor) return;
        if (seqRef.current[tiktokUid] !== seq) return;
        setBreakdowns((prev) => ({ ...prev, [tiktokUid]: next }));
      };

      // 自動更新での取り直しは、開いているパネルを毎回スケルトンへ戻さない。
      if (!opts?.silent) apply({ status: "loading" });
      try {
        const range =
          period === "custom"
            ? `startDatetime=${encodeURIComponent(new Date(customStart).toISOString())}&endDatetime=${encodeURIComponent(new Date(customEnd).toISOString())}`
            : `period=${period}&date=${currentDate}`;
        const res = await fetch(
          `${apiBase}/gifts/breakdown?${range}&tiktokUid=${encodeURIComponent(tiktokUid)}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        apply({ status: "ready", data: (await res.json()) as GiftBreakdownData });
      } catch {
        // 自動更新の失敗で、表示中の内訳をエラー画面へ落とさない(次の更新で取り直す)。
        if (!opts?.silent) apply({ status: "error" });
      }
    },
    [apiBase, period, currentDate, customStart, customEnd]
  );

  const openTiktokUidRef = useRef(openTiktokUid);
  openTiktokUidRef.current = openTiktokUid;
  const breakdownsRef = useRef(breakdowns);
  breakdownsRef.current = breakdowns;

  // 配信中は15秒ごとにランキングが自動更新される。そのときキャッシュ済みの内訳は古く、
  // 放置すると行のコイン数と内訳の合計が食い違う。開いている行は黙って取り直し、
  // 閉じている行のキャッシュは捨てる(次に開いたときに最新を取る)。
  const prevDataRef = useRef(data);
  useEffect(() => {
    if (prevDataRef.current === data) return;
    const hadPrevious = prevDataRef.current !== null;
    prevDataRef.current = data;
    if (!hadPrevious) return; // 初回ロードには捨てるキャッシュが無い
    const open = openTiktokUidRef.current;
    // 閉じていて(open無し)、かつキャッシュも既に空なら、空→空の付け替えでも再レンダーを起こさない。
    if (!open && Object.keys(breakdownsRef.current).length === 0) return;
    setBreakdowns((prev) => (open && prev[open] ? { [open]: prev[open] } : {}));
    if (open) void fetchBreakdown(open, { silent: true });
  }, [data, fetchBreakdown]);

  const toggleBreakdown = useCallback(
    (tiktokUid: string) => {
      const willOpen = openTiktokUidRef.current !== tiktokUid;
      setOpenTiktokUid(willOpen ? tiktokUid : null);
      // 未取得のときだけ初回fetch。取得済み(成功・失敗とも)は再取得しない
      // (失敗は展開先の「再試行」ボタンから明示的に取り直す)。
      if (willOpen && !breakdownsRef.current[tiktokUid]) void fetchBreakdown(tiktokUid);
    },
    [fetchBreakdown]
  );

  const fetchHistory = useCallback(async (p: Period, d: string, silent = false) => {
    if (!silent) setHistoryLoading(true);
    try {
      let url: string;
      if (p === "custom") {
        url = `${apiBase}/gifts/history?startDatetime=${encodeURIComponent(new Date(customStart).toISOString())}&endDatetime=${encodeURIComponent(new Date(customEnd).toISOString())}`;
      } else {
        url = `${apiBase}/gifts/history?period=${p}&date=${d}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setHistoryData(json);
        setLastRefreshed(new Date());
      }
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  }, [apiBase, customStart, customEnd]);

  const fetchBattles = useCallback(async (p: Period, d: string, silent = false) => {
    if (!silent) setBattlesLoading(true);
    try {
      let url: string;
      if (p === "custom") {
        url = `${apiBase}/battles?startDatetime=${encodeURIComponent(new Date(customStart).toISOString())}&endDatetime=${encodeURIComponent(new Date(customEnd).toISOString())}`;
      } else {
        url = `${apiBase}/battles?period=${p}&date=${d}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        setBattlesData(json);
        setLastRefreshed(new Date());
      }
    } finally {
      if (!silent) setBattlesLoading(false);
    }
  }, [apiBase, customStart, customEnd]);

  useEffect(() => {
    if (viewMode === "ranking") {
      fetchData(period, currentDate);
    } else if (viewMode === "history") {
      fetchHistory(period, currentDate);
    } else {
      fetchBattles(period, currentDate);
    }
  }, [period, currentDate, viewMode, fetchData, fetchHistory, fetchBattles]);

  // ギフト履歴(明細)は90日で削除される(gift-retention-window.ts)ため`year`を選べない。
  // また、ランキング/バトル履歴タブ(366日まで許容)で選んだカスタム期間を引き継いで
  // ギフト履歴タブへ切り替えた場合、90日を超えるcustomStart/customEndがそのまま
  // fetchHistoryへ渡ってしまう(サーバー側は黙ってクランプするだけでUIのラベル・
  // 入力欄には反映されない)。year同様、その場合も`month`へ落とす。
  useEffect(() => {
    if (viewMode !== "history") return;
    if (period === "year") {
      setPeriod("month");
      setCurrentDate(todayStr());
      return;
    }
    if (period === "custom") {
      const start = new Date(customStart).getTime();
      const end = new Date(customEnd).getTime();
      const tooWide =
        !Number.isNaN(start) &&
        !Number.isNaN(end) &&
        end - start > GIFT_HISTORY_MAX_RANGE_DAYS * 86_400_000;
      if (tooWide) {
        setPeriod("month");
        setCurrentDate(todayStr());
      }
    }
  }, [viewMode, period, customStart, customEnd]);

  useEffect(() => {
    if (!showCalendar) return;
    function onMouseDown(e: MouseEvent) {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setShowCalendar(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showCalendar]);

  useEffect(() => {
    if (!showSortMenu) return;
    function onMouseDown(e: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [showSortMenu]);

  const fetchDataRef = useRef(fetchData);
  fetchDataRef.current = fetchData;
  const fetchHistoryRef = useRef(fetchHistory);
  fetchHistoryRef.current = fetchHistory;
  const fetchBattlesRef = useRef(fetchBattles);
  fetchBattlesRef.current = fetchBattles;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  // Combined poll: listener status every 5s + analytics refresh every 15s when connected
  // /api/listener/status はセッション固定roomId前提(一般ユーザー向け)。admin(apiBase!==既定)では
  // 404/401になりうるが、silent refreshが起きないだけで初回fetchには影響しない。
  useEffect(() => {
    let tick = 0;
    async function poll() {
      const res = await fetch("/api/listener/status");
      if (!res.ok) return;
      const d = await res.json();

      tick++;
      const isActive =
        d.listener?.status === "connected" || d.listener?.status === "connecting";
      const isToday = currentDate === todayStr();
      if (tick % 3 === 0 && isActive && isToday) {
        if (viewModeRef.current === "ranking") {
          fetchDataRef.current(period, currentDate, true);
        } else if (viewModeRef.current === "history") {
          fetchHistoryRef.current(period, currentDate, true);
        } else {
          fetchBattlesRef.current(period, currentDate, true);
        }
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [currentDate, period]);

  const sortedFiltered = useMemo(() => {
    if (!data) return [];
    const q = filter.toLowerCase();
    let rows = data.users.filter(
      (u) =>
        !q ||
        (u.tiktokHandle ?? "").toLowerCase().includes(q) ||
        (u.nickname ?? "").toLowerCase().includes(q)
    );

    rows = [...rows].sort((a, b) => {
      let diff = 0;
      if (sortKey === "diamonds") diff = a.totalDiamonds - b.totalDiamonds;
      else if (sortKey === "count") diff = a.giftCount - b.giftCount;
      else if (sortKey === "name")
        diff = displayNameOf(a).localeCompare(displayNameOf(b), "ja");
      else if (sortKey === "recent")
        diff = new Date(a.lastGiftAt).getTime() - new Date(b.lastGiftAt).getTime();
      return sortOrder === "desc" ? -diff : diff;
    });

    return rows.map((u, i) => ({ ...u, rank: i + 1 }));
  }, [data, filter, sortKey, sortOrder]);

  // ranking表の仮想化アイテム配列。通常時はsortedFilteredをそのまま(1件=1アイテム)、
  // openTiktokUidがセットされているときだけ、該当ユーザーの直後に「パネル専用アイテム」を
  // 1件挿入する(同時に開けるのは常に1行、という既存の不変条件を利用した最小構成)。
  // 各アイテムの実データ参照はuser.tiktokUidで行うため、パネル挿入で後続アイテムの配列内
  // 位置がずれても、行コンポーネント自体のpropsは変わらない(memo化の効果を維持する)。
  const rankingVirtualEntries = useMemo(() => {
    if (!openTiktokUid) {
      return sortedFiltered.map((user) => ({ kind: "row" as const, user }));
    }
    const entries: Array<{ kind: "row" | "panel"; user: GiftUser & { rank: number } }> = [];
    for (const user of sortedFiltered) {
      entries.push({ kind: "row", user });
      if (user.tiktokUid === openTiktokUid) {
        entries.push({ kind: "panel", user });
      }
    }
    return entries;
  }, [sortedFiltered, openTiktokUid]);

  // window virtualizerが仮想アイテムの位置をwindowスクロール座標で計算するための、
  // tbody開始位置(ドキュメント先頭からのオフセット)。フィルタパネル・エラー表示・
  // 更新時刻表示などtbodyより上のレイアウトが変わると値がずれるため、依存配列を絞らず
  // 毎レンダー後に再計測する(値が変わらなければsetStateしないため無限ループにはならない)。
  const rankingTbodyRef = useRef<HTMLTableSectionElement>(null);
  const [rankingScrollMargin, setRankingScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = rankingTbodyRef.current;
    const next = el ? el.getBoundingClientRect().top + window.scrollY : 0;
    setRankingScrollMargin((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  });

  const rowVirtualizer = useWindowVirtualizer({
    count: rankingVirtualEntries.length,
    estimateSize: (index) =>
      rankingVirtualEntries[index]?.kind === "panel"
        ? RANKING_PANEL_ESTIMATED_HEIGHT
        : RANKING_ROW_HEIGHT,
    overscan: RANKING_OVERSCAN,
    scrollMargin: rankingScrollMargin,
    getItemKey: (index) => {
      const entry = rankingVirtualEntries[index];
      if (!entry) return index;
      return entry.kind === "panel"
        ? `panel-${entry.user.tiktokUid}`
        : `row-${entry.user.tiktokUid}`;
    },
    // 既定(true)だとパネル行のmeasureElement(ResizeObserver経由)がReactのコミット
    // フェーズ中にflushSyncを呼び、「flushSync was called from inside a lifecycle
    // method」という警告が出る(実測確認済み)。パネルの実測はスクロール中の高頻度更新
    // ではなく開閉時のみなので、同期反映を諦めても体感上の不都合はない。
    useFlushSync: false,
  });

  // history表のPC用(tr)・モバイル用(div)virtualizerのscrollMargin計測。
  // ブレークポイント切替直後は非表示側→表示側の遷移でscrollMarginが古いまま一瞬レンダーされうるが、
  // useLayoutEffectがペイント前に同期補正するため視覚上のちらつきは発生しない。
  const historyTbodyRef = useRef<HTMLTableSectionElement>(null);
  const [historyScrollMargin, setHistoryScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = historyTbodyRef.current;
    if (!el || el.getClientRects().length === 0) return; // 非表示時はスキップ
    const next = el.getBoundingClientRect().top + window.scrollY;
    setHistoryScrollMargin((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  });

  const historyCardListRef = useRef<HTMLDivElement>(null);
  const [historyCardScrollMargin, setHistoryCardScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = historyCardListRef.current;
    if (!el || el.getClientRects().length === 0) return; // 非表示時はスキップ
    const next = el.getBoundingClientRect().top + window.scrollY;
    setHistoryCardScrollMargin((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  });

  const filteredEvents = useMemo(() => {
    if (!historyData) return [];
    const q = filter.toLowerCase();
    let events = !q
      ? historyData.events
      : historyData.events.filter(
          (e) =>
            (e.tiktokHandle ?? "").toLowerCase().includes(q) ||
            (e.nickname ?? "").toLowerCase().includes(q) ||
            e.giftName.toLowerCase().includes(q)
        );

    events = [...events].sort((a, b) => {
      let diff = 0;
      if (historySortKey === "time")
        diff = new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
      else if (historySortKey === "diamonds")
        diff = a.totalDiamonds - b.totalDiamonds;
      else if (historySortKey === "user")
        diff = displayNameOf(a).localeCompare(displayNameOf(b), "ja");
      else if (historySortKey === "gift")
        diff = a.giftName.localeCompare(b.giftName, "ja");
      return historySortOrder === "desc" ? -diff : diff;
    });

    return events;
  }, [historyData, filter, historySortKey, historySortOrder]);

  const historyRowVirtualizer = useWindowVirtualizer({
    count: filteredEvents.length,
    estimateSize: () => HISTORY_ROW_HEIGHT,
    overscan: HISTORY_OVERSCAN,
    scrollMargin: historyScrollMargin,
    getItemKey: (i) => filteredEvents[i]?.id ?? i,
    useFlushSync: false,
  });

  const historyCardVirtualizer = useWindowVirtualizer({
    count: filteredEvents.length,
    estimateSize: () => HISTORY_CARD_HEIGHT,
    overscan: HISTORY_OVERSCAN,
    scrollMargin: historyCardScrollMargin,
    getItemKey: (i) => filteredEvents[i]?.id ?? i,
    useFlushSync: false,
  });

  const filteredBattles = useMemo(() => {
    if (!battlesData) return [];
    const q = filter.toLowerCase();
    return battlesData.battles.filter((b) => {
      if (hideLowDiamond && b.status !== "live" && b.selfTotalDiamonds <= threshold) return false;
      if (!q) return true;
      const opponent = b.opponent;
      return (
        opponent?.tiktokHandle?.toLowerCase().includes(q) ||
        opponent?.nickname?.toLowerCase().includes(q) ||
        false
      );
    });
  }, [battlesData, filter, hideLowDiamond, threshold]);

  // しきい値入力の blur/Enter 時に検証して保存する
  const commitDraft = useCallback(() => {
    const n = Number(thresholdDraft);
    if (Number.isInteger(n) && n >= 0) {
      commitThreshold(n);
    } else {
      // 不正な値なら draft を現在の threshold に戻す
      setThresholdDraft(threshold.toString());
    }
  }, [thresholdDraft, threshold, commitThreshold]);

  // ギフト履歴のカスタム期間は、明細の保持期間(90日、gift-retention-window.tsの
  // GIFT_RETENTION_DAYS)より前の開始日時を選ばせない。サーバー側のクランプ
  // (clampGiftHistoryDatetimeRange)と同じ式(終了日時 - 90日、日付境界の-1補正はしない。
  // それは日キー版のclampGiftHistoryDayRange専用)で計算する。
  const historyRangeMinStart = useMemo(() => {
    if (viewMode !== "history") return undefined;
    const end = new Date(pendingEnd);
    if (Number.isNaN(end.getTime())) return undefined;
    return toLocalDatetimeString(
      new Date(end.getTime() - GIFT_HISTORY_MAX_RANGE_DAYS * 86_400_000)
    );
  }, [viewMode, pendingEnd]);

  return (
    <>
    <main className="max-w-4xl mx-auto w-full px-4 py-4 space-y-4">
        {/* Period tabs + View mode toggle */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-0.5 bg-panel border border-border rounded-seg p-[3px] w-fit">
            {(
              viewMode === "history"
                ? (["day", "week", "month"] as Period[])
                : (["day", "week", "month", "year"] as Period[])
            ).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setPeriod(p);
                  setCurrentDate(todayStr());
                }}
                className={`px-[13px] py-[7px] rounded-[5px] text-[.78rem] font-semibold transition-colors ${
                  period === p
                    ? "bg-brand text-on-accent shadow-[0_1px_2px_rgba(16,24,40,.08)]"
                    : "text-muted hover:text-strong"
                }`}
              >
                {p === "day" ? "日" : p === "week" ? "週" : p === "month" ? "月" : "年"}
              </button>
            ))}
            <div className="w-px bg-border mx-0.5 self-stretch" />
            <div className="relative" ref={calendarRef}>
              <button
                onClick={() => {
                  setPendingStart(customStart);
                  setPendingEnd(customEnd);
                  setShowCalendar((v) => !v);
                }}
                className={`px-2 py-[7px] rounded-[5px] text-[.78rem] font-semibold transition-colors flex items-center gap-1 ${
                  period === "custom"
                    ? "bg-brand text-on-accent shadow-[0_1px_2px_rgba(16,24,40,.08)]"
                    : "text-muted hover:text-strong"
                }`}
                title="カスタム期間"
              >
                <CalendarIcon />
              </button>
              {showCalendar && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-panel border border-border rounded-xl p-4 shadow-xl w-72">
                  <p className="text-xs text-muted mb-3 font-medium">カスタム期間</p>
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-muted block mb-1">開始日時</label>
                      <input
                        type="datetime-local"
                        step="1"
                        value={pendingStart}
                        min={historyRangeMinStart}
                        onChange={(e) => setPendingStart(e.target.value)}
                        className="input-field text-sm w-full"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted block mb-1">終了日時</label>
                      <input
                        type="datetime-local"
                        step="1"
                        value={pendingEnd}
                        onChange={(e) => setPendingEnd(e.target.value)}
                        className="input-field text-sm w-full"
                      />
                    </div>
                    {viewMode === "history" && (
                      <p className="text-xs text-muted">
                        ギフト履歴の明細は受信から90日で削除されるため、開始日時はそれより前を選べません。
                      </p>
                    )}
                    <button
                      onClick={() => {
                        setCustomStart(pendingStart);
                        setCustomEnd(pendingEnd);
                        setPeriod("custom");
                        setShowCalendar(false);
                      }}
                      disabled={
                        !pendingStart ||
                        !pendingEnd ||
                        pendingStart >= pendingEnd ||
                        (!!historyRangeMinStart && pendingStart < historyRangeMinStart)
                      }
                      className="w-full bg-brand text-on-accent rounded-lg py-2 text-sm font-medium hover:bg-brand-hover disabled:opacity-40 transition-colors"
                    >
                      適用
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-0.5 bg-panel border border-border rounded-seg p-[3px] w-fit">
            {(["ranking", "history", "battles"] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-[13px] py-[7px] rounded-[5px] text-[.78rem] font-semibold transition-colors ${
                  viewMode === m
                    ? "bg-brand text-on-accent shadow-[0_1px_2px_rgba(16,24,40,.08)]"
                    : "text-muted hover:text-strong"
                }`}
              >
                {m === "ranking" ? "ユーザー別コイン数" : m === "history" ? "ギフト履歴" : "バトル履歴"}
              </button>
            ))}
          </div>
        </div>

        {/* Date navigation */}
        <div className="flex items-center gap-2">
          {period !== "custom" && (
            <button
              onClick={() => setCurrentDate(navigateDate(period, currentDate, -1))}
              className="btn-ghost px-2 py-1 text-lg leading-none"
            >
              ‹
            </button>
          )}
          <span className="text-sm font-medium text-strong min-w-0 text-center flex-1 truncate">
            {period === "custom"
              ? formatCustomRangeLabel(customStart, customEnd)
              : formatPeriodLabel(period, currentDate)}
          </span>
          {period !== "custom" && (
            <>
              <button
                onClick={() => setCurrentDate(navigateDate(period, currentDate, 1))}
                disabled={currentDate >= todayStr()}
                className="btn-ghost px-2 py-1 text-lg leading-none disabled:opacity-30"
              >
                ›
              </button>
              {currentDate !== todayStr() && (
                <button
                  onClick={() => setCurrentDate(todayStr())}
                  className="btn-ghost text-xs"
                >
                  今日
                </button>
              )}
            </>
          )}
        </div>

        {/* Filter + Sort + Export */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[160px]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={
                viewMode === "history"
                  ? "ユーザー・ギフト名で絞り込み..."
                  : viewMode === "battles"
                    ? "対戦相手を絞り込み..."
                    : "ユーザーを絞り込み..."
              }
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="input-field pl-9 text-sm"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {(viewMode === "ranking" || viewMode === "history") && (
              <div className="relative" ref={sortMenuRef}>
                <button
                  onClick={() => setShowSortMenu((v) => !v)}
                  className="btn-ghost text-[.76rem] font-semibold px-2.5 py-2"
                >
                  並び替え ▾
                </button>
                {showSortMenu && (
                  <div className="absolute top-full right-0 mt-1 z-50 bg-panel border border-border rounded-xl p-3 shadow-xl w-48 flex items-center gap-1.5">
                    {viewMode === "ranking" ? (
                      <>
                        <select
                          value={sortKey}
                          onChange={(e) => setSortKey(e.target.value as SortKey)}
                          className="input-field text-sm w-auto pr-8 appearance-none cursor-pointer"
                        >
                          {(Object.entries(SORT_LABELS) as [SortKey, string][]).map(
                            ([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            )
                          )}
                        </select>
                        <button
                          onClick={() =>
                            setSortOrder((o) => (o === "desc" ? "asc" : "desc"))
                          }
                          className="btn-ghost px-2 py-2 text-sm shrink-0"
                          title={sortOrder === "desc" ? "降順" : "昇順"}
                        >
                          {sortOrder === "desc" ? "↓" : "↑"}
                        </button>
                      </>
                    ) : (
                      <>
                        <select
                          value={historySortKey}
                          onChange={(e) => setHistorySortKey(e.target.value as HistorySortKey)}
                          className="input-field text-sm w-auto pr-8 appearance-none cursor-pointer"
                        >
                          {(Object.entries(HISTORY_SORT_LABELS) as [HistorySortKey, string][]).map(
                            ([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            )
                          )}
                        </select>
                        <button
                          onClick={() =>
                            setHistorySortOrder((o) => (o === "desc" ? "asc" : "desc"))
                          }
                          className="btn-ghost px-2 py-2 text-sm shrink-0"
                          title={historySortOrder === "desc" ? "降順" : "昇順"}
                        >
                          {historySortOrder === "desc" ? "↓" : "↑"}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {viewMode !== "battles" && (
              <button
                onClick={() => {
                  if (viewMode === "ranking") {
                    downloadCSV(sortedFiltered, period, currentDate);
                  } else {
                    downloadHistoryCSV(filteredEvents, period, currentDate);
                  }
                }}
                disabled={viewMode === "ranking" ? sortedFiltered.length === 0 : filteredEvents.length === 0}
                className="btn-ghost flex items-center gap-1 text-xs disabled:opacity-30"
                title="CSV出力"
              >
                <DownloadIcon />
                <span className="hidden sm:inline">CSV</span>
              </button>
            )}

          </div>
        </div>

        {/* Stats bar + Table */}
        <div className="relative">
          <div className="space-y-4">
        {viewMode === "ranking" && data && (
          <div className="flex gap-4 text-[.74rem] text-muted flex-wrap">
            <span>
              <b className="text-strong font-bold">{filter ? sortedFiltered.length : data.users.length}</b>
              {filter ? ` / ${data.users.length} 人` : " 人"}
            </span>
            <span>
              合計{" "}
              <b className="text-strong font-bold">
                {sortedFiltered.reduce((s, u) => s + u.totalDiamonds, 0).toLocaleString()}
              </b>{" "}
              コイン
            </span>
            <span>
              ギフト{" "}
              <b className="text-strong font-bold">
                {sortedFiltered.reduce((s, u) => s + u.giftCount, 0).toLocaleString()}
              </b>{" "}
              件
            </span>
            {lastRefreshed && (
              <span className="ml-auto">
                更新 {lastRefreshed.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        )}

        {viewMode === "history" && historyData && (
          <div className="flex gap-4 text-[.74rem] text-muted flex-wrap">
            <span>
              <b className="text-strong font-bold">{filter ? filteredEvents.length : historyData.events.length}</b>
              {filter ? ` / ${historyData.events.length} 件` : " 件"}
            </span>
            <span>
              合計{" "}
              <b className="text-strong font-bold">
                {filteredEvents.reduce((s, e) => s + e.totalDiamonds, 0).toLocaleString()}
              </b>{" "}
              コイン
            </span>
            {lastRefreshed && (
              <span className="ml-auto">
                更新 {lastRefreshed.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        )}

        {viewMode === "battles" && battlesData && (
          <div className="flex gap-4 text-[.74rem] text-muted flex-wrap items-center">
            <span>
              {filter || hideLowDiamond
                ? `${filteredBattles.length} / ${battlesData.battles.length} 件`
                : `${battlesData.battles.length} 件`}
            </span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideLowDiamond}
                onChange={(e) => setHideLowDiamond(e.target.checked)}
                className="cursor-pointer"
              />
              コイン
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={thresholdDraft}
                onChange={(e) => setThresholdDraft(e.target.value)}
                onBlur={commitDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label="非表示にするコイン数のしきい値"
                className="input-field text-sm w-20 px-2 py-1 text-right"
              />
              以下を非表示
            </label>
            {settingsError && (
              <span className="text-red-400 text-xs">{settingsError}</span>
            )}
            {lastRefreshed && (
              <span className="ml-auto">
                更新 {lastRefreshed.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        )}

        {/* Ranking Table */}
        {viewMode === "ranking" && (
          loading ? (
            <div className="text-center py-16 text-muted">読み込み中...</div>
          ) : sortedFiltered.length === 0 ? (
            <div className="text-center py-16 text-muted">
              {filter ? "一致するユーザーなし" : "この期間のデータなし"}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-card border border-border shadow-[0_1px_2px_rgba(16,24,40,.05)]">
              <table className="w-full text-[.84rem]">
                <thead>
                  <tr className="border-b border-border text-[.68rem] tracking-[.02em] text-muted bg-panel">
                    <th className="py-[9px] px-3 text-right w-10 font-semibold">#</th>
                    <th className="py-[9px] px-3 text-left font-semibold">ユーザー</th>
                    <th className="py-[9px] px-3 text-right font-semibold">
                      <span title="コイン数">💎</span>
                    </th>
                    <th className="py-[9px] px-3 text-right hidden sm:table-cell font-semibold">
                      <span title="ギフト数">🎁</span>
                    </th>
                    <th className="py-[9px] px-3 text-right hidden md:table-cell font-semibold text-muted">
                      最終
                    </th>
                    <th className="w-[34px]">
                      <span className="sr-only">ギフト内訳</span>
                    </th>
                  </tr>
                </thead>
                <tbody ref={rankingTbodyRef}>
                  {(() => {
                    const virtualRows = rowVirtualizer.getVirtualItems();
                    const totalSize = rowVirtualizer.getTotalSize();
                    const paddingTop =
                      virtualRows.length > 0 ? virtualRows[0].start - rankingScrollMargin : 0;
                    const paddingBottom =
                      virtualRows.length > 0
                        ? totalSize + rankingScrollMargin - virtualRows[virtualRows.length - 1].end
                        : 0;
                    return (
                      <>
                        {paddingTop > 0 && (
                          <tr aria-hidden="true">
                            <td colSpan={RANKING_COLUMN_COUNT} style={{ height: paddingTop, padding: 0, border: 0 }} />
                          </tr>
                        )}
                        {virtualRows.map((virtualRow) => {
                          const entry = rankingVirtualEntries[virtualRow.index];
                          if (!entry) return null;
                          if (entry.kind === "panel") {
                            return (
                              <RankingBreakdownRow
                                key={virtualRow.key}
                                user={entry.user}
                                breakdownState={breakdowns[entry.user.tiktokUid]}
                                fetchBreakdown={fetchBreakdown}
                                index={virtualRow.index}
                                measureRef={rowVirtualizer.measureElement}
                              />
                            );
                          }
                          return (
                            <RankingRow
                              key={virtualRow.key}
                              user={entry.user}
                              open={openTiktokUid === entry.user.tiktokUid}
                              toggleBreakdown={toggleBreakdown}
                            />
                          );
                        })}
                        {paddingBottom > 0 && (
                          <tr aria-hidden="true">
                            <td colSpan={RANKING_COLUMN_COUNT} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                          </tr>
                        )}
                      </>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* History Table */}
        {viewMode === "history" && (
          historyLoading ? (
            <div className="text-center py-16 text-muted">読み込み中...</div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-16 text-muted">
              {filter ? "一致するイベントなし" : "この期間のデータなし"}
            </div>
          ) : (
            <>
              {/* モバイル(sm未満): カード表示。列間引きだけでは長いギフト名が収まらないため */}
              <div ref={historyCardListRef} className="sm:hidden flex flex-col gap-2">
                {(() => {
                  const virtualCards = historyCardVirtualizer.getVirtualItems();
                  const totalSize = historyCardVirtualizer.getTotalSize();
                  const paddingTop =
                    virtualCards.length > 0 ? virtualCards[0].start - historyCardScrollMargin : 0;
                  const paddingBottom =
                    virtualCards.length > 0
                      ? totalSize + historyCardScrollMargin - virtualCards[virtualCards.length - 1].end
                      : 0;
                  return (
                    <>
                      {paddingTop > 0 && (
                        <div aria-hidden="true" style={{ height: paddingTop }} />
                      )}
                      {virtualCards.map((virtualCard) => {
                        const ev = filteredEvents[virtualCard.index];
                        if (!ev) return null;
                        return (
                          <div key={virtualCard.key} className="rounded-xl border border-border bg-panel p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <SenderIdentity
                                sender={ev}
                                nameClassName="font-medium truncate max-w-[160px]"
                                handleClassName="text-xs text-muted truncate max-w-[160px]"
                              />
                              <span className="text-xs text-muted whitespace-nowrap shrink-0">
                                {formatEventTime(ev.receivedAt, period)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <GiftNameDisplay ev={ev} />
                            </div>
                            <div className="flex items-center justify-end">
                              <span className="font-mono font-medium text-sm">
                                💎{ev.totalDiamonds.toLocaleString()}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {paddingBottom > 0 && (
                        <div aria-hidden="true" style={{ height: paddingBottom }} />
                      )}
                    </>
                  );
                })()}
              </div>

              {/* sm以上: テーブル表示 */}
              <div className="hidden sm:block overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted">
                    <th className="py-2.5 px-3 text-left whitespace-nowrap">時刻</th>
                    <th className="py-2.5 px-3 text-left">ユーザー</th>
                    <th className="py-2.5 px-3 text-left">ギフト</th>
                    <th className="py-2.5 px-3 text-right">
                      <span title="コイン数">💎</span>
                    </th>
                  </tr>
                </thead>
                <tbody ref={historyTbodyRef}>
                  {(() => {
                    const virtualRows = historyRowVirtualizer.getVirtualItems();
                    const totalSize = historyRowVirtualizer.getTotalSize();
                    const paddingTop =
                      virtualRows.length > 0 ? virtualRows[0].start - historyScrollMargin : 0;
                    const paddingBottom =
                      virtualRows.length > 0
                        ? totalSize + historyScrollMargin - virtualRows[virtualRows.length - 1].end
                        : 0;
                    return (
                      <>
                        {paddingTop > 0 && (
                          <tr aria-hidden="true">
                            <td colSpan={HISTORY_COLUMN_COUNT} style={{ height: paddingTop, padding: 0, border: 0 }} />
                          </tr>
                        )}
                        {virtualRows.map((virtualRow) => {
                          const ev = filteredEvents[virtualRow.index];
                          if (!ev) return null;
                          return (
                            <tr
                              key={virtualRow.key}
                              className="border-b border-row-border hover:bg-row-hover transition-colors"
                            >
                              <td className="py-2 px-3 text-xs text-muted whitespace-nowrap">
                                {formatEventTime(ev.receivedAt, period)}
                              </td>
                              <td className="py-2 px-3">
                                <SenderIdentity
                                  sender={ev}
                                  nameClassName="font-medium truncate max-w-[120px] sm:max-w-[200px]"
                                  handleClassName="text-xs text-muted truncate max-w-[100px]"
                                />
                              </td>
                              <td className="py-2 px-3">
                                <div className="flex items-center gap-1.5 min-w-0 max-w-[150px] sm:max-w-none">
                                  <GiftNameDisplay ev={ev} />
                                </div>
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-medium">
                                {ev.totalDiamonds.toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                        {paddingBottom > 0 && (
                          <tr aria-hidden="true">
                            <td colSpan={HISTORY_COLUMN_COUNT} style={{ height: paddingBottom, padding: 0, border: 0 }} />
                          </tr>
                        )}
                      </>
                    );
                  })()}
                </tbody>
              </table>
              </div>
            </>
          )
        )}

        {/* Battles Table */}
        {viewMode === "battles" && (
          battlesLoading ? (
            <div className="text-center py-16 text-muted">読み込み中...</div>
          ) : filteredBattles.length === 0 ? (
            <div className="text-center py-16 text-muted">
              {filter ? "一致するバトルなし" : "この期間のバトルなし"}
            </div>
          ) : (
            <>
              {/* モバイル(sm未満): カード表示。列間引きでは対戦相手名・スコアが収まらないため */}
              <div className="sm:hidden space-y-2">
                {filteredBattles.map((battle) => (
                  <div
                    key={battle.battleId}
                    onClick={() => setOpenBattleId(battle.battleId)}
                    className="rounded-xl border border-border bg-panel p-3 space-y-2 cursor-pointer active:bg-row-hover transition-colors"
                  >
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span className="whitespace-nowrap">{formatEventTime(battle.startedAt, period)}</span>
                      <span className={`whitespace-nowrap ${battleStatusClass(battle.status)}`}>
                        {BATTLE_STATUS_LABELS[battle.status]}
                      </span>
                    </div>
                    <BattleOpponentInfo battle={battle} />
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm">
                        <BattleScoreLine battle={battle} />
                      </span>
                      <span className="font-mono text-xs text-muted whitespace-nowrap">
                        💎{battle.selfTotalDiamonds.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* sm以上: テーブル表示 */}
              <div className="hidden sm:block overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted">
                      <th className="py-2.5 px-3 text-left whitespace-nowrap">時刻</th>
                      <th className="py-2.5 px-3 text-left">対戦相手</th>
                      <th className="py-2.5 px-3 text-right">スコア</th>
                      <th className="py-2.5 px-3 text-center whitespace-nowrap">状態</th>
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">コイン</th>
                      <th className="py-2.5 px-3 text-center w-10">詳細</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBattles.map((battle) => {
                      return (
                        <tr
                          key={battle.battleId}
                          onClick={() => setOpenBattleId(battle.battleId)}
                          className="border-b border-row-border hover:bg-row-hover transition-colors cursor-pointer"
                        >
                          <td className="py-2 px-3 text-xs text-muted whitespace-nowrap">
                            {formatEventTime(battle.startedAt, period)}
                          </td>
                          <td className="py-2 px-3">
                            <BattleOpponentInfo battle={battle} />
                          </td>
                          <td className="py-2 px-3 text-right font-mono whitespace-nowrap">
                            <BattleScoreLine battle={battle} />
                          </td>
                          <td className="py-2 px-3 text-center text-xs whitespace-nowrap">
                            <span className={battleStatusClass(battle.status)}>
                              {BATTLE_STATUS_LABELS[battle.status]}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono whitespace-nowrap">
                            💎{battle.selfTotalDiamonds.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenBattleId(battle.battleId);
                              }}
                              className="btn-ghost p-1.5"
                              title="貢献者一覧を見る"
                            >
                              詳細
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
          </div>
        </div>
      </main>
    <BattleDetailModal
      battle={battlesData?.battles.find((b) => b.battleId === openBattleId) ?? null}
      onClose={() => setOpenBattleId(null)}
      apiBase={apiBase}
    />
    </>
  );
}

function CalendarIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-3 h-3"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-4 h-4"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "今";
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}
