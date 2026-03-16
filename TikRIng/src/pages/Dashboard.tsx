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
        <h1 className="text-xl sm:text-2xl font-black">フレーム管理</h1>
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
                className="w-full flex items-center gap-3 px-4 py-3 border-b border-tiktok-gray last:border-b-0"
              >
                <img
                  src={`/api/frames/${frame.id}`}
                  alt="thumb"
                  className="w-12 h-12 rounded-full object-cover border border-tiktok-gray bg-tiktok-black"
                  loading="lazy"
                />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate" title={name}>
                    {short}
                  </p>
                </div>

                <div className={`text-xs font-bold shrink-0 ${remainingClass}`}>{remainingText}</div>

                <button
                  type="button"
                  onClick={() => handleCopy(frame)}
                  disabled={!frame.shareUrl}
                  className="shrink-0 p-2 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
