"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { STATUS_CLASSES, STATUS_LABELS } from "@/event/labels";
import type { EventStatus } from "@/event/validation";

// RUNNING への遷移は集計ワーカーの対象になることを意味する(フェーズ3以降)。
// 取り消せる遷移だけをここに出す。
//
// SCHEDULED → RUNNING(開催中にする)だけはここに入れない。集計ワーカーの対象は
// status ∈ {RUNNING, FINISHED}(src/event/aggregate.ts)なので、これを押すまで
// このイベントは1件も集計されず、公開ページの順位表も空のまま止まる。
// 運用上の起点であって他の遷移と同格ではないため、下で主操作として別に出す。
const NEXT_STATUS: Partial<Record<EventStatus, { to: EventStatus; label: string }[]>> = {
  RUNNING: [{ to: "FINISHED", label: "終了にする" }],
  FINISHED: [
    { to: "RUNNING", label: "開催中に戻す" },
    { to: "ARCHIVED", label: "アーカイブする" },
  ],
  ARCHIVED: [{ to: "FINISHED", label: "アーカイブを解除する" }],
};

// 公開範囲が非公開のときの注記。findPublicEvent()(src/event/public-event.ts)と対になっている
// — オーナー自身は非公開でも公開ページを開けるが、それ以外には見えないことを伝える。
function privateNotice(visibility: string): string | null {
  if (visibility === "PRIVATE") {
    return "公開範囲が「非公開」のため、あなた(主催者)以外には表示されない。「開く」はあなた自身のプレビュー用。";
  }
  return null;
}

export function EventAdminControls({
  id,
  slug,
  status,
  visibility,
}: {
  id: string;
  slug: string;
  status: string;
  visibility: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const notice = privateNotice(visibility);

  // origin はサーバーレンダリング時には存在しない。初回レンダーで参照すると
  // サーバー(相対パス)とクライアント(絶対URL)で出力が食い違い、hydration エラーになる。
  // マウント後に埋めることで初回レンダーをサーバーと一致させる。
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const publicUrl = `${origin}/e/${slug}`;

  async function changeStatus(to: EventStatus) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/events/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: to }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.errors?.[0] ?? body?.error ?? "変更に失敗した。");
      return;
    }
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("このイベントを削除する。参加者・集計結果も消える。元に戻せない。")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "削除に失敗した。");
      return;
    }
    router.push("/events");
    router.refresh();
  }

  return (
    <div className="card">
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {status === "SCHEDULED" ? (
        // 開始前だけ、ステータス行をまるごと主操作のブロックに置き換える。
        // 押されない限りこのイベントでは何も起きないので、他の操作と見た目を揃えない。
        <div className="rounded-lg border border-brand/40 bg-brand/[0.07] p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES.SCHEDULED}`}>
                  {STATUS_LABELS.SCHEDULED}
                </span>
                <span className="text-sm font-bold text-white">集計はまだ始まっていない</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-400">
                押すまで集計は動かず、公開ページの順位表も空のまま。
              </p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                (開始後は日程内のギフトを遡って数え直すので、押し遅れても取りこぼさない)
              </p>
            </div>
            <button
              onClick={() => changeStatus("RUNNING")}
              disabled={busy}
              className="btn-primary flex w-full shrink-0 items-center justify-center gap-2 px-6 py-3 text-base shadow-lg shadow-brand/30 ring-1 ring-inset ring-white/20 sm:w-auto"
            >
              <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 fill-current">
                <path d="M2 1.5v9l8-4.5-8-4.5Z" />
              </svg>
              開催中にする
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES[status as EventStatus]}`}
          >
            {/* 開催中は公開ページの LIVE バッジと同じ見た目にして、開始できていることを一目で分かるようにする。 */}
            {status === "RUNNING" && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="motion-safe:absolute motion-safe:inline-flex motion-safe:h-full motion-safe:w-full motion-safe:animate-ping motion-safe:rounded-full motion-safe:bg-green-400/75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
              </span>
            )}
            {STATUS_LABELS[status as EventStatus]}
          </span>
          {(NEXT_STATUS[status as EventStatus] ?? []).map(({ to, label }) => (
            <button key={to} onClick={() => changeStatus(to)} disabled={busy} className="btn-ghost text-xs">
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <span className="label">公開ページ</span>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1.5 font-mono text-xs text-gray-300">
            {publicUrl}
          </code>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(publicUrl);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
            className="btn-ghost shrink-0 text-xs"
          >
            {copied ? "コピーした" : "URLをコピー"}
          </button>
          <a href={`/e/${slug}`} target="_blank" rel="noreferrer" className="btn-ghost shrink-0 text-xs">
            開く
          </a>
        </div>
        {notice && <p className="mt-2 text-xs text-amber-400">{notice}</p>}
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <button onClick={remove} disabled={busy} className="text-xs text-red-400 hover:underline">
          このイベントを削除する
        </button>
      </div>
    </div>
  );
}
