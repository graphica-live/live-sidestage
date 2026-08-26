"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { avatarFrameStyle, resolveAvatarFrame } from "@/event/avatar-frame";
import { LISTENER_STATUS_CLASSES, LISTENER_STATUS_LABELS } from "@/event/labels";
import { MAX_DISPLAY_NAME_LENGTH, normalizeTiktokId } from "@/event/validation";
import { AvatarFrameEditor } from "./AvatarFrameEditor";

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
  avatarOffsetX: number | null;
  avatarOffsetY: number | null;
  avatarZoom: number | null;
};

type Notice = { kind: "info" | "warn" | "error"; text: string };

export function ParticipantManager({
  eventId,
  status,
  participants,
  teams,
  isTeamEvent,
}: {
  eventId: string;
  status: string;
  participants: ParticipantRow[];
  /** チーム戦のときだけ渡す。空配列なら所属の選択欄を出さない */
  teams: { id: string; name: string }[];
  /**
   * チーム戦かどうか。チーム戦の対戦カードは複数人の丸アイコンを重ねて表示するため
   * (BracketTree.tsx の EntrantAvatars、count>=2)、個人の切り出し位置・ズームを
   * 設定しても対戦カードの見た目には反映されない。混乱を避けるため、
   * チーム戦では位置合わせの導線自体を出さない。
   */
  isTeamEvent: boolean;
}) {
  const router = useRouter();
  const [tiktokId, setTiktokId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  // 一覧の表示名をその場で編集する。編集中の行は1つだけ。
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // アイコンの位置合わせモーダルを開いている参加者。1つだけ開ける。
  const [editingAvatarId, setEditingAvatarId] = useState<string | null>(null);
  // busy(state)は非同期に反映されるので、二重送信の抑止には同期的な ref を使う。
  const savingRef = useRef(false);

  // TikTok ID の訂正(登録ミスの後追い専用)。表示名編集とは独立させる
  // (同時に別の行を開いても互いの保存を妨げないように)。
  const [editingTiktokIdFor, setEditingTiktokIdFor] = useState<string | null>(null);
  const [tiktokDraft, setTiktokDraft] = useState("");
  const savingTiktokRef = useRef(false);

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

  function startEditTiktok(p: ParticipantRow) {
    setNotices([]);
    setEditingTiktokIdFor(p.id);
    setTiktokDraft(p.tiktokId);
  }

  function cancelEditTiktok() {
    setEditingTiktokIdFor(null);
    setTiktokDraft("");
  }

  /**
   * TikTok ID を訂正する。登録ミスの後追い救済専用。
   *
   * `EventParticipant.id` は変わらないので対戦カード・トーナメント表の枠は自動的に
   * そのまま残る。一方で監視先の room とイベント期間の全ギフト集計が新しい ID の実績へ
   * 切り替わる操作なので、`remove()` と同じく常に確認ダイアログを挟む
   * (表示名編集と違い集計対象は status に関わらず変わりうるため、開催中限定にしない)。
   */
  async function commitTiktokId(p: ParticipantRow) {
    if (savingTiktokRef.current) return;

    const normalized = normalizeTiktokId(tiktokDraft);
    if (!normalized) {
      setNotices([{ kind: "error", text: "TikTok ID の形式が正しくない。" }]);
      return;
    }
    if (normalized === p.tiktokId) {
      cancelEditTiktok();
      return;
    }

    if (
      !window.confirm(
        `@${p.tiktokId} を @${normalized} へ訂正する。イベント期間の全ギフトが新しいIDの実績で計算し直される(対戦カード・トーナメント表の枠はそのまま維持される)。よろしいか?`
      )
    ) {
      return;
    }

    savingTiktokRef.current = true;
    setBusy(true);
    setNotices([]);

    try {
      const res = await fetch(`/api/events/${eventId}/participants/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiktokId: tiktokDraft }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setNotices([{ kind: "error", text: body?.error ?? "TikTok ID の訂正に失敗した。" }]);
        return;
      }

      const next: Notice[] = [
        {
          kind: "info",
          text: `TikTok ID を @${body.tiktokId} へ訂正した。対戦カード・トーナメント表の枠はそのまま維持される。`,
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
          text: "イベント終了が遠いため、監視の確保期間を上限まで切り詰めた。期限が近づいたら訂正し直すこと。",
        });
      }
      setNotices(next);
      cancelEditTiktok();
      router.refresh();
    } catch {
      setNotices([{ kind: "error", text: "TikTok ID の訂正に失敗した(通信エラー)。" }]);
    } finally {
      savingTiktokRef.current = false;
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

  const editingAvatarParticipant = participants.find((p) => p.id === editingAvatarId) ?? null;

  return (
    <>
    <div className="space-y-6">
      {status === "RUNNING" && (
        <p className="rounded-lg border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 text-xs leading-relaxed text-yellow-200/80">
          開催中に参加者を追加・削除したり所属チームを変えたり TikTok ID を訂正すると
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
              placeholder="未入力なら TikTok のニックネームを使う(取得できなければ TikTok ID)"
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
              {!isTeamEvent && (
                <AvatarPreview participant={p} onClick={() => setEditingAvatarId(p.id)} />
              )}
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
                    {/*
                      名前だけだと編集できることが伝わらないので、ペンマークを常時出す
                      (hover でだけ出す方式はタッチ端末で気付けない)。当たり判定は
                      名前とペンを含むボタン全体。
                    */}
                    <button
                      type="button"
                      onClick={() => startEdit(p)}
                      disabled={busy}
                      title="クリックで表示名を編集"
                      aria-label={`@${p.tiktokId} の表示名を編集`}
                      className="group flex min-w-0 items-center gap-1.5 text-left font-medium"
                    >
                      <span className="truncate group-hover:underline">{p.displayName}</span>
                      <PencilIcon />
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
                {editingTiktokIdFor === p.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void commitTiktokId(p);
                    }}
                    className="mt-1 flex items-center gap-2"
                  >
                    <input
                      autoFocus
                      value={tiktokDraft}
                      onChange={(e) => setTiktokDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) {
                          if (e.key === "Enter") e.preventDefault();
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEditTiktok();
                        }
                      }}
                      placeholder="@username"
                      aria-label={`@${p.tiktokId} の TikTok ID を訂正`}
                      disabled={busy}
                      className="input-field min-w-0 flex-1 py-1 font-mono text-xs"
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
                      onClick={cancelEditTiktok}
                      disabled={busy}
                      className="shrink-0 text-xs text-gray-500 hover:text-white"
                    >
                      取消
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => startEditTiktok(p)}
                    disabled={busy}
                    title="クリックで TikTok ID を訂正(登録ミスの訂正専用)"
                    aria-label={`@${p.tiktokId} の TikTok ID を訂正`}
                    className="group flex min-w-0 items-center gap-1 text-left"
                  >
                    <span className="truncate font-mono text-xs text-gray-500 group-hover:underline">
                      @{p.tiktokId}
                    </span>
                    <PencilIcon />
                  </button>
                )}
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
        一覧の表示名はペンマークか名前をクリックすると編集できる。TikTok ID
        も同様にペンマークをクリックすると訂正できる(登録ミスの後追い救済専用)。訂正すると
        監視先が新しい ID に切り替わり、次回の集計から新しい ID の実績で計算し直される
        (対戦カード・トーナメント表の枠は維持される)。
      </p>
    </div>

    {editingAvatarParticipant && (
      <AvatarFrameEditor
        eventId={eventId}
        participantId={editingAvatarParticipant.id}
        displayName={editingAvatarParticipant.displayName}
        initialFrame={resolveAvatarFrame(
          editingAvatarParticipant.avatarOffsetX,
          editingAvatarParticipant.avatarOffsetY,
          editingAvatarParticipant.avatarZoom
        )}
        onClose={() => setEditingAvatarId(null)}
        onSaved={() => setEditingAvatarId(null)}
      />
    )}
    </>
  );
}

/**
 * 参加者一覧の各行、名前の左に出す対戦カード表示のミニプレビュー。
 * BracketTree.tsx の対戦カード(サイド枠)と同じアスペクト比・同じ切り出しスタイルを
 * 縮小再現する。クリックで位置合わせモーダルを開く。
 */
function AvatarPreview({
  participant,
  onClick,
}: {
  participant: ParticipantRow;
  onClick: () => void;
}) {
  const frame = resolveAvatarFrame(
    participant.avatarOffsetX,
    participant.avatarOffsetY,
    participant.avatarZoom
  );
  const style = avatarFrameStyle(frame);

  return (
    <button
      type="button"
      onClick={onClick}
      title="クリックで対戦カードのアイコン位置を編集"
      aria-label={`${participant.displayName} の対戦カード表示を編集`}
      className="relative h-10 w-[76px] shrink-0 overflow-hidden rounded-sm border border-white/10 bg-white/5"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/public/avatar/${participant.id}`}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={style}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 to-transparent"
        aria-hidden
      />
    </button>
  );
}

/** 表示名が編集できることを示す小さなペン。装飾なので読み上げからは外す。 */
function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0 text-gray-400 transition-colors group-hover:text-white"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
