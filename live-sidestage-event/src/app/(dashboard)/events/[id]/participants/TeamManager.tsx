"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PREFECTURES } from "@/lib/prefecture";
import { MAX_TEAMS } from "@/lib/validation";

export type TeamRow = {
  id: string;
  name: string;
  colorHex: string | null;
  prefectureCode: string | null;
  memberCount: number;
};

// 使い回しやすい既定色。チーム順位のドット表示に使う。
const PALETTE = ["#fe2c55", "#4a9eff", "#4ade80", "#fbbf24", "#a78bfa", "#f472b6"];

export function TeamManager({
  eventId,
  teamPreset,
  teams,
}: {
  eventId: string;
  teamPreset: string;
  teams: TeamRow[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [prefectureCode, setPrefectureCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPrefecture = teamPreset === "PREFECTURE";
  const usedCodes = new Set(teams.map((t) => t.prefectureCode).filter(Boolean));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch(`/api/events/${eventId}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: isPrefecture ? "" : name,
        prefectureCode: isPrefecture ? prefectureCode : null,
        colorHex: PALETTE[teams.length % PALETTE.length],
      }),
    });
    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.errors?.[0] ?? body?.error ?? "チームの追加に失敗した。");
      return;
    }
    setName("");
    setPrefectureCode("");
    router.refresh();
  }

  async function remove(team: TeamRow) {
    const suffix =
      team.memberCount > 0
        ? `所属している${team.memberCount}人は未所属に戻る(参加者自体は残る)。`
        : "";
    if (!window.confirm(`「${team.name}」を削除する。${suffix}`)) return;

    setBusy(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/teams/${team.id}`, { method: "DELETE" });
    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "削除に失敗した。");
      return;
    }
    router.refresh();
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-gray-300">
        チーム
        <span className="ml-2 text-xs font-normal text-gray-500">
          {teams.length} / {MAX_TEAMS}
        </span>
      </h2>

      <form onSubmit={add} className="card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            {isPrefecture ? (
              <>
                <label htmlFor="prefectureCode" className="label">
                  都道府県
                </label>
                <select
                  id="prefectureCode"
                  value={prefectureCode}
                  onChange={(e) => setPrefectureCode(e.target.value)}
                  required
                  className="input-field"
                >
                  <option value="">選択する</option>
                  {PREFECTURES.filter((p) => !usedCodes.has(p.code)).map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <label htmlFor="teamName" className="label">
                  チーム名
                </label>
                <input
                  id="teamName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="赤組"
                  required
                  className="input-field"
                />
              </>
            )}
          </div>
          <button type="submit" disabled={busy} className="btn-primary shrink-0">
            チームを追加
          </button>
        </div>
        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </form>

      {teams.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {teams.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-2 rounded-full border border-border bg-panel px-3 py-1.5"
            >
              {t.colorHex && (
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: t.colorHex }}
                  aria-hidden
                />
              )}
              <span className="text-sm">{t.name}</span>
              <span className="text-xs text-gray-500">{t.memberCount}人</span>
              <button
                onClick={() => remove(t)}
                disabled={busy}
                className="text-xs text-gray-600 hover:text-red-400"
                aria-label={`${t.name} を削除`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
