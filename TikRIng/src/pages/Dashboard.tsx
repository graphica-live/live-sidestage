import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Link as LinkIcon, Loader2, Search, Settings, Shield, Trash2 } from 'lucide-react';
import { getFrameOpeningGuideDataUrl } from '../utils/canvas';

type User = { id: string; display_name: string; plan: string; isAdmin: boolean; email?: string | null; provider?: string };

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
  wearCount?: number;
};

type FramesMeta = {
  totalCount: number | null;
  registeredCount: number | null;
  orphanCount: number | null;
  page: number;
  pageSize: number;
  hasNextPage?: boolean;
};

type SortOption = 'created_desc' | 'created_asc' | 'owner_asc' | 'owner_desc' | 'name_asc' | 'name_desc' | 'expires_asc' | 'expires_desc' | 'views_desc';
type PreviewMode = 'default' | 'opening-guide';
type PreviewState = {
  frame: FrameItem;
  mode: PreviewMode;
};
type AdminSection = 'registered' | 'orphans';
type FrameDetails = {
  shareUrl: string | null;
  passwordValue: string | null;
};

type DisplayNameUpdateResponse = {
  error?: string;
  message?: string;
  user?: User;
};

const ADMIN_ITEMS_PER_PAGE = 50;

const DEFAULT_META: FramesMeta = {
  totalCount: 0,
  registeredCount: 0,
  orphanCount: 0,
  page: 1,
  pageSize: ADMIN_ITEMS_PER_PAGE,
};

function isSortOption(value: string | null): value is SortOption {
  return value === 'created_desc'
    || value === 'created_asc'
    || value === 'owner_asc'
    || value === 'owner_desc'
    || value === 'name_asc'
    || value === 'name_desc'
    || value === 'expires_asc'
    || value === 'expires_desc'
    || value === 'views_desc';
}

function getInitialDashboardPage() {
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get('page') || '1');

  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }

  return Math.floor(page);
}

function getInitialDashboardSort(): SortOption {
  const params = new URLSearchParams(window.location.search);
  const sort = params.get('sort');
  return isSortOption(sort) ? sort : 'created_desc';
}

function getInitialAdminSection(): AdminSection {
  const params = new URLSearchParams(window.location.search);
  return params.get('view') === 'orphans' ? 'orphans' : 'registered';
}

interface DashboardProps {
  user: User;
  initialScope: 'mine' | 'all';
  onUserChange: (user: User) => void;
}

export default function Dashboard({ user, initialScope, onUserChange }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  const [frames, setFrames] = useState<FrameItem[]>([]);
  const [meta, setMeta] = useState<FramesMeta>(DEFAULT_META);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FrameItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const [previewGuideUrl, setPreviewGuideUrl] = useState<string | null>(null);
  const [previewGuideLoading, setPreviewGuideLoading] = useState(false);
  const [previewGuideError, setPreviewGuideError] = useState<string | null>(null);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [frameDetails, setFrameDetails] = useState<Record<string, FrameDetails>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [scope, setScope] = useState<'mine' | 'all'>(initialScope);
  const [sortBy, setSortBy] = useState<SortOption>(() => getInitialDashboardSort());
  const [adminSection, setAdminSection] = useState<AdminSection>(() => getInitialAdminSection());
  const [currentPage, setCurrentPage] = useState(() => getInitialDashboardPage());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState(user.display_name);
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  const [displayNameMessage, setDisplayNameMessage] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const canShow = useMemo(() => !!user, [user]);
  const isAdminScope = user.isAdmin && scope === 'all';
  const isOrphanSection = isAdminScope && adminSection === 'orphans';
  const canShowFrameStats = isAdminScope || user.isAdmin || user.plan === 'pro';

  const displayFrames = useMemo(() => {
    if (isAdminScope) {
      return frames;
    }

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
  }, [frames, isAdminScope, sortBy]);

  const totalPages = useMemo(() => {
    if (!isAdminScope || isOrphanSection) {
      return 1;
    }

    const totalCount = meta.totalCount ?? 0;
    return Math.max(1, Math.ceil(totalCount / ADMIN_ITEMS_PER_PAGE));
  }, [isAdminScope, isOrphanSection, meta.totalCount]);

  useEffect(() => {
    setScope(initialScope);
    if (initialScope === 'all') {
      setAdminSection(getInitialAdminSection());
      setSortBy(getInitialDashboardSort());
      setCurrentPage(getInitialDashboardPage());
      return;
    }

    setAdminSection('registered');
    setCurrentPage(1);
  }, [initialScope]);

  useEffect(() => {
    setDisplayNameInput(user.display_name);
  }, [user.display_name]);

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
  }, [currentPage, isAdminScope, isOrphanSection, totalPages]);

  const navigateScope = (nextScope: 'mine' | 'all') => {
    setScope(nextScope);
    setAdminSection('registered');
    setCurrentPage(1);
    const params = new URLSearchParams(window.location.search);
    params.set('dashboard', '1');
    if (nextScope === 'all') {
      params.set('scope', 'all');
      params.delete('page');
      params.delete('view');
      params.delete('sort');
    } else {
      params.delete('scope');
      params.delete('page');
      params.delete('view');
      params.delete('sort');
    }
    window.history.replaceState({}, '', `/?${params.toString()}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('dashboard', '1');

    if (isAdminScope) {
      params.set('scope', 'all');
      params.set('view', adminSection);
      if (currentPage > 1) {
        params.set('page', String(currentPage));
      } else {
        params.delete('page');
      }

      if (adminSection === 'registered' && sortBy !== 'created_desc') {
        params.set('sort', sortBy);
      } else {
        params.delete('sort');
      }
    } else {
      params.delete('scope');
      params.delete('page');
      params.delete('view');
      params.delete('sort');
    }

    window.history.replaceState({}, '', `/?${params.toString()}`);
  }, [adminSection, currentPage, isAdminScope, sortBy]);

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
      const query = new URLSearchParams();
      let endpoint = '/api/frames';

      if (isAdminScope) {
        query.set('page', String(currentPage));
        query.set('pageSize', String(ADMIN_ITEMS_PER_PAGE));

        if (adminSection === 'registered') {
          query.set('scope', 'all');
          query.set('sort', sortBy);
        } else {
          endpoint = '/api/frames/orphans';
        }
      }

      const queryString = query.toString();
      const res = await fetch(queryString ? `${endpoint}?${queryString}` : endpoint);
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

      if (isAdminScope && adminSection === 'orphans' && currentPage > 1 && (data.frames?.length ?? 0) === 0) {
        setCurrentPage((page) => Math.max(1, page - 1));
        return;
      }

      setFrames(data.frames ?? []);
      setMeta(data.meta ?? {
        totalCount: data.frames?.length ?? 0,
        registeredCount: data.frames?.length ?? 0,
        orphanCount: 0,
        page: 1,
        pageSize: data.frames?.length ?? ADMIN_ITEMS_PER_PAGE,
      });
    } catch {
      setError('フレーム一覧の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, [adminSection, currentPage, isAdminScope, sortBy, user.isAdmin]);

  const loadFrameDetails = useCallback(async (frame: FrameItem) => {
    if (frame.kind !== 'frame') {
      return null;
    }

    const existing = frameDetails[frame.id];
    if (existing) {
      return existing;
    }

    if (!isAdminScope) {
      return {
        shareUrl: frame.shareUrl,
        passwordValue: frame.passwordValue,
      };
    }

    if (detailLoading[frame.id]) {
      return null;
    }

    setDetailLoading((current) => ({ ...current, [frame.id]: true }));

    try {
      const res = await fetch(`/api/frames/${encodeURIComponent(frame.id)}?ownerDetails=1`);
      if (res.status === 401) {
        window.location.href = '/';
        return null;
      }
      if (!res.ok) {
        throw new Error('Failed to fetch frame details');
      }

      const data = await res.json() as FrameDetails;
      const details = {
        shareUrl: data.shareUrl ?? null,
        passwordValue: data.passwordValue ?? null,
      };
      setFrameDetails((current) => ({ ...current, [frame.id]: details }));
      return details;
    } catch {
      setError('フレーム詳細の取得に失敗しました。');
      return null;
    } finally {
      setDetailLoading((current) => ({ ...current, [frame.id]: false }));
    }
  }, [detailLoading, frameDetails, isAdminScope]);

  const openPreview = (frame: FrameItem, mode: PreviewMode = 'default') => {
    setPreviewError(false);
    setPreviewGuideUrl(null);
    setPreviewGuideError(null);
    setPreviewGuideLoading(mode === 'opening-guide');
    setPreviewState({ frame, mode });
  };

  const closePreview = () => {
    setPreviewState(null);
    setPreviewError(false);
    setPreviewGuideUrl(null);
    setPreviewGuideError(null);
    setPreviewGuideLoading(false);
  };

  useEffect(() => {
    if (!previewState) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePreview();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewState]);

  useEffect(() => {
    if (!previewState || previewState.mode !== 'opening-guide') {
      setPreviewGuideUrl(null);
      setPreviewGuideError(null);
      setPreviewGuideLoading(false);
      return;
    }

    let cancelled = false;
    const previewSrc = getPreviewSrc(previewState.frame);

    setPreviewGuideUrl(null);
    setPreviewGuideError(null);
    setPreviewGuideLoading(true);

    getFrameOpeningGuideDataUrl(previewSrc)
      .then((guideUrl) => {
        if (cancelled) {
          return;
        }

        if (guideUrl) {
          setPreviewGuideUrl(guideUrl);
          return;
        }

        setPreviewGuideError('赤塗りの表示範囲を生成できませんでした。');
      })
      .catch(() => {
        if (!cancelled) {
          setPreviewGuideError('赤塗りの表示範囲を読み込めませんでした。');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewGuideLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [previewState]);

  useEffect(() => {
    if (!canShow) return;
    fetchFrames();
  }, [canShow, fetchFrames]);

  const createShareUrl = useCallback(async (frame: FrameItem) => {
    if (frame.kind !== 'frame') {
      return null;
    }

    setDetailLoading((current) => ({ ...current, [frame.id]: true }));

    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ frameId: frame.id }),
      });

      if (res.status === 401) {
        window.location.href = '/';
        return null;
      }

      if (res.status === 403) {
        setError('このフレームの共有URLを生成する権限がありません。');
        return null;
      }

      if (!res.ok) {
        throw new Error('Failed to create share url');
      }

      const data = await res.json() as { url?: string };
      const shareUrl = typeof data.url === 'string' && data.url ? data.url : null;

      if (!shareUrl) {
        throw new Error('Missing share url');
      }

      setFrameDetails((current) => ({
        ...current,
        [frame.id]: {
          shareUrl,
          passwordValue: current[frame.id]?.passwordValue ?? frame.passwordValue ?? null,
        },
      }));
      setFrames((current) => current.map((item) => (
        item.id === frame.id ? { ...item, shareUrl } : item
      )));

      return shareUrl;
    } catch {
      setError('共有URLの生成に失敗しました。');
      return null;
    } finally {
      setDetailLoading((current) => ({ ...current, [frame.id]: false }));
    }
  }, []);

  const handleCopy = async (frame: FrameItem) => {
    let shareUrl = frameDetails[frame.id]?.shareUrl ?? frame.shareUrl;
    if (!shareUrl) {
      shareUrl = await createShareUrl(frame);
    }
    if (!shareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedId(frame.id);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === frame.id ? null : cur));
      }, 2000);
    } catch {
      // ignore
    }
  };

  const handlePasswordVisibility = async (frame: FrameItem) => {
    if (!frame.passwordProtected) {
      return;
    }

    const details = await loadFrameDetails(frame);
    const passwordValue = details?.passwordValue ?? frame.passwordValue;
    if (!passwordValue) {
      setError('パスワードの取得に失敗しました。');
      return;
    }

    setVisiblePasswords((current) => ({
      ...current,
      [frame.id]: !current[frame.id],
    }));
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

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval: billingInterval }),
      });
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      if (!res.ok) throw new Error('Checkout failed');
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('Missing checkout url');
    } catch {
      setError('チェックアウトの開始に失敗しました。もう一度お試しください。');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleDisplayNameSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (displayNameSaving) {
      return;
    }

    const nextDisplayName = displayNameInput.trim();
    if (!nextDisplayName) {
      setDisplayNameError('ユーザー名を入力してください。');
      setDisplayNameMessage(null);
      return;
    }

    if (nextDisplayName === user.display_name) {
      setDisplayNameError(null);
      setDisplayNameMessage('現在のユーザー名と同じです。');
      return;
    }

    setDisplayNameSaving(true);
    setDisplayNameError(null);
    setDisplayNameMessage(null);

    try {
      const endpoints = ['/api/auth/me', '/api/auth/display-name'];
      let responseUser: User | null = null;
      let lastErrorCode = 'FAILED_TO_UPDATE_DISPLAY_NAME';

      for (const endpoint of endpoints) {
        let res: Response;
        try {
          res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ displayName: nextDisplayName }),
          });
        } catch {
          lastErrorCode = 'NETWORK_ERROR';
          continue;
        }

        if (res.status === 401) {
          window.location.href = '/';
          return;
        }

        let data: DisplayNameUpdateResponse | null = null;
        try {
          data = await res.json() as DisplayNameUpdateResponse;
        } catch {
          data = null;
        }

        if (res.ok && data?.user) {
          responseUser = data.user;
          break;
        }

        lastErrorCode = data?.message || data?.error || `HTTP_${res.status}`;

        if (res.status !== 404) {
          break;
        }
      }

      if (!responseUser) {
        throw new Error(lastErrorCode);
      }

      onUserChange(responseUser);
      setDisplayNameInput(responseUser.display_name);
      setDisplayNameMessage('ユーザー名を更新しました。ランキング表示にも反映されます。');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'FAILED_TO_UPDATE_DISPLAY_NAME';
      if (message === 'DISPLAY_NAME_REQUIRED') {
        setDisplayNameError('ユーザー名を入力してください。');
      } else if (message === 'NETWORK_ERROR') {
        setDisplayNameError('通信に失敗しました。時間をおいて再度お試しください。');
      } else {
        setDisplayNameError(`ユーザー名の更新に失敗しました。(${message})`);
      }
    } finally {
      setDisplayNameSaving(false);
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
            onClick={() => setSettingsOpen(true)}
            className="inline-flex items-center gap-2 py-2.5 px-4 rounded-md border border-tiktok-gray bg-tiktok-dark hover:bg-tiktok-gray/40 text-white font-bold transition-colors text-sm"
          >
            <Settings className="h-4 w-4" />
            設定
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = '/';
            }}
            className="py-2.5 px-4 rounded-md bg-tiktok-red hover:bg-[#D92648] text-white font-bold transition-colors shadow-lg text-sm"
          >
              TOPへ戻る
          </button>
        </div>
      </div>

      {isAdminScope ? (
        <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-xl border border-tiktok-gray bg-tiktok-dark px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-tiktok-lightgray">登録フレーム</p>
            <p className="mt-1 text-2xl font-black text-white">{meta.registeredCount ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-tiktok-gray bg-tiktok-dark px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-tiktok-lightgray">R2孤児データ</p>
            <p className="mt-1 text-2xl font-black text-white">{meta.orphanCount ?? '-'}</p>
          </div>
          <div className="rounded-xl border border-tiktok-gray bg-tiktok-dark px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-tiktok-lightgray">現在の表示</p>
            <p className="mt-1 text-lg font-black text-white">{isOrphanSection ? `孤児 ${currentPage}ページ目` : `${currentPage} / ${totalPages} ページ`}</p>
          </div>
        </div>
      ) : null}

      {isAdminScope ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setAdminSection('registered');
              setCurrentPage(1);
              setError(null);
            }}
            className={`rounded-md border px-4 py-2 text-sm font-bold transition-colors ${adminSection === 'registered' ? 'border-tiktok-cyan bg-tiktok-cyan/15 text-white' : 'border-tiktok-gray bg-tiktok-dark text-tiktok-lightgray hover:bg-tiktok-gray/40 hover:text-white'}`}
          >
            登録フレーム一覧
          </button>
          <button
            type="button"
            onClick={() => {
              setAdminSection('orphans');
              setCurrentPage(1);
              setError(null);
            }}
            className={`rounded-md border px-4 py-2 text-sm font-bold transition-colors ${adminSection === 'orphans' ? 'border-tiktok-cyan bg-tiktok-cyan/15 text-white' : 'border-tiktok-gray bg-tiktok-dark text-tiktok-lightgray hover:bg-tiktok-gray/40 hover:text-white'}`}
          >
            R2孤児データ
          </button>
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs text-tiktok-lightgray">
            {isOrphanSection
              ? 'R2孤児データは必要時のみ読み込みます。孤児一覧では共有URLとパスワードは取得しません。'
              : isAdminScope
                ? '管理者一覧はサーバ側で50件ずつ取得します。所有者名、有効期限、フレーム名、閲覧数、装着数を確認できます。'
                : canShowFrameStats
                  ? '登録日時や有効期限に加えて、閲覧数と装着数も確認できます。'
                  : '登録日時や有効期限で並び替えできます。'}
          </p>
          {isAdminScope && !isOrphanSection ? (
            <p className="text-xs text-tiktok-lightgray">
              {(meta.totalCount ?? 0) === 0 ? 0 : (currentPage - 1) * ADMIN_ITEMS_PER_PAGE + 1}-{Math.min(currentPage * ADMIN_ITEMS_PER_PAGE, meta.totalCount ?? 0)}件 / 全{meta.totalCount ?? 0}件
            </p>
          ) : null}
          {isOrphanSection ? (
            <p className="text-xs text-tiktok-lightgray">孤児データの総件数は初回ロードでは計算しません。前へ/次へで50件ずつ確認できます。</p>
          ) : null}
        </div>
        {!isOrphanSection ? (
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
              {canShowFrameStats ? <option value="views_desc">閲覧数が多い順</option> : null}
              {isAdminScope ? <option value="owner_asc">所有者 A-Z</option> : null}
              {isAdminScope ? <option value="owner_desc">所有者 Z-A</option> : null}
            </select>
          </label>
        ) : null}
      </div>

      {error ? (
        <div className="mb-4 w-full p-4 rounded-xl bg-tiktok-red/20 border border-tiktok-red/30 text-tiktok-red text-sm text-center">
          {error}
        </div>
      ) : null}

      {displayFrames.length === 0 ? (
        <div className="w-full rounded-md bg-tiktok-dark border border-tiktok-gray p-6 text-center">
          <p className="text-white font-bold mb-2">{isOrphanSection ? 'R2孤児データは見つかりませんでした' : '登録済みのフレームはありません'}</p>
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
          {displayFrames.map((frame) => {
            const name = frame.displayName ?? '';
            const ownerLabel = frame.ownerDisplayName?.trim() || frame.ownerEmail || '不明なユーザー';
            const frameDetail = frameDetails[frame.id];
            const passwordValue = frame.passwordValue ?? frameDetail?.passwordValue ?? null;
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

                      {canShowFrameStats ? (
                        <p className="text-xs text-tiktok-lightgray break-all">
                          閲覧数: {frame.viewCount ?? 0}
                        </p>
                      ) : null}

                      {canShowFrameStats ? (
                        <p className="text-xs text-tiktok-lightgray break-all">
                          装着数: {frame.wearCount ?? 0}
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

                          {passwordValue ? (
                            <>
                              <span className="rounded-md bg-tiktok-black border border-tiktok-gray px-2.5 py-1 text-tiktok-lightgray">
                                {visiblePasswords[frame.id] ? passwordValue : '••••••••'}
                              </span>
                              <button
                                type="button"
                                onClick={async (event) => {
                                  event.stopPropagation();
                                  await handlePasswordVisibility(frame);
                                }}
                                disabled={detailLoading[frame.id]}
                                className="inline-flex items-center gap-1 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 px-2.5 py-1 font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label={visiblePasswords[frame.id] ? 'hide password' : 'show password'}
                              >
                                {visiblePasswords[frame.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                {visiblePasswords[frame.id] ? '隠す' : '表示'}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={async (event) => {
                                event.stopPropagation();
                                await handlePasswordVisibility(frame);
                              }}
                              disabled={detailLoading[frame.id]}
                              className="inline-flex items-center gap-1 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 px-2.5 py-1 font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {detailLoading[frame.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                              {detailLoading[frame.id] ? '読込中...' : '表示'}
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className={`text-xs font-bold shrink-0 ${remainingClass}`}>{remainingText}</div>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openPreview(frame, 'opening-guide');
                  }}
                  className="shrink-0 p-2 rounded-md bg-tiktok-gray hover:bg-tiktok-red/20 transition-colors"
                  aria-label="show opening guide"
                  title="赤塗りの表示範囲を見る"
                >
                  <Search className="w-4 h-4 text-tiktok-red" />
                </button>

                <button
                  type="button"
                  onClick={async () => handleCopy(frame)}
                  disabled={frame.kind === 'orphan' || detailLoading[frame.id]}
                  className="shrink-0 p-2 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="copy url"
                >
                  {detailLoading[frame.id] ? (
                    <Loader2 className="w-4 h-4 text-white animate-spin" />
                  ) : copiedId === frame.id ? (
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

      {isAdminScope && !isOrphanSection && totalPages > 1 ? (
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

      {isOrphanSection ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-tiktok-lightgray">
            {currentPage} ページ目
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
              onClick={() => setCurrentPage((page) => page + 1)}
              disabled={!meta.hasNextPage}
              className="rounded-md border border-tiktok-gray bg-tiktok-dark px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-tiktok-gray/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              次へ
            </button>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-[1px] flex items-center justify-center px-4 py-6"
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-white/15 bg-tiktok-dark p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-settings-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-tiktok-lightgray">Account Settings</p>
                <h2 id="dashboard-settings-title" className="mt-1 text-xl font-black text-white">設定</h2>
                <p className="mt-1 text-xs text-tiktok-lightgray">ユーザー名の変更と Pro の課金状態をここで管理できます。</p>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-md border border-tiktok-gray bg-tiktok-black px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-tiktok-gray/40"
              >
                閉じる
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <section className="rounded-xl border border-tiktok-gray bg-tiktok-black/70 p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-tiktok-lightgray">ユーザー名</p>
                    <p className="mt-1 text-lg font-black text-white break-all">{user.display_name}</p>
                    <p className="mt-1 text-xs text-tiktok-lightgray">変更後の名前はランキングと管理画面の表示に使われます。</p>
                  </div>
                </div>
                <form onSubmit={handleDisplayNameSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex-1 text-sm text-tiktok-lightgray">
                    <span className="mb-1 block text-xs">新しいユーザー名</span>
                    <input
                      type="text"
                      value={displayNameInput}
                      onChange={(event) => {
                        setDisplayNameInput(event.target.value);
                        if (displayNameError) {
                          setDisplayNameError(null);
                        }
                        if (displayNameMessage) {
                          setDisplayNameMessage(null);
                        }
                      }}
                      placeholder="ユーザー名を入力"
                      maxLength={100}
                      className="w-full rounded-md border border-tiktok-gray bg-tiktok-black px-3 py-2.5 text-sm text-white focus:border-tiktok-cyan focus:outline-none"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={displayNameSaving}
                    className="inline-flex min-w-[140px] items-center justify-center rounded-md bg-tiktok-cyan px-4 py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#53f3ff] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {displayNameSaving ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        保存中...
                      </span>
                    ) : 'ユーザー名を保存'}
                  </button>
                </form>
                {displayNameError ? (
                  <p className="mt-3 text-sm text-tiktok-red">{displayNameError}</p>
                ) : null}
                {displayNameMessage ? (
                  <p className="mt-3 text-sm text-tiktok-cyan">{displayNameMessage}</p>
                ) : null}
              </section>

              <section className="rounded-xl border border-tiktok-gray bg-tiktok-black/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.16em] text-tiktok-lightgray">Pro課金</p>
                    <p className="mt-1 text-lg font-black text-white">{user.isAdmin ? '管理者権限で Pro 相当' : user.plan === 'pro' ? 'Pro 利用中' : '無料プラン'}</p>
                    <p className="mt-1 text-xs text-tiktok-lightgray">
                      {user.isAdmin
                        ? '管理者アカウントのため、課金なしで Pro 機能を利用できます。'
                        : user.plan === 'pro'
                          ? 'サブスクリプション管理ページから解約や支払い情報の確認ができます。'
                          : '有効期限設定、パスワード保護、閲覧数・装着数の確認が使えます。'}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${user.plan === 'pro' || user.isAdmin ? 'bg-tiktok-cyan/20 text-tiktok-cyan border border-tiktok-cyan/30' : 'bg-tiktok-gray text-tiktok-lightgray border border-tiktok-gray'}`}>
                    {user.plan === 'pro' || user.isAdmin ? 'Pro' : '無料'}
                  </span>
                </div>

                {!user.isAdmin && user.plan !== 'pro' ? (
                  <>
                    <ul className="mt-4 space-y-1 pl-5 text-xs text-tiktok-lightgray list-disc">
                      <li>有効期限を自由に設定（1日〜無期限）</li>
                      <li>フレームにパスワードを設定</li>
                      <li>閲覧数・装着数を確認</li>
                      <li>フレームに名前を付けて整理しやすく</li>
                    </ul>

                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label
                        className={`rounded-md border px-3 py-2 cursor-pointer transition-colors ${billingInterval === 'monthly'
                          ? 'border-tiktok-cyan/50 bg-tiktok-cyan/10'
                          : 'border-tiktok-gray bg-tiktok-black'}
                        `}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="dashboardBillingInterval"
                            value="monthly"
                            checked={billingInterval === 'monthly'}
                            onChange={() => setBillingInterval('monthly')}
                            className="accent-white"
                          />
                          <span className="text-sm font-bold text-white">月払い 380円/月</span>
                        </div>
                      </label>

                      <label
                        className={`rounded-md border px-3 py-2 cursor-pointer transition-colors ${billingInterval === 'yearly'
                          ? 'border-tiktok-cyan/50 bg-tiktok-cyan/10'
                          : 'border-tiktok-gray bg-tiktok-black'}
                        `}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="dashboardBillingInterval"
                              value="yearly"
                              checked={billingInterval === 'yearly'}
                              onChange={() => setBillingInterval('yearly')}
                              className="accent-white"
                            />
                            <span className="text-sm font-bold text-white">年払い 3,800円/年</span>
                          </div>
                          {billingInterval === 'yearly' ? (
                            <span className="shrink-0 rounded-full border border-tiktok-cyan/30 bg-tiktok-cyan/20 px-2 py-0.5 text-[10px] font-bold text-tiktok-cyan">
                              2ヶ月分お得
                            </span>
                          ) : null}
                        </div>
                      </label>
                    </div>

                    <button
                      type="button"
                      onClick={handleCheckout}
                      disabled={checkoutLoading}
                      className="mt-4 w-full rounded-md bg-tiktok-red px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#D92648] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {checkoutLoading ? 'チェックアウトを準備中...' : 'Proにアップグレードする'}
                    </button>
                  </>
                ) : null}

                {!user.isAdmin && user.plan === 'pro' ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-tiktok-dark px-4 py-4">
                    <button
                      type="button"
                      onClick={() => setCancelConfirm(true)}
                      className="w-full rounded-md border border-tiktok-red/40 bg-tiktok-red/10 px-4 py-2.5 text-sm font-bold text-tiktok-red transition-colors hover:bg-tiktok-red/20"
                    >
                      サブスクリプションを解約する
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          </div>
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

      {previewState ? (
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
                <p className="text-sm font-bold text-white break-all">{previewState.frame.displayName}</p>
                <p className="mt-1 text-xs text-tiktok-lightgray break-all">
                  {previewState.mode === 'opening-guide'
                    ? '赤塗りのアイコン表示範囲プレビュー'
                    : previewState.frame.kind === 'orphan'
                      ? `R2孤児データ: ${previewState.frame.storageKey}`
                      : `フレームID: ${previewState.frame.id}`}
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
                <div className="relative flex min-h-[16rem] items-center justify-center bg-black">
                  <img
                    src={getPreviewSrc(previewState.frame)}
                    alt={`${previewState.frame.displayName} full preview`}
                    className="max-h-[75vh] w-full object-contain bg-black"
                    onError={() => setPreviewError(true)}
                  />

                  {previewState.mode === 'opening-guide' ? (
                    <>
                      {previewGuideUrl ? (
                        <img
                          src={previewGuideUrl}
                          alt="Opening guide overlay"
                          className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-95"
                        />
                      ) : null}

                      {previewGuideLoading ? (
                        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
                          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 py-2 text-xs font-bold text-white backdrop-blur-sm">
                            <Loader2 className="h-4 w-4 animate-spin text-tiktok-red" />
                            赤塗りの表示範囲を生成中...
                          </div>
                        </div>
                      ) : null}

                      {previewGuideError ? (
                        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
                          <div className="max-w-md rounded-2xl border border-amber-300/35 bg-[#2A1904]/88 px-4 py-3 text-center shadow-[0_18px_50px_rgba(0,0,0,0.42)]">
                            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-200">Opening Guide</p>
                            <p className="mt-1 text-sm font-bold text-white">{previewGuideError}</p>
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
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
