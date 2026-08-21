"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ENTRY_MODE_LABELS,
  FORMAT_DESCRIPTIONS,
  FORMAT_LABELS,
  TEAM_PRESET_LABELS,
  VISIBILITY_LABELS,
} from "@/event/labels";
import {
  ENTRY_MODES,
  EVENT_FORMATS,
  MAX_EVENT_SESSIONS,
  MAX_SESSION_NAME_LENGTH,
  TEAM_PRESETS,
  VISIBILITIES,
  type EntryMode,
  type EventFormat,
  type TeamPreset,
  type Visibility,
} from "@/event/validation";

/** 1つの開催日程。日時は JST の "YYYY-MM-DDTHH:mm"。 */
export type SessionFormValue = {
  name: string;
  startAt: string;
  endAt: string;
};

export type EventFormValues = {
  title: string;
  description: string;
  format: EventFormat;
  entryMode: EntryMode;
  teamPreset: TeamPreset;
  visibility: Visibility;
  /** 1件以上。2件以上にすると日程の隙間は集計されない */
  sessions: SessionFormValue[];
};

/**
 * "YYYY-MM-DDTHH:mm" の日付だけ1日進める。日程を足すときの初期値用。
 *
 * 文字列のまま `Date` を経由せずに計算する — ブラウザのタイムゾーンで解釈すると
 * JST 以外の環境で日付がずれる。
 */
function nextDay(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!m) return value;
  const [, year, month, day, time] = m;
  const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${time}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function EventForm({
  mode,
  eventId,
  initial,
}: {
  mode: "create" | "edit";
  eventId?: string;
  initial: EventFormValues;
}) {
  const router = useRouter();
  const [values, setValues] = useState<EventFormValues>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const setSession = (index: number, patch: Partial<SessionFormValue>) =>
    setValues((prev) => ({
      ...prev,
      sessions: prev.sessions.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));

  const addSession = () =>
    setValues((prev) => {
      // 直前の日程の翌日・同じ時間帯を初期値にする(「1日目 22時 / 2日目 22時」が多い)。
      const last = prev.sessions[prev.sessions.length - 1];
      return {
        ...prev,
        sessions: [
          ...prev.sessions,
          { name: "", startAt: nextDay(last?.startAt ?? ""), endAt: nextDay(last?.endAt ?? "") },
        ],
      };
    });

  const removeSession = (index: number) =>
    setValues((prev) => ({ ...prev, sessions: prev.sessions.filter((_, i) => i !== index) }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors([]);

    const res = await fetch(mode === "create" ? "/api/events" : `/api/events/${eventId}`, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    const body = await res.json().catch(() => null);
    setSubmitting(false);

    if (!res.ok) {
      setErrors(body?.errors ?? [body?.error ?? "保存に失敗した。"]);
      return;
    }

    router.push(`/events/${body.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5">
      {errors.length > 0 && (
        <div className="card border-red-500/40 bg-red-500/5">
          <ul className="grid gap-1 text-sm text-red-400">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <label className="label" htmlFor="title">
          イベント名
        </label>
        <input
          id="title"
          className="input-field"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="例: 第1回 全国ライバー対抗戦"
          maxLength={100}
        />
      </div>

      <div>
        <label className="label" htmlFor="description">
          説明(任意)
        </label>
        <textarea
          id="description"
          className="input-field min-h-24"
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder="ルールや賞品などを書く。公開ページに表示される。"
        />
      </div>

      <div>
        <span className="label">種目</span>
        <div className="grid gap-2">
          {EVENT_FORMATS.map((format) => (
            <label
              key={format}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                values.format === format ? "border-brand bg-brand/5" : "border-border bg-panel"
              }`}
            >
              <input
                type="radio"
                name="format"
                className="mt-1 accent-brand"
                checked={values.format === format}
                onChange={() => set("format", format)}
              />
              <span>
                <span className="block text-sm font-medium text-white">{FORMAT_LABELS[format]}</span>
                <span className="mt-0.5 block text-xs text-gray-400">{FORMAT_DESCRIPTIONS[format]}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="entryMode">
            参加形式
          </label>
          <select
            id="entryMode"
            className="input-field"
            value={values.entryMode}
            onChange={(e) => {
              const next = e.target.value as EntryMode;
              set("entryMode", next);
              // 個人戦にチーム形式は存在しない
              if (next === "SOLO") set("teamPreset", "GENERIC");
            }}
          >
            {ENTRY_MODES.map((m) => (
              <option key={m} value={m}>
                {ENTRY_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="teamPreset">
            チーム形式
          </label>
          <select
            id="teamPreset"
            className="input-field disabled:opacity-40"
            value={values.teamPreset}
            disabled={values.entryMode === "SOLO"}
            onChange={(e) => set("teamPreset", e.target.value as TeamPreset)}
          >
            {TEAM_PRESETS.map((p) => (
              <option key={p} value={p}>
                {TEAM_PRESET_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <span className="label">開催日程(JST)</span>
        <p className="mb-2 text-xs text-gray-500">
          日を分けて開催するときは日程を足す(例: 1日目に予選、2日目に決勝)。
          <strong className="text-gray-400">日程と日程の間のギフトは集計に入らない。</strong>
        </p>

        <div className="grid gap-3">
          {values.sessions.map((session, index) => (
            <div key={index} className="rounded-lg border border-border bg-panel p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-gray-400">{index + 1} 日程目</span>
                {values.sessions.length > 1 && (
                  <button
                    type="button"
                    className="text-xs text-red-400 hover:text-red-300"
                    onClick={() => removeSession(index)}
                  >
                    削除
                  </button>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
                <div>
                  <label className="label" htmlFor={`session-${index}-start`}>
                    開始
                  </label>
                  <input
                    id={`session-${index}-start`}
                    type="datetime-local"
                    className="input-field"
                    value={session.startAt}
                    onChange={(e) => setSession(index, { startAt: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label" htmlFor={`session-${index}-end`}>
                    終了
                  </label>
                  <input
                    id={`session-${index}-end`}
                    type="datetime-local"
                    className="input-field"
                    value={session.endAt}
                    onChange={(e) => setSession(index, { endAt: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label" htmlFor={`session-${index}-name`}>
                    名前(任意)
                  </label>
                  <input
                    id={`session-${index}-name`}
                    className="input-field"
                    value={session.name}
                    onChange={(e) => setSession(index, { name: e.target.value })}
                    placeholder="例: 予選"
                    maxLength={MAX_SESSION_NAME_LENGTH}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {values.sessions.length < MAX_EVENT_SESSIONS && (
          <button type="button" className="btn-ghost mt-3 text-sm" onClick={addSession}>
            + 日程を追加
          </button>
        )}
      </div>

      <div>
        <label className="label" htmlFor="visibility">
          公開範囲
        </label>
        <select
          id="visibility"
          className="input-field"
          value={values.visibility}
          onChange={(e) => set("visibility", e.target.value as Visibility)}
        >
          {VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {VISIBILITY_LABELS[v]}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs text-gray-500">
          結果とランキングの公開ページに適用される。作成・参加者管理・設定は常にログインが要る。
        </p>
      </div>

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "保存中..." : mode === "create" ? "イベントを作る" : "保存する"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => router.back()}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
