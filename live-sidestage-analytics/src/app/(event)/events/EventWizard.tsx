"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BRACKET_METHODS, type BracketMethod } from "@/event/bracket";
import { PLACEMENT_DEPTH_MAX } from "@/event/bracket-rules";
import {
  BRACKET_METHOD_DESCRIPTIONS,
  BRACKET_METHOD_LABELS,
  BRACKET_METHOD_SUBTITLES,
  ENTRY_MODE_LABELS,
  FORMAT_DESCRIPTIONS,
  FORMAT_LABELS,
  PLACEMENT_DEPTH_LABELS,
  PLACEMENT_DEPTH_SUBTITLES,
  TEAM_PRESET_LABELS,
} from "@/event/labels";
import {
  ENTRY_MODES,
  EVENT_FORMATS,
  MAX_TITLE_LENGTH,
  TEAM_PRESETS,
  type TeamPreset,
} from "@/event/validation";
import { MAX_PRIZE_LENGTH, MAX_NOTICE_LENGTH } from "@/event/validation";
import {
  WIZARD_STEPS,
  WIZARD_STEP_HINTS,
  WIZARD_STEP_TITLES,
  validateWizardDraft,
  validateWizardStep,
  type EventDraft,
} from "@/event/wizard";
import { BracketMethodDiagram } from "./BracketMethodDiagram";
import { MatchRulesField } from "./MatchRulesField";
import { SessionsField } from "./SessionsField";

/** 0(行わない)から上限まで。ラベルは `PLACEMENT_DEPTH_LABELS`。 */
const PLACEMENT_DEPTH_CHOICES = Array.from({ length: PLACEMENT_DEPTH_MAX + 1 }, (_, i) => i);

/**
 * イベント作成ウィザード。**1画面につき1つだけ決めさせる。**
 *
 * 設定画面(EventForm)と違って全項目を同時に出さないのは、種目のように後から変えられない
 * 選択が他の項目に埋もれるのを避けるため。作成前なので「戻る」で決め直せる。
 */
export function EventWizard({ initial }: { initial: EventDraft }) {
  const router = useRouter();
  const [values, setValues] = useState<EventDraft>(initial);
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const step = WIZARD_STEPS[stepIndex];
  const isLast = stepIndex === WIZARD_STEPS.length - 1;

  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors([]);
  };

  const goTo = (index: number) => {
    setErrors([]);
    setStepIndex(index);
  };

  const next = () => {
    const stepErrors = validateWizardStep(step, values);
    if (stepErrors.length > 0) {
      setErrors(stepErrors);
      return;
    }
    goTo(stepIndex + 1);
  };

  async function submit() {
    // 手順を飛ばした値を送らない。サーバー側でも validateEventInput が検証する。
    const allErrors = validateWizardDraft(values);
    if (allErrors.length > 0) {
      setErrors(allErrors);
      return;
    }

    setSubmitting(true);
    setErrors([]);

    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });

    const body = await res.json().catch(() => null);
    setSubmitting(false);

    if (!res.ok) {
      setErrors(body?.errors ?? [body?.error ?? "作成に失敗した。"]);
      return;
    }

    // 作成しただけでは参加者もトーナメント表もない。続けて参加者登録へ進ませる。
    router.push(`/events/${body.id}/participants`);
    router.refresh();
  }

  return (
    <div className="grid gap-5">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {WIZARD_STEPS.map((s, index) => {
          const done = index < stepIndex;
          const current = index === stepIndex;
          return (
            <li key={s} className="flex items-center gap-2">
              {index > 0 && <span className="text-muted">›</span>}
              <button
                type="button"
                // 先の手順へは飛ばせない(前の手順が未確定のまま進むのを防ぐ)。
                disabled={!done}
                onClick={() => goTo(index)}
                className={
                  current
                    ? "font-medium text-strong"
                    : done
                      ? "text-muted hover:text-strong"
                      : "cursor-default text-muted"
                }
              >
                {index + 1}. {WIZARD_STEP_TITLES[s]}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="card grid gap-4">
        <div>
          <h2 className="text-base font-semibold text-strong">{WIZARD_STEP_TITLES[step]}</h2>
          <p className="mt-1 text-xs text-muted">{WIZARD_STEP_HINTS[step]}</p>
        </div>

        {errors.length > 0 && (
          <ul className="grid gap-1 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-600 dark:text-red-400">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}

        {step === "format" && (
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
                  <span className="block text-sm font-medium text-strong">
                    {FORMAT_LABELS[format]}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {FORMAT_DESCRIPTIONS[format]}
                  </span>
                </span>
              </label>
            ))}
            <p className="text-xs text-amber-400">
              種目は作成すると変更できない。参加者や対戦の入ったイベントで種目だけ差し替えると、
              集計済みの結果と噛み合わなくなるため。
            </p>

            {values.format === "TOURNAMENT" && (
              <div className="mt-2 grid gap-3 border-t border-border pt-4">
                <div>
                  <h3 className="text-sm font-semibold text-strong">
                    トーナメント表の不戦勝(BYE)方式
                  </h3>
                  <p className="mt-1 text-xs text-muted">
                    参加人数が2のべき乗でない場合、不戦勝が出る。その配り方を選ぶ。
                    総試合数はどちらの方式でも同じで、不戦勝の配り方だけが違う。
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {BRACKET_METHODS.map((method) => (
                    <label
                      key={method}
                      className={`flex cursor-pointer flex-col gap-3 rounded-lg border p-4 transition-colors ${
                        values.bracketMethod === method
                          ? "border-brand bg-brand/5"
                          : "border-border bg-panel"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="bracketMethod"
                          className="mt-1 accent-brand"
                          checked={values.bracketMethod === method}
                          onChange={() => set("bracketMethod", method as BracketMethod)}
                        />
                        <span>
                          <span className="block text-sm font-medium text-strong">
                            {BRACKET_METHOD_LABELS[method]}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted">
                            {BRACKET_METHOD_SUBTITLES[method]}
                          </span>
                        </span>
                      </div>
                      <p className="text-xs leading-relaxed text-muted">
                        {BRACKET_METHOD_DESCRIPTIONS[method]}
                      </p>
                      <div className="flex justify-center rounded-lg bg-black/5 dark:bg-white/5 p-3">
                        <BracketMethodDiagram method={method} />
                      </div>
                      <p className="text-center text-[10px] text-muted">
                        例: 5人参加の場合(奇数の最小構成)
                      </p>
                    </label>
                  ))}
                </div>

                <div className="mt-2 grid gap-3 border-t border-border pt-4">
                  <div>
                    <h3 className="text-sm font-semibold text-strong">順位決定戦</h3>
                    <p className="mt-1 text-xs text-muted">
                      3位以下も試合で決めるか。1つ増やすごとに参加者の実際のライブバトルが増える。
                    </p>
                  </div>

                  <div className="grid gap-2">
                    {PLACEMENT_DEPTH_CHOICES.map((depth) => (
                      <label
                        key={depth}
                        className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                          values.placementDepth === depth
                            ? "border-brand bg-brand/5"
                            : "border-border bg-panel"
                        }`}
                      >
                        <input
                          type="radio"
                          name="placementDepth"
                          className="mt-1 accent-brand"
                          checked={values.placementDepth === depth}
                          onChange={() => set("placementDepth", depth)}
                        />
                        <span>
                          <span className="block text-sm font-medium text-strong">
                            {PLACEMENT_DEPTH_LABELS[depth]}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted">
                            {PLACEMENT_DEPTH_SUBTITLES[depth]}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <p className="text-xs text-amber-400">
                    ここで決めるのは希望。
                    <strong>実際に何位まで決まるかは参加人数と不戦勝の出方で変わる</strong>
                    ので、確定するのは参加者を登録した後の「トーナメント表を作る」画面。
                    そこで選び直せる。
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {step === "title" && (
          <div className="grid gap-4">
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
                autoFocus
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
          </div>
        )}

        {step === "entry" && (
          <div className="grid gap-4">
            <div className="grid gap-2">
              {ENTRY_MODES.map((mode) => (
                <label
                  key={mode}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                    values.entryMode === mode ? "border-brand bg-brand/5" : "border-border bg-panel"
                  }`}
                >
                  <input
                    type="radio"
                    name="entryMode"
                    className="mt-1 accent-brand"
                    checked={values.entryMode === mode}
                    onChange={() => {
                      setValues((prev) => ({
                        ...prev,
                        entryMode: mode,
                        // 個人戦にチーム形式は存在しない
                        teamPreset: mode === "SOLO" ? "GENERIC" : prev.teamPreset,
                      }));
                      setErrors([]);
                    }}
                  />
                  <span>
                    <span className="block text-sm font-medium text-strong">
                      {ENTRY_MODE_LABELS[mode]}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {mode === "SOLO"
                        ? "参加者ひとりずつで順位を出す"
                        : "参加者をチームにまとめ、チーム合計で順位を出す"}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {values.entryMode === "TEAM" && (
              <div>
                <label className="label" htmlFor="teamPreset">
                  チーム形式
                </label>
                <select
                  id="teamPreset"
                  className="input-field"
                  value={values.teamPreset}
                  onChange={(e) => set("teamPreset", e.target.value as TeamPreset)}
                >
                  {TEAM_PRESETS.map((p) => (
                    <option key={p} value={p}>
                      {TEAM_PRESET_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {step === "sessions" && (
          <SessionsField sessions={values.sessions} onChange={(s) => set("sessions", s)} />
        )}

        {step === "matchRules" && (
          <MatchRulesField value={values.matchRules} onChange={(v) => set("matchRules", v)} />
        )}

        {step === "prize" && (
          <div>
            <label className="label" htmlFor="prizeText">
              優勝賞品(任意)
            </label>
            <textarea
              id="prizeText"
              className="input-field min-h-24"
              value={values.prizeText}
              onChange={(e) => set("prizeText", e.target.value)}
              placeholder="例: トップライバーXX氏とコラボ/〇〇出演権"
              maxLength={MAX_PRIZE_LENGTH}
            />
          </div>
        )}

        {step === "notice" && (
          <div>
            <label className="label" htmlFor="noticeText">
              注意事項とFAQ
            </label>
            <textarea
              id="noticeText"
              className="input-field min-h-96 font-mono text-xs leading-relaxed"
              value={values.noticeText}
              onChange={(e) => set("noticeText", e.target.value)}
              maxLength={MAX_NOTICE_LENGTH}
            />
            <p className="mt-1 text-xs text-muted">
              テンプレートを自由に編集・削除できる。全部消して空にしてもよい。
            </p>
          </div>
        )}

        {step === "publish" && (
          <div className="grid gap-4">
            <dl className="grid gap-2 rounded-lg border border-border bg-panel p-3 text-sm">
              <Row label="種目">
                {values.format ? FORMAT_LABELS[values.format] : "未選択"}
                <span className="ml-2 text-xs text-amber-400">作成後は変更できない</span>
              </Row>
              {values.format === "TOURNAMENT" && (
                <>
                  <Row label="不戦勝方式">{BRACKET_METHOD_LABELS[values.bracketMethod]}</Row>
                  <Row label="順位決定戦">
                    {PLACEMENT_DEPTH_LABELS[values.placementDepth]}
                    {values.placementDepth > 0 && (
                      <span className="ml-2 text-xs text-amber-400">
                        参加人数によって変わる（表を作る画面で確定）
                      </span>
                    )}
                  </Row>
                </>
              )}
              <Row label="イベント名">{values.title.trim() || "未入力"}</Row>
              <Row label="参加形式">
                {ENTRY_MODE_LABELS[values.entryMode]}
                {values.entryMode === "TEAM" && ` / ${TEAM_PRESET_LABELS[values.teamPreset]}`}
              </Row>
              <Row label="開催日程">
                <ul className="grid gap-0.5">
                  {values.sessions.map((s, index) => (
                    <li key={index} className="font-mono text-xs text-strong">
                      {formatDraftRange(s.startAt, s.endAt)}
                      {s.name && <span className="ml-2 font-sans text-muted">{s.name}</span>}
                    </li>
                  ))}
                </ul>
              </Row>
            </dl>

            <p className="text-xs text-muted">
              作成すると同時に公開ページが有効になる。続けて参加者登録
              {values.format === "TOURNAMENT" && "→トーナメント表作成"}
              に進む。ここで決めた内容も含め、いつでもあとから編集できる。
            </p>
            <p className="text-xs text-muted">
              ルール・優勝賞品・注意事項は前の手順で決めた内容のまま作成される。
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {stepIndex > 0 ? (
          <button type="button" className="btn-ghost" onClick={() => goTo(stepIndex - 1)}>
            戻る
          </button>
        ) : (
          <button type="button" className="btn-ghost" onClick={() => router.push("/events")}>
            キャンセル
          </button>
        )}

        {isLast ? (
          <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? "作成中..." : "イベントを作る"}
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={next}>
            次へ
          </button>
        )}

        <span className="self-center text-xs text-muted">
          ステップ {stepIndex + 1} / {WIZARD_STEPS.length}
        </span>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      <dt className="w-20 shrink-0 text-xs text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm text-strong">{children}</dd>
    </div>
  );
}

/**
 * 確認画面用の日時表示。`Date` を経由せず文字列を整形するだけにする
 * (ブラウザのタイムゾーンで解釈させない)。値は JST の "YYYY-MM-DDTHH:mm"。
 */
function formatDraftRange(startAt: string, endAt: string): string {
  const start = startAt.replace("T", " ").replace(/-/g, "/");
  const end = endAt.replace("T", " ").replace(/-/g, "/");
  const [startDay, startTime] = start.split(" ");
  const [endDay, endTime] = end.split(" ");
  if (!startTime || !endTime) return `${start} 〜 ${end}`;
  return startDay === endDay ? `${start} 〜 ${endTime}` : `${start} 〜 ${end}`;
}
