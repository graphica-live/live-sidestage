"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LISTENER_STATUS_CLASSES, LISTENER_STATUS_LABELS } from "@/event/labels";
import { MAX_DISPLAY_NAME_LENGTH } from "@/event/validation";

export type ParticipantRow = {
  id: string;
  tiktokId: string;
  displayName: string;
  status: string;
  teamId: string | null;
  teamName: string | null;
  /** この配信者が当サービスに会員登録しているか */
  registered: boolean;
  /** analytics の BIO 認証を通っているか */
  verified: boolean;
  /** analytics 側の TikTok 接続状態。まだ reconcile が来ていなければ null */
  listenerStatus: string | null;
};

type Notice = { kind: "info" | "warn" | "error"; text: string };

export function ParticipantManager({
  eventId,
  status,
  participants,
  teams,
}: {
  eventId: string;
  status: string;
  participants: ParticipantRow[];
  /** チーム戦のときだけ渡す。空配列なら所属の選択欄を出さない */
  teams: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [tiktokId, setTiktokId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  // 一覧の表示名をその場で編集する。編集中の行は1つだけ。
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // busy(state)は非同期に反映されるので、二重送信の抑止には同期的な ref を使う。
  const savingRef = useRef(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotices([]);

    try {
      const res = await fetch(`/api/events/${eventId}/participants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiktokId, displayName: displayName || null }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setNotices([{ kind: "error", text: body?.error ?? "登録に失敗した。" }]);
        return;
      }

      const next: Notice[] = [
        {
          kind: "info",
          text: body.createdRoom
            ? `@${body.tiktokId} を登録した。この配信者は当サービスに未登録なので、イベント用に配信の監視を始める(反映まで最大60秒)。`
            : `@${body.tiktokId} を登録した。すでに監視中の配信者なので、既存の受信データをそのまま使う。`,
        },
      ];
      if (body.existence === "UNVERIFIED") {
        next.push({
          kind: "warn",
          text: "TikTok からの応答が得られず、このアカウントが実在するか確認できなかった。ID が正しいか見直すこと。",
        });
      }
      if (body.leaseClamped) {
        next.push({
          kind: "warn",
          text: "イベント終了が遠いため、監視の確保期間を上限まで切り詰めた。期限が近づいたら登録し直すこと。",
        });
      }
      setNotices(next);
      setTiktokId("");
      setDisplayName("");
      router.refresh();
    } catch {
      setNotices([{ kind: "error", text: "登録に失敗した(通信エラー)。" }]);
    } finally {
      setBusy(false);
    }
  }

  async function changeTeam(p: ParticipantRow, teamId: string) {
    setBusy(true);
    setNotices([]);

    try {
      const res = await fetch(`/api/events/${eventId}/participants/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: teamId || null }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setNotices([{ kind: "error", text: body?.error ?? "所属の変更に失敗した。" }]);
        return;
      }
      router.refresh();
    } catch {
      setNotices([{ kind: "error", text: "所属の変更に失敗した(通信エラー)。" }]);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(p: ParticipantRow) {
    setNotices([]);
    setEditingId(p.id);
    setDraft(p.displayName);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft("");
  }

  /**
   * 表示名を保存する。決定の経路は Enter と「保存」ボタンの**この1本だけ**にしてある
   * (blur での自動保存を持たせると、取消ボタンを押しても先に保存され、保存ボタンでは
   * blur と click で2回 PATCH が飛ぶ)。
   */
  async function commitRename(p: ParticipantRow) {
    if (savingRef.current) return;

    const next = draft.trim();
    // 空欄は「TikTok ID へ戻す」指示。サーバー側と同じ規則で解決してから差分を見る。
    if ((next || p.tiktokId) === p.displayName) {
      cancelEdit();
      return;
    }

    savingRef.current = true;
    setBusy(true);
    setNotices([]);

    try {
      const res = await fetch(`/api/events/${eventId}/participants/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: next }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        // 入力し直せるように編集欄は開いたままにする。
        setNotices([{ kind: "error", text: body?.error ?? "表示名の変更に失敗した。" }]);
        return;
      }
      cancelEdit();
      router.refresh();
    } catch {
      setNotices([{ kind: "error", text: "表示名の変更に失敗した(通信エラー)。" }]);
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  async function remove(p: ParticipantRow) {
    if (!window.confirm(`@${p.tiktokId} を参加者から外す。集計対象からも外れる。`)) return;
    setBusy(true);
    setNotices([]);

    try {
      const res = await fetch(`/api/events/${eventId}/participants/${p.id}`, { method: "DELETE" });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setNotices([{ kind: "error", text: body?.error ?? "削除に失敗した。" }]);
        return;
      }
      router.refresh();
    } catch {
      setNotices([{ kind: "error", text: "削除に失敗した(通信エラー)。" }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {status === "RUNNING" && (
        <p className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 text-xs leading-relaxed text-yellow-200/80">
          開催中に参加者を追加・削除したり所属チームを変えると
          <strong className="font-semibold">イベント期間の全ギフトが計算し直される</strong>。
          途中で追加した参加者には登録前のギフトも算入され、外した参加者のぶんは順位から消える。
          表示名の変更だけは集計に影響しない(表示が切り替わるだけ)。
        </p>
      )}

      <form onSubmit={add} className="card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="tiktokId" className="label">
              TikTok ID
            </label>
            <input
              id="tiktokId"
              value={tiktokId}
              onChange={(e) => setTiktokId(e.target.value)}
              placeholder="@username"
              required
              className="input-field"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="displayName" className="label">
              表示名(任意)
            </label>
            <input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="未入力なら TikTok ID をそのまま使う"
              maxLength={MAX_DISPLAY_NAME_LENGTH}
              className="input-field"
            />
          </div>
          <button type="submit" disabled={busy} className="btn-primary shrink-0">
            参加者を追加
          </button>
        </div>

        {notices.map((n, i) => (
          <p
            key={i}
            className={`mt-3 text-xs ${
              n.kind === "error"
                ? "text-red-400"
                : n.kind === "warn"
                  ? "text-yellow-400"
                  : "text-gray-400"
            }`}
          >
            {n.text}
          </p>
        ))}
      </form>

      {participants.length === 0 ? (
        <div className="card text-sm text-gray-500">
          まだ参加者がいない。TikTok ID を追加すると、その配信者のギフトがイベントの集計対象になる。
        </div>
      ) : (
        <ul className="space-y-2">
          {participants.map((p) => (
            <li key={p.id} className="card flex flex-wrap items-center gap-x-3 gap-y-2">
              {/*
                狭い画面では名前ブロックだけで1行を占め、チーム選択・状態・外すを次の行へ送る。
                `flex-1` のままだと shrink-0 の3つが幅を食い切って名前が1文字まで潰れ、
                編集を開く当たり判定が無くなる(実機375pxで確認)。
              */}
              <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                {editingId === p.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void commitRename(p);
                    }}
                    className="flex items-center gap-2"
                  >
                    <input
                      // 編集を開いた直後に打ち始められるように。閉じるまでこの行に1つだけ。
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        // 日本語IMEの変換確定 Enter で保存しない(未確定の文字列が入る)。
                        if (e.nativeEvent.isComposing) {
                          if (e.key === "Enter") e.preventDefault();
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      maxLength={MAX_DISPLAY_NAME_LENGTH}
                      placeholder={`未入力なら @${p.tiktokId} に戻る`}
                      aria-label={`@${p.tiktokId} の表示名`}
                      disabled={busy}
                      className="input-field min-w-0 flex-1 py-1 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="btn-primary shrink-0 px-2 py-1 text-xs"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={busy}
                      className="shrink-0 text-xs text-gray-500 hover:text-white"
                    >
                      取消
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      disabled={busy}
                      title="クリックで表示名を編集"
                      aria-label={`@${p.tiktokId} の表示名を編集`}
                      className="min-w-0 truncate text-left font-medium hover:underline"
                    >
                      {p.displayName}
                    </button>
                    {p.verified ? (
                      <span
                        className="shrink-0 rounded-full bg-green-400/10 px-2 py-0.5 text-xs text-green-400"
                        title="当サービスに会員登録済みで、本人確認(BIO認証)を通っている"
                      >
                        本人確認済み
                      </span>
                    ) : p.registered ? (
                      <span
                        className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-xs text-gray-400"
                        title="当サービスに会員登録はあるが、本人確認は済んでいない"
                      >
                        会員登録あり
                      </span>
                    ) : (
                      <span
                        className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-xs text-gray-500"
                        title="当サービスに会員登録がない配信者。本人性は主催者の責任で確認すること"
                      >
                        未登録
                      </span>
                    )}
                  </div>
                )}
                <p className="truncate font-mono text-xs text-gray-500">@{p.tiktokId}</p>
              </div>

              {teams.length > 0 && (
                <select
                  value={p.teamId ?? ""}
                  onChange={(e) => changeTeam(p, e.target.value)}
                  disabled={busy}
                  aria-label={`${p.displayName} の所属チーム`}
                  className="input-field w-auto shrink-0 py-1 text-xs"
                >
                  <option value="">未所属</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}

              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                  p.listenerStatus
                    ? (LISTENER_STATUS_CLASSES[p.listenerStatus] ?? "text-gray-400 bg-white/5")
                    : "text-yellow-400 bg-yellow-400/10"
                }`}
              >
                {p.listenerStatus
                  ? (LISTENER_STATUS_LABELS[p.listenerStatus] ?? p.listenerStatus)
                  : "まもなく監視開始"}
              </span>

              <button
                onClick={() => remove(p)}
                disabled={busy}
                className="shrink-0 text-xs text-red-400 hover:underline"
              >
                外す
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs leading-relaxed text-gray-500">
        参加者を追加すると、その配信者の TikTok Live をイベント終了まで監視する。監視の開始・停止は
        最大60秒ごとの同期で反映される。参加者を外しても、それまでに受信したギフトのデータは消えない。
        一覧の表示名はクリックすると編集できる(TikTok ID は登録し直しになるので変更できない)。
      </p>
    </div>
  );
}
