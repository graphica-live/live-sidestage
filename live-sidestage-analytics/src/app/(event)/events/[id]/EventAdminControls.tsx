"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STATUS_CLASSES, STATUS_LABELS } from "@/event/labels";
import type { ReadinessTask } from "@/event/readiness";
import { STATUS_TRANSITIONS } from "@/event/status-transition";
import type { EventStatus } from "@/event/validation";

// 残タスクを出すのは、まだ開催に向けて動いている状態のときだけ。
// 終了・アーカイブでは「開催までに何をするか」に意味がない。
const SHOW_TASKS_IN: EventStatus[] = ["SCHEDULED", "RUNNING"];

// 公開範囲が非公開のときの注記。findPublicEvent()(src/event/public-event.ts)と対になっている
// — オーナー自身は非公開でも公開ページを開けるが、それ以外には見えないことを伝える。
function privateNotice(visibility: string): string | null {
  if (visibility === "PRIVATE") {
    return "公開範囲が「非公開」のため、あなた(主催者)以外には表示されない。「開く」はあなた自身のプレビュー用。";
  }
  return null;
}

/**
 * 開催までの残タスク。クリックでそのタスクを片付ける画面へ飛ぶ。
 *
 * `blocking` は「これが残っていると開催中にできない」もの。任意のタスクと混ぜず、
 * マーカーと文言で区別する(サーバー側 `PATCH /api/events/{id}` も同じ判定で弾く)。
 */
function ReadinessList({ tasks }: { tasks: ReadinessTask[] }) {
  if (tasks.length === 0) {
    return (
      <p className="mt-3 border-t border-border pt-3 text-xs text-gray-500">
        開催までの残タスクはない。
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <span className="label">開催までの残タスク</span>
      <ul className="grid gap-1.5">
        {tasks.map((task) => (
          <li key={task.key}>
            <Link
              href={task.href}
              className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 transition-colors hover:border-brand/40"
            >
              <span
                className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                  task.blocking ? "bg-red-400/10 text-red-400" : "bg-white/5 text-gray-400"
                }`}
              >
                {task.blocking ? "必須" : "任意"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-white">{task.label}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{task.detail}</span>
              </span>
              <span className="mt-0.5 shrink-0 text-xs text-gray-500">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EventAdminControls({
  id,
  slug,
  status,
  visibility,
  readinessTasks,
  eventsOrigin,
}: {
  id: string;
  slug: string;
  status: string;
  visibility: string;
  readinessTasks: ReadinessTask[];
  eventsOrigin: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const notice = privateNotice(visibility);

  const transitions = STATUS_TRANSITIONS[status as EventStatus] ?? [];
  const blocked = readinessTasks.some((task) => task.blocking);
  const showTasks = SHOW_TASKS_IN.includes(status as EventStatus);

  const publicUrl = `${eventsOrigin}/e/${slug}`;

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
      // 準備不足・状態の食い違いで弾かれたときは、サーバーの現状を取り直して
      // 残タスクとボタンを描き直す(別タブで先に操作されている場合がある)。
      router.refresh();
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
        // 押されない限りこのイベントでは何も起きない(集計ワーカーの対象は
        // status ∈ {RUNNING, FINISHED} — src/event/aggregate.ts)ので、
        // 他の遷移と同格には並べない。
        //
        // **必須の残タスクが残っている間は押せない。** 押しても
        // `PATCH /api/events/{id}` が 409 NOT_READY で弾くので、ここで止めて
        // 理由(すぐ下の残タスク一覧)へ誘導する。
        <div
          className={`rounded-lg border p-4 ${
            blocked ? "border-border bg-surface" : "border-brand/40 bg-brand/[0.07]"
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES.SCHEDULED}`}>
                  {STATUS_LABELS.SCHEDULED}
                </span>
                <span className="text-sm font-bold text-white">
                  {blocked ? "開催の準備が終わっていない" : "集計はまだ始まっていない"}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-400">
                {blocked
                  ? "下の必須タスクを片付けると開催中にできる。"
                  : "押すまで集計は動かず、公開ページの順位表も空のまま。"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">
                (開始後は日程内のギフトを遡って数え直すので、押し遅れても取りこぼさない)
              </p>
            </div>
            <button
              onClick={() => changeStatus("RUNNING")}
              disabled={busy || blocked}
              title={blocked ? "必須の残タスクが片付いていない。" : undefined}
              className="btn-primary flex w-full shrink-0 items-center justify-center gap-2 px-6 py-3 text-base shadow-lg shadow-brand/30 ring-1 ring-inset ring-white/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none sm:w-auto"
            >
              <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 fill-current">
                <path d="M2 1.5v9l8-4.5-8-4.5Z" />
              </svg>
              開催中にする
            </button>
          </div>

          {/* 開催準備中から RUNNING 以外の遷移を足したときに、ここから黙って消えないようにする。 */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {transitions
              .filter((t) => t.to !== "RUNNING")
              .map(({ to, label }) => (
                <button key={to} onClick={() => changeStatus(to)} disabled={busy} className="btn-ghost text-xs">
                  {label}
                </button>
              ))}
            {/* 削除は他の遷移ボタンと同じ並びに置く。詳細ページの奥底に隠すと存在に気づかれない。 */}
            <button onClick={remove} disabled={busy} className="btn-ghost text-xs text-red-400">
              このイベントを削除する
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
          {transitions.map(({ to, label }) => {
            // 終了・アーカイブから開催中へ戻すときも、開始と同じ準備チェックを課す
            // (サーバー側も同じ判定で弾く)。
            const disabled = busy || (to === "RUNNING" && blocked);
            return (
              <button
                key={to}
                onClick={() => changeStatus(to)}
                disabled={disabled}
                title={to === "RUNNING" && blocked ? "必須の残タスクが片付いていない。" : undefined}
                className="btn-ghost text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                {label}
              </button>
            );
          })}
          {/* 削除は他の遷移ボタンと同じ並びに置く。詳細ページの奥底に隠すと存在に気づかれない。 */}
          <button onClick={remove} disabled={busy} className="btn-ghost text-xs text-red-400">
            このイベントを削除する
          </button>
        </div>
      )}

      {showTasks && <ReadinessList tasks={readinessTasks} />}

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
    </div>
  );
}
