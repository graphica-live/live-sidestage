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
  MAX_TITLE_LENGTH,
  TEAM_PRESETS,
  VISIBILITIES,
  type EntryMode,
  type EventFormat,
  type TeamPreset,
  type Visibility,
} from "@/event/validation";
import type { SessionFormValue } from "@/event/wizard";
import { SessionsField } from "./SessionsField";

export type { SessionFormValue };

/** 作成済みイベントの設定。**種目(format)は表示するだけで変更できない。** */
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
 * 作成済みイベントの設定フォーム。新規作成は EventWizard が受け持つ。
 *
 * 種目は作成時にしか決められないので選択肢を出さない。値自体は従来どおり送信し、
 * サーバー(`resolveEventFormatForUpdate`)が現在の値と一致することを確認する
 * — 送らない形にすると、デプロイ中に古い API へ当たったとき保存に失敗する。
 */
export function EventForm({
  eventId,
  initial,
}: {
  eventId: string;
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

    const res = await fetch(`/api/events/${eventId}`, {
      method: "PATCH",
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
        <span className="label">種目</span>
        {/* 選択肢は出さない。決まっている種目だけを見せる(変更は作成時のみ)。 */}
        <div className="rounded-lg border border-border bg-panel p-3">
          <p className="text-sm font-medium text-white">{FORMAT_LABELS[values.format]}</p>
          <p className="mt-0.5 text-xs text-gray-400">{FORMAT_DESCRIPTIONS[values.format]}</p>
          <p className="mt-2 text-xs text-gray-500">
            種目は作成後に変更できない。別の種目で開催するときは新しいイベントを作る。
          </p>
        </div>
      </div>

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
          maxLength={MAX_TITLE_LENGTH}
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
              setValues((prev) => ({
                ...prev,
                entryMode: next,
                // 個人戦にチーム形式は存在しない
                teamPreset: next === "SOLO" ? "GENERIC" : prev.teamPreset,
              }));
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
        <SessionsField sessions={values.sessions} onChange={(s) => set("sessions", s)} />
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
          {submitting ? "保存中..." : "保存する"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => router.back()}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
