import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Link as LinkIcon, Loader2, Shield, Trash2 } from 'lucide-react';

type User = { id: string; display_name: string; plan: string; isAdmin: boolean };

type FrameItem = {
  id: string;
  kind: 'frame' | 'orphan';
  storageKey: string;
  displayName: string;
  createdAt: number | null;
  expiresAt: number | null;
  remainingDays: number | null;
  shareUrl: string | null;
  passwordProtected: boolean;
  passwordValue: string | null;
  ownerId: string | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  viewCount?: number;
};

type FramesMeta = {
  totalCount: number;
  registeredCount: number;
  orphanCount: number;
};

type SortOption = 'created_desc' | 'created_asc' | 'owner_asc' | 'owner_desc' | 'name_asc' | 'name_desc' | 'expires_asc' | 'expires_desc' | 'views_desc';

const ADMIN_ITEMS_PER_PAGE = 50;

function getInitialDashboardPage() {
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get('page') || '1');

  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }

  return Math.floor(page);
}

interface DashboardProps {
  user: User;
  initialScope: 'mine' | 'all';
}

export default function Dashboard({ user, initialScope }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [frames, setFrames] = useState<FrameItem[]>([]);
  const [meta, setMeta] = useState<FramesMeta>({ totalCount: 0, registeredCount: 0, orphanCount: 0 });
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FrameItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<FrameItem | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [scope, setScope] = useState<'mine' | 'all'>(initialScope);
  const [sortBy, setSortBy] = useState<SortOption>('created_desc');
  const [currentPage, setCurrentPage] = useState(() => getInitialDashboardPage());

  const canShow = useMemo(() => !!user, [user]);
  const isAdminScope = user.isAdmin && scope === 'all';

  const sortedFrames = useMemo(() => {
    const items = [...frames];
    const valueForOwner = (frame: FrameItem) => (frame.ownerDisplayName?.trim() || frame.ownerEmail || '').toLowerCase();
    const valueForName = (frame: FrameItem) => frame.displayName.toLowerCase();
    const valueForCreated = (frame: FrameItem) => frame.createdAt ?? 0;
    const valueForExpires = (frame: FrameItem) => frame.expiresAt ?? Number.MAX_SAFE_INTEGER;
    const valueForViews = (frame: FrameItem) => frame.viewCount ?? 0;

    items.sort((left, right) => {
      switch (sortBy) {
        case 'created_asc':
          return valueForCreated(left) - valueForCreated(right);
        case 'owner_asc':
          return valueForOwner(left).localeCompare(valueForOwner(right), 'ja');
        case 'owner_desc':
          return valueForOwner(right).localeCompare(valueForOwner(left), 'ja');
        case 'name_asc':
          return valueForName(left).localeCompare(valueForName(right), 'ja');
        case 'name_desc':
          return valueForName(right).localeCompare(valueForName(left), 'ja');
        case 'expires_asc':
          return valueForExpires(left) - valueForExpires(right);
        case 'expires_desc':
          return valueForExpires(right) - valueForExpires(left);
        case 'views_desc': {
          const diff = valueForViews(right) - valueForViews(left);
          return diff !== 0 ? diff : valueForCreated(right) - valueForCreated(left);
        }
        case 'created_desc':
        default:
          return valueForCreated(right) - valueForCreated(left);
      }
    });

    return items;
  }, [frames, sortBy]);

  const totalPages = useMemo(() => {
    if (!isAdminScope) {
      return 1;
    }

    return Math.max(1, Math.ceil(sortedFrames.length / ADMIN_ITEMS_PER_PAGE));
  }, [isAdminScope, sortedFrames.length]);

  const paginatedFrames = useMemo(() => {
    if (!isAdminScope) {
      return sortedFrames;
    }

    const start = (currentPage - 1) * ADMIN_ITEMS_PER_PAGE;
    return sortedFrames.slice(start, start + ADMIN_ITEMS_PER_PAGE);
  }, [currentPage, isAdminScope, sortedFrames]);

  useEffect(() => {
    setScope(initialScope);
  }, [initialScope]);

  useEffect(() => {
    setCurrentPage(getInitialDashboardPage());
  }, [initialScope]);

  useEffect(() => {
    if (!isAdminScope) {
      if (currentPage !== 1) {
        setCurrentPage(1);
      }
      return;
    }

    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, isAdminScope, totalPages]);

  const navigateScope = (nextScope: 'mine' | 'all') => {
    setScope(nextScope);
    setCurrentPage(1);
    const params = new URLSearchParams(window.location.search);
    params.set('dashboard', '1');
    if (nextScope === 'all') {
      params.set('scope', 'all');
      params.delete('page');
    } else {
      params.delete('scope');
      params.delete('page');
    }
    window.history.replaceState({}, '', `/?${params.toString()}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('dashboard', '1');

    if (isAdminScope) {
      params.set('scope', 'all');
      if (currentPage > 1) {
        params.set('page', String(currentPage));
      } else {
        params.delete('page');
      }
    } else {
      params.delete('scope');
      params.delete('page');
    }

    window.history.replaceState({}, '', `/?${params.toString()}`);
  }, [currentPage, isAdminScope]);

  const getPreviewSrc = (frame: FrameItem) => {
    if (frame.kind === 'orphan') {
      return `/api/frames?storageKey=${encodeURIComponent(frame.storageKey)}&preview=1`;
    }

    return `/api/frames/${frame.id}?ownerPreview=1`;
  };

  const fetchFrames = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = isAdminScope ? '?scope=all' : '';
      const res = await fetch(`/api/frames${query}`);
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      if (res.status === 403) {
        setError('この画面を開く権限がありません。');
        if (!user.isAdmin) {
          setScope('mine');
        }
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch frames');
      const data = (await res.json()) as { frames: FrameItem[]; meta?: FramesMeta };
      setFrames(data.frames ?? []);
      setMeta(data.meta ?? { totalCount: data.frames?.length ?? 0, registeredCount: data.frames?.length ?? 0, orphanCount: 0 });
    } catch {
      setError('フレーム一覧の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, [isAdminScope, user.isAdmin]);

  const openPreview = (frame: FrameItem) => {
    setPreviewError(false);
    setPreviewTarget(frame);
  };

  const closePreview = () => {
    setPreviewTarget(null);
    setPreviewError(false);
  };

  useEffect(() => {
    if (!previewTarget) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePreview();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewTarget]);

  useEffect(() => {
    if (!canShow) return;
    fetchFrames();
  }, [canShow, fetchFrames]);

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
      const targetQuery = deleteTarget.kind === 'orphan'
        ? `storageKey=${encodeURIComponent(deleteTarget.storageKey)}`
        : `id=${encodeURIComponent(deleteTarget.id)}`;
      const res = await fetch(`/api/frames?${targetQuery}`, { method: 'DELETE' });
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

  const togglePasswordVisibility = (frameId: string) => {
    setVisiblePasswords((current) => ({
      ...current,
      [frameId]: !current[frameId],
    }));
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
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('Missing portal url');
    } catch {
      setError('サブスクリプションの解約に失敗しました。');
    } finally {
      setCanceling(false);
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
        <div>
          <h1 className="text-xl sm:text-2xl font-black">{isAdminScope ? '全フレーム管理' : 'フレーム管理'}</h1>
          {isAdminScope ? (
            <p className="mt-1 text-xs text-tiktok-lightgray">全ユーザーの登録フレームと、R2 に残った孤児データを監査・強制削除できます。</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {user.isAdmin ? (
            <button
              type="button"
              onClick={() => navigateScope(isAdminScope ? 'mine' : 'all')}
              className="py-2.5 px-4 rounded-md border border-tiktok-gray bg-tiktok-dark hover:bg-tiktok-gray/40 text-white font-bold transition-colors text-sm"
            >
              {isAdminScope ? '自分のフレームへ戻る' : '全フレーム管理'}
            </button>
          ) : null}
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
      </div>

      {isAdminScope ? (
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-tiktok-gray bg-tiktok-dark px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-tiktok-lightgray">総件数</p>
            <p className="mt-1 text-2xl font-black text-white">{meta.totalCount}</p>
          </div>
          <div className="rounded-xl border border-tiktok-gray bg-tiktok-dark px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-tiktok-lightgray">登録フレーム</p>
            <p className="mt-1 text-2xl font-black text-white">{meta.registeredCount}</p>
          </div>
          <div className="rounded-xl border border-tiktok-gray bg-tiktok-dark px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-tiktok-lightgray">R2孤児データ</p>
            <p className="mt-1 text-2xl font-black text-white">{meta.orphanCount}</p>
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs text-tiktok-lightgray">
            {isAdminScope ? '登録日時降順が初期表示です。所有者名、有効期限、フレーム名、閲覧数でも並び替えできます。' : '登録日時や有効期限で並び替えできます。'}
          </p>
          {isAdminScope ? (
            <p className="text-xs text-tiktok-lightgray">
              {meta.totalCount}件中 {sortedFrames.length === 0 ? 0 : (currentPage - 1) * ADMIN_ITEMS_PER_PAGE + 1}-{Math.min(currentPage * ADMIN_ITEMS_PER_PAGE, sortedFrames.length)}件を表示
            </p>
          ) : null}
        </div>
        <label className="flex items-center gap-2 text-xs text-tiktok-lightgray">
          <span>並び替え</span>
          <select
            value={sortBy}
            onChange={(event) => {
              setSortBy(event.target.value as SortOption);
              setCurrentPage(1);
            }}
            className="rounded-md border border-tiktok-gray bg-tiktok-dark px-3 py-2 text-sm text-white focus:outline-none focus:border-tiktok-cyan"
          >
            <option value="created_desc">登録日時が新しい順</option>
            <option value="created_asc">登録日時が古い順</option>
            <option value="expires_asc">期限が近い順</option>
            <option value="expires_desc">期限が遠い順</option>
            <option value="name_asc">フレーム名 A-Z</option>
            <option value="name_desc">フレーム名 Z-A</option>
            {isAdminScope ? <option value="views_desc">閲覧数が多い順</option> : null}
            {isAdminScope ? <option value="owner_asc">所有者 A-Z</option> : null}
            {isAdminScope ? <option value="owner_desc">所有者 Z-A</option> : null}
          </select>
        </label>
      </div>

      {error ? (
        <div className="mb-4 w-full p-4 rounded-xl bg-tiktok-red/20 border border-tiktok-red/30 text-tiktok-red text-sm text-center">
          {error}
        </div>
      ) : null}

      {sortedFrames.length === 0 ? (
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
          {paginatedFrames.map((frame) => {
            const name = frame.displayName ?? '';
            const ownerLabel = frame.ownerDisplayName?.trim() || frame.ownerEmail || '不明なユーザー';
            const createdLabel = frame.createdAt
              ? new Date(frame.createdAt).toLocaleString('ja-JP', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '不明';

            let remainingText = '';
            let remainingClass = 'text-tiktok-lightgray';
            if (frame.remainingDays === null) {
              remainingText = frame.kind === 'orphan' ? 'DB未登録' : '無期限';
              remainingClass = 'text-tiktok-cyan';
            } else if (frame.remainingDays === 0) {
              remainingText = '期限切れ';
              remainingClass = 'text-tiktok-red';
            } else {
              remainingText = `残り${frame.remainingDays}日`;
              remainingClass = 'text-tiktok-lightgray';
            }

            const previewSrc = getPreviewSrc(frame);

            return (
              <div
                key={frame.id}
                className="w-full px-4 py-3 border-b border-tiktok-gray last:border-b-0 flex items-center gap-3"
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openPreview(frame)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openPreview(frame);
                    }
                  }}
                  className="min-w-0 flex flex-1 items-center gap-3 text-left rounded-lg transition-colors hover:bg-tiktok-gray/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-tiktok-cyan/80"
                >
                  <img
                    src={previewSrc}
                    alt={`${name} preview`}
                    className="w-12 h-12 rounded-full object-cover border border-tiktok-gray bg-tiktok-black"
                    loading="lazy"
                  />

                  <div className="min-w-0 flex-1 py-1">
                    <div className="flex flex-col gap-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <p
                          className="text-sm font-bold text-white break-all max-w-[18rem] sm:max-w-[28rem]"
                          style={{ wordBreak: 'break-all', whiteSpace: 'pre-line' }}
                          title={name}
                        >
                          {name}
                        </p>
                        {frame.kind === 'orphan' ? (
                          <span className="shrink-0 text-[11px] px-2 py-1 rounded-md border border-amber-500/35 bg-amber-500/10 text-amber-200 font-bold">
                            R2孤児データ
                          </span>
                        ) : null}
                        <span className="shrink-0 text-[10px] px-2 py-1 rounded-md border border-tiktok-gray text-tiktok-lightgray">
                          タップで拡大
                        </span>
                      </div>

                      <p className="text-xs text-tiktok-lightgray break-all">
                        登録日時: {createdLabel}
                      </p>

                      {isAdminScope ? (
                        <p className="text-xs text-tiktok-lightgray break-all">
                          閲覧数: {frame.viewCount ?? 0}
                        </p>
                      ) : null}

                      {isAdminScope ? (
                        <p className="text-xs text-tiktok-lightgray break-all">
                          所有者: {frame.kind === 'orphan' ? 'DB未登録' : ownerLabel}
                        </p>
                      ) : null}

                      {frame.kind === 'orphan' ? (
                        <p className="text-xs text-amber-200 break-all">
                          ストレージキー: {frame.storageKey}
                        </p>
                      ) : null}

                      {frame.passwordProtected ? (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 font-bold text-amber-200">
                            <Shield className="w-3.5 h-3.5" />
                            パスワード保護中
                          </span>

                          {frame.passwordValue ? (
                            <>
                              <span className="rounded-md bg-tiktok-black border border-tiktok-gray px-2.5 py-1 text-tiktok-lightgray">
                                {visiblePasswords[frame.id] ? frame.passwordValue : '••••••••'}
                              </span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  togglePasswordVisibility(frame.id);
                                }}
                                className="inline-flex items-center gap-1 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 px-2.5 py-1 font-bold text-white transition-colors"
                                aria-label={visiblePasswords[frame.id] ? 'hide password' : 'show password'}
                              >
                                {visiblePasswords[frame.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                {visiblePasswords[frame.id] ? '隠す' : '表示'}
                              </button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
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

      {isAdminScope && totalPages > 1 ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-tiktok-lightgray">
            {currentPage} / {totalPages} ページ
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              disabled={currentPage === 1}
              className="rounded-md border border-tiktok-gray bg-tiktok-dark px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-tiktok-gray/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              前へ
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
              className="rounded-md border border-tiktok-gray bg-tiktok-dark px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-tiktok-gray/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              次へ
            </button>
          </div>
        </div>
      ) : null}

      {user.plan === 'pro' && !user.isAdmin ? (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setCancelConfirm(true)}
            className="text-xs text-tiktok-lightgray/50 hover:text-tiktok-red/70 underline transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            サブスクリプションを解約する
          </button>
        </div>
      ) : null}

      {cancelConfirm ? (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-tiktok-dark p-5 shadow-2xl text-center">
            <p className="text-white font-bold mb-1">Stripeの管理画面へ移動しますか？</p>
            <p className="text-xs text-tiktok-lightgray mb-4">Stripeのサブスクリプション管理ページへ移動します。解約や支払い情報の確認はStripe側で行います。解約が完了すると、Pro機能は使えなくなります。</p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={handleCancelSubscription}
                disabled={canceling}
                className="flex-1 py-3 rounded-md bg-tiktok-red hover:bg-[#D92648] text-white font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {canceling ? '移動中...' : 'Stripeを開く'}
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

      {previewTarget ? (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-[1px] flex items-center justify-center px-4 py-6"
          onClick={closePreview}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-white/15 bg-tiktok-dark p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white break-all">{previewTarget.displayName}</p>
                <p className="mt-1 text-xs text-tiktok-lightgray break-all">
                  {previewTarget.kind === 'orphan'
                    ? `R2孤児データ: ${previewTarget.storageKey}`
                    : `フレームID: ${previewTarget.id}`}
                </p>
              </div>
              <button
                type="button"
                onClick={closePreview}
                className="shrink-0 rounded-md border border-tiktok-gray bg-tiktok-black px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-tiktok-gray/40"
              >
                閉じる
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-tiktok-gray bg-black">
              {previewError ? (
                <div className="flex min-h-[16rem] items-center justify-center px-6 py-12 text-center text-sm text-tiktok-lightgray">
                  画像を表示できませんでした。
                </div>
              ) : (
                <img
                  src={getPreviewSrc(previewTarget)}
                  alt={`${previewTarget.displayName} full preview`}
                  className="max-h-[75vh] w-full object-contain bg-black"
                  onError={() => setPreviewError(true)}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-tiktok-dark p-5 shadow-2xl text-center">
            <p className="text-sm text-white font-bold mb-2">
              {deleteTarget.kind === 'orphan'
                ? 'R2 にだけ残っている孤児データを完全削除します'
                : '削除するとURLが無効になり、リスナーがアクセスできなくなります'}
            </p>
            <p className="text-xs text-tiktok-lightgray mb-1 break-all">
              {deleteTarget.kind === 'orphan'
                ? `ストレージキー: ${deleteTarget.storageKey}`
                : `フレーム: ${deleteTarget.displayName}`}
            </p>
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
