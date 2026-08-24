"use client";

import { MAX_EVENT_SESSIONS, MAX_SESSION_NAME_LENGTH } from "@/event/validation";
import { alignEndAt, nextDay, type SessionFormValue } from "@/event/wizard";

/**
 * 開催日程の入力欄。作成ウィザードと設定フォームで同じものを使う。
 *
 * 日程は複数持てて、**日程と日程の隙間は集計されない**。日時は JST の
 * "YYYY-MM-DDTHH:mm" のまま扱い、`Date` へは変換しない(ブラウザのタイムゾーンで
 * 解釈させないため。パースはサーバーと `wizard.ts` の検証が `parseJstLocal()` で行う)。
 */
export function SessionsField({
  sessions,
  onChange,
}: {
  sessions: SessionFormValue[];
  onChange: (sessions: SessionFormValue[]) => void;
}) {
  const setSession = (index: number, patch: Partial<SessionFormValue>) =>
    onChange(sessions.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  /**
   * 開始を変えたら、置いていかれた終了も引き直す。
   *
   * 「22:00 〜 翌 00:00」の日程で開始の日付だけを翌日にすると、終了が開始と同じ日の
   * 00:00 に残って「終了日時を開始日時より後にしてください」で弾かれる。終了が
   * すでに開始より後なら `alignEndAt` は何もしないので、手で入れた終了は壊さない。
   */
  const setStartAt = (index: number, startAt: string) =>
    setSession(index, { startAt, endAt: alignEndAt(startAt, sessions[index].endAt) });

  const addSession = () => {
    // 直前の日程の翌日・同じ時間帯を初期値にする(「1日目 22時 / 2日目 22時」が多い)。
    const last = sessions[sessions.length - 1];
    const startAt = nextDay(last?.startAt ?? "");
    onChange([
      ...sessions,
      // 新規行は id を持たない(サーバー側で新しい日程として作られる)。
      { name: "", startAt, endAt: alignEndAt(startAt, nextDay(last?.endAt ?? "")) },
    ]);
  };

  const removeSession = (index: number) => onChange(sessions.filter((_, i) => i !== index));

  return (
    <div>
      {/* 日程の終了時刻はバトルの検知条件そのもの。ここを短く切ると、延長したバトルが
          丸ごと集計から落ちる。表示位置・強調はこの警告のためだけに他より強くしてある。 */}
      <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
        <p className="text-sm font-bold text-amber-300">
          ⚠️ 日程の中で<span className="underline">終了した</span>バトルだけが対戦として扱われる
        </p>
        <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
          日程の終了時刻をまたいで終わったバトルは、対戦カードに割り当てられない
          （勝敗の自動判定とバトル倍率の対象から外れる。日程内のギフト自体は順位に入る）。
          進行の遅れやバトルの延長を見込んで、<strong>終了時刻は余裕をもって（最後のバトル予定より
          30分〜1時間ほど後ろに）</strong>設定する。
        </p>
      </div>

      <p className="mb-2 text-xs text-gray-500">
        日を分けて開催するときは日程を足す(例: 1日目に予選、2日目に決勝)。
        <strong className="text-gray-400">日程と日程の間のギフトは集計に入らない。</strong>
      </p>

      <div className="grid gap-3">
        {sessions.map((session, index) => (
          <div key={index} className="rounded-lg border border-border bg-panel p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-gray-400">{index + 1} 日程目</span>
              {sessions.length > 1 && (
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
                  onChange={(e) => setStartAt(index, e.target.value)}
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

      {sessions.length < MAX_EVENT_SESSIONS && (
        <button type="button" className="btn-ghost mt-3 text-sm" onClick={addSession}>
          + 日程を追加
        </button>
      )}
    </div>
  );
}
