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
  TEAM_PRESETS,
  VISIBILITIES,
  type EntryMode,
  type EventFormat,
  type TeamPreset,
  type Visibility,
} from "@/event/validation";

export type EventFormValues = {
  title: string;
  description: string;
  format: EventFormat;
  entryMode: EntryMode;
  teamPreset: TeamPreset;
  visibility: Visibility;
  startAt: string; // JST の "YYYY-MM-DDTHH:mm"
  endAt: string;
};

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

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="startAt">
            開始日時(JST)
          </label>
          <input
            id="startAt"
            type="datetime-local"
            className="input-field"
            value={values.startAt}
            onChange={(e) => set("startAt", e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="endAt">
            終了日時(JST)
          </label>
          <input
            id="endAt"
            type="datetime-local"
            className="input-field"
            value={values.endAt}
            onChange={(e) => set("endAt", e.target.value)}
          />
        </div>
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
