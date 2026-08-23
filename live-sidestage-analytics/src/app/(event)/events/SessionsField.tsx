"use client";

import { MAX_EVENT_SESSIONS, MAX_SESSION_NAME_LENGTH } from "@/event/validation";
import { nextDay, type SessionFormValue } from "@/event/wizard";

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

  const addSession = () => {
    // 直前の日程の翌日・同じ時間帯を初期値にする(「1日目 22時 / 2日目 22時」が多い)。
    const last = sessions[sessions.length - 1];
    onChange([
      ...sessions,
      { name: "", startAt: nextDay(last?.startAt ?? ""), endAt: nextDay(last?.endAt ?? "") },
    ]);
  };

  const removeSession = (index: number) => onChange(sessions.filter((_, i) => i !== index));

  return (
    <div>
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

      {sessions.length < MAX_EVENT_SESSIONS && (
        <button type="button" className="btn-ghost mt-3 text-sm" onClick={addSession}>
          + 日程を追加
        </button>
      )}
    </div>
  );
}
