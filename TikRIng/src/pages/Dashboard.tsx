import { useEffect, useMemo, useState } from 'react';
import { Check, Link as LinkIcon, Loader2, Trash2 } from 'lucide-react';

type User = { id: string; display_name: string; plan: string };

type FrameItem = {
  id: string;
  displayName: string;
  expiresAt: number | null;
  remainingDays: number | null;
  shareUrl: string | null;
};

interface DashboardProps {
  user: User;
}

function truncateName(name: string) {
  return name.length > 20 ? `${name.slice(0, 20)}…` : name;
}

export default function Dashboard({ user }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [frames, setFrames] = useState<FrameItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FrameItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const canShow = useMemo(() => !!user, [user]);

  const fetchFrames = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/frames');
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch frames');
      const data = (await res.json()) as { frames: FrameItem[] };
      setFrames(data.frames ?? []);
    } catch (e) {
      setError('フレーム一覧の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canShow) return;
    fetchFrames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canShow]);

  const handleCopy = async (frame: FrameItem) => {
    if (!frame.shareUrl) return;
    try {
      await navigator.clipboard.writeText(frame.shareUrl);
      setCopiedId(frame.id);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === frame.id ? null : cur));
      }, 2000);
    } catch {
      // ignore
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/frames?id=${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      if (!res.ok) throw new Error('Delete failed');
      setDeleteTarget(null);
      await fetchFrames();
    } catch {
      setError('削除に失敗しました。');
    } finally {
      setDeleting(false);
    }
  };

  const startEditName = (frame: FrameItem) => {
    setError(null);
    setEditingId(frame.id);
    setEditName(frame.displayName ?? '');
  };

  const cancelEditName = () => {
    setEditingId(null);
    setEditName('');
  };

  const saveEditName = async (frameId: string) => {
    if (savingName) return;
    setSavingName(true);
    setError(null);
    try {
      const res = await fetch('/api/frames', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: frameId, customName: editName }),
      });

      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      if (res.status === 403) {
        setError('フレーム名の変更はPro限定です。');
        return;
      }
      if (!res.ok) throw new Error('Rename failed');

      setEditingId(null);
      setEditName('');
      await fetchFrames();
    } catch {
      setError('フレーム名の変更に失敗しました。');
    } finally {
      setSavingName(false);
    }
  };

  const handleEditNameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, frameId: string) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveEditName(frameId);
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditName();
    }
  };

  const handleCancelSubscription = async () => {
    if (canceling) return;
    setCanceling(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout/cancel', { method: 'POST' });
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      if (!res.ok) throw new Error('Cancel failed');
      setCancelConfirm(false);
      // ページリロードして plan 状態を反映
      window.location.reload();
    } catch {
      setError('サブスクリプションの解約に失敗しました。');
    } finally {
      setCanceling(false);
    }
  };

  const openBillingPortal = async () => {
    if (portalLoading) return;
    setPortalLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout/portal', { method: 'POST' });
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      if (!res.ok) throw new Error('Portal failed');
      const data = (await res.json()) as { url?: string };
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error('Missing url');
      }
    } catch {
      setError('解約/請求管理画面を開けませんでした。');
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 w-full">
        <Loader2 className="w-12 h-12 animate-spin text-tiktok-cyan mb-4" />
        <p className="text-tiktok-lightgray">フレームを読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col max-w-xl animate-in fade-in duration-500">
      <div className="w-full flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-black">フレーム管理</h1>
          {user.plan === 'pro' ? (
            <button
              type="button"
              onClick={openBillingPortal}
              disabled={portalLoading}
              className="py-2 px-3 rounded-md border border-tiktok-gray bg-tiktok-dark hover:bg-tiktok-gray/30 text-tiktok-lightgray font-bold transition-colors text-xs disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {portalLoading ? '開いています...' : '解約・請求管理'}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            window.location.href = '/';
          }}
          className="py-2.5 px-4 rounded-md bg-tiktok-red hover:bg-[#D92648] text-white font-bold transition-colors shadow-lg text-sm"
        >
          ＋ 新しいフレームを登録
        </button>
      </div>

      {error ? (
        <div className="mb-4 w-full p-4 rounded-xl bg-tiktok-red/20 border border-tiktok-red/30 text-tiktok-red text-sm text-center">
          {error}
        </div>
      ) : null}

      {frames.length === 0 ? (
        <div className="w-full rounded-md bg-tiktok-dark border border-tiktok-gray p-6 text-center">
          <p className="text-white font-bold mb-2">登録済みのフレームはありません</p>
          <button
            type="button"
            onClick={() => {
              window.location.href = '/';
            }}
            className="text-sm text-tiktok-lightgray hover:text-white underline transition-colors"
          >
            トップへ戻る
          </button>
        </div>
      ) : (
        <div className="w-full rounded-md bg-tiktok-dark border border-tiktok-gray overflow-hidden">
          {frames.map((frame) => {
            const name = frame.displayName ?? '';
            const short = truncateName(name);

            let remainingText = '';
            let remainingClass = 'text-tiktok-lightgray';
            if (frame.remainingDays === null) {
              remainingText = '無期限';
              remainingClass = 'text-tiktok-cyan';
            } else if (frame.remainingDays === 0) {
              remainingText = '期限切れ';
              remainingClass = 'text-tiktok-red';
            } else {
              remainingText = `残り${frame.remainingDays}日`;
              remainingClass = 'text-tiktok-lightgray';
            }

            return (
              <div
                key={frame.id}
                className={`w-full px-4 py-3 border-b border-tiktok-gray last:border-b-0 ${editingId === frame.id ? 'flex flex-wrap items-start gap-3' : 'flex items-center gap-3'}`}
              >
                <img
                  src={`/api/frames/${frame.id}`}
                  alt="thumb"
                  className="w-12 h-12 rounded-full object-cover border border-tiktok-gray bg-tiktok-black"
                  loading="lazy"
                />

                <div className={`min-w-0 ${editingId === frame.id ? 'w-full sm:flex-1' : 'flex-1'}`}>
                  {editingId === frame.id ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(event) => handleEditNameKeyDown(event, frame.id)}
                        className="w-full min-w-0 px-3 py-2 rounded-md bg-tiktok-black border border-tiktok-gray focus:outline-none focus:border-tiktok-cyan text-sm"
                        aria-label="frame name"
                        maxLength={80}
                        disabled={savingName}
                        autoFocus
                      />
                      <div className="flex gap-2 sm:shrink-0">
                        <button
                          type="button"
                          onClick={() => saveEditName(frame.id)}
                          disabled={savingName}
                          className="flex-1 sm:flex-none px-3 py-2 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 text-white font-bold transition-colors text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditName}
                          disabled={savingName}
                          className="flex-1 sm:flex-none px-3 py-2 rounded-md border border-tiktok-gray text-tiktok-lightgray hover:text-white hover:bg-tiktok-gray/30 font-bold transition-colors text-xs disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          キャンセル
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      <p
                        className="text-sm font-bold text-white break-all max-w-[18rem] sm:max-w-[28rem]"
                        style={{ wordBreak: 'break-all', whiteSpace: 'pre-line' }}
                        title={name}
                      >
                        {name}
                      </p>
                      {user.plan === 'pro' ? (
                        <button
                          type="button"
                          onClick={() => startEditName(frame)}
                          className="shrink-0 text-[11px] px-2 py-1 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 text-white font-bold transition-colors"
                        >
                          名前変更
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className={`text-xs font-bold shrink-0 ${editingId === frame.id ? 'ml-[3.75rem] sm:ml-0' : ''} ${remainingClass}`}>{remainingText}</div>

                <button
                  type="button"
                  onClick={() => handleCopy(frame)}
                  disabled={!frame.shareUrl}
                  className={`shrink-0 p-2 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${editingId === frame.id ? 'ml-auto' : ''}`}
                  aria-label="copy url"
                >
                  {copiedId === frame.id ? (
                    <Check className="w-4 h-4 text-tiktok-cyan" />
                  ) : (
                    <LinkIcon className="w-4 h-4 text-white" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setDeleteTarget(frame)}
                  className="shrink-0 p-2 rounded-md bg-tiktok-gray hover:bg-tiktok-red/20 transition-colors"
                  aria-label="delete"
                >
                  <Trash2 className="w-4 h-4 text-tiktok-red" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {user.plan === 'pro' ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setCancelConfirm(true)}
            className="text-xs text-tiktok-lightgray/50 hover:text-tiktok-red/70 underline transition-colors"
          >
            サブスクリプションを解約する
          </button>
        </div>
      ) : null}

      {cancelConfirm ? (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-tiktok-dark p-5 shadow-2xl text-center">
            <p className="text-white font-bold mb-1">サブスクリプションを解約しますか？</p>
            <p className="text-xs text-tiktok-lightgray mb-4">即時解約されます。無期限フレームの有効期限は本日から90日後に変更されます。</p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={handleCancelSubscription}
                disabled={canceling}
                className="flex-1 py-3 rounded-md bg-tiktok-red hover:bg-[#D92648] text-white font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {canceling ? '解約中...' : '解約する'}
              </button>
              <button
                type="button"
                onClick={() => setCancelConfirm(false)}
                disabled={canceling}
                className="flex-1 py-3 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 text-white font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-tiktok-dark p-5 shadow-2xl text-center">
            <p className="text-sm text-white font-bold mb-2">削除するとURLが無効になり、リスナーがアクセスできなくなります</p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-3 rounded-md bg-tiktok-red hover:bg-[#D92648] text-white font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                削除する
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 py-3 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 text-white font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
