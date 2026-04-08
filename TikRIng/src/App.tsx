import { useState, useEffect, useRef } from 'react';
import { House, LayoutDashboard, Loader2, LogOut, Settings } from 'lucide-react';
import Home from './pages/Home';
import FrameEditor from './pages/FrameEditor';
import Expired from './pages/Expired';
import Dashboard from './pages/Dashboard';
import BrowserWarning from './components/BrowserWarning';
import UserSettingsModal from './components/UserSettingsModal';
import { isTikTokInAppBrowser } from './utils/browser';

type User = {
  id: string;
  display_name: string;
  plan: string;
  isAdmin: boolean;
  email?: string | null;
  provider?: string;
};

type AuthMeResponse = {
  user: User | null;
};

function App() {
  const [frameId, setFrameId] = useState<string | null>(null);
  const [frameCheckStatus, setFrameCheckStatus] = useState<'idle' | 'loading' | 'ok' | 'expired'>('idle');
  const [isDashboard, setIsDashboard] = useState(false);
  const [dashboardScope, setDashboardScope] = useState<'mine' | 'all'>('mine');
  const isTikTokInApp = isTikTokInAppBrowser();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const syncInFlightRef = useRef(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch user');
        return r.json() as Promise<AuthMeResponse>;
      })
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  const handleUserChange = (nextUser: User) => {
    setUser(nextUser);
  };

  useEffect(() => {
    // A案: ログイン後の通常リロードでも pro 状態を自動同期する
    if (!user) return;
    if (syncInFlightRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const isCheckoutSuccess = params.get('checkout') === 'success';

    // 通常時は「現在Proの人」だけ同期して、返金/解約後のダウングレードを拾う
    if (user.isAdmin) return;
    if (!isCheckoutSuccess && user.plan !== 'pro') return;

    const key = `plan_sync_last:${user.id}`;
    try {
      const last = Number(sessionStorage.getItem(key) ?? '0');
      const now = Date.now();
      if (Number.isFinite(last) && now - last < 60_000) return;
      sessionStorage.setItem(key, String(now));
    } catch {
      // sessionStorageが使えなくても最低限は続行
    }

    syncInFlightRef.current = true;
    (async () => {
      try {
        await fetch('/api/checkout/sync', { method: 'POST' });
      } catch {
        // ignore
      }
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = (await res.json()) as AuthMeResponse;
          setUser(data.user);
        }
      } catch {
        // ignore
      } finally {
        syncInFlightRef.current = false;
      }
    })();
  }, [user]);

  useEffect(() => {
    // Basic routing based on the query parameters
    const params = new URLSearchParams(window.location.search);
    const dashboard = params.get('dashboard');
    setIsDashboard(dashboard === '1');
    setDashboardScope(params.get('scope') === 'all' ? 'all' : 'mine');
    const fId = params.get('f');
    setFrameId(fId);
  }, []);

  useEffect(() => {
    if (isTikTokInApp) return;
    if (isDashboard) return;

    if (!frameId) {
      setFrameCheckStatus('idle');
      return;
    }

    const controller = new AbortController();
    setFrameCheckStatus('loading');

    (async () => {
      try {
        const res = await fetch(`/api/frames/${encodeURIComponent(frameId)}?meta=1&_t=${Date.now()}`, {
          method: 'GET',
          signal: controller.signal,
        });

        if (res.status === 200) {
          setFrameCheckStatus('ok');
          return;
        }
        if (res.status === 404 || res.status === 410) {
          setFrameCheckStatus('expired');
          return;
        }

        setFrameCheckStatus('expired');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFrameCheckStatus('expired');
      }
    })();

    return () => controller.abort();
  }, [frameId, isDashboard, isTikTokInApp]);

  useEffect(() => {
    if (isTikTokInApp) return;
    if (!isDashboard) return;
    if (user !== null) return;
    window.location.href = '/';
  }, [isDashboard, user, isTikTokInApp]);

  if (isTikTokInApp) {
    return <BrowserWarning />;
  }

  const currentView = isDashboard ? 'dashboard' : frameId ? 'frame' : 'home';
  const navButtonClass = 'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-tiktok-gray bg-tiktok-dark px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-tiktok-gray/40 sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm';
  const logoutButtonClass = 'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-tiktok-red px-3 py-2 text-xs font-bold text-white transition-colors shadow-lg hover:bg-[#D92648] sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm';
  const showContactLink = !isDashboard;

  return (
    <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
      <main className="container mx-auto px-4 py-8 max-w-2xl min-h-screen flex flex-col">
        {user ? (
          <div className="mb-6 w-full overflow-x-auto rounded-2xl border border-white/10 bg-tiktok-dark/80 px-3 py-3 shadow-[0_14px_40px_rgba(0,0,0,0.24)] sm:px-4 sm:py-4">
            <div className="flex min-w-max flex-nowrap items-center gap-2">
              <p className="shrink-0 text-[11px] font-black uppercase tracking-[0.22em] text-tiktok-lightgray">Signed In</p>
              <p className="shrink-0 text-sm font-black text-white sm:text-base">{user.display_name}</p>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${user.plan === 'pro' || user.isAdmin ? 'border border-tiktok-cyan/30 bg-tiktok-cyan/20 text-tiktok-cyan' : 'border border-tiktok-gray bg-tiktok-gray text-tiktok-lightgray'}`}>
                {user.plan === 'pro' || user.isAdmin ? 'Pro' : '無料'}
              </span>
              {currentView !== 'home' ? (
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = '/';
                  }}
                  className={navButtonClass}
                >
                  <House className="h-4 w-4" />
                  TOPへ戻る
                </button>
              ) : null}
              {currentView !== 'dashboard' ? (
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = '/?dashboard=1';
                  }}
                  className={navButtonClass}
                >
                  <LayoutDashboard className="h-4 w-4" />
                  フレーム管理
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className={navButtonClass}
              >
                <Settings className="h-4 w-4" />
                設定
              </button>
              <form action="/api/auth/logout" method="post" className="shrink-0">
                <button type="submit" className={logoutButtonClass}>
                  <LogOut className="h-4 w-4" />
                  ログアウト
                </button>
              </form>
            </div>
          </div>
        ) : null}

        <div className="flex-1 flex flex-col items-center justify-center">
          {isDashboard ? (
            user === undefined ? (
              <div className="flex flex-col items-center justify-center py-20">
                <Loader2 className="w-12 h-12 animate-spin text-tiktok-cyan mb-4" />
                <p className="text-tiktok-lightgray">読み込み中...</p>
              </div>
            ) : user ? (
              <Dashboard user={user} initialScope={dashboardScope} />
            ) : (
              <Home user={user} />
            )
          ) : (
            frameId ? (
              frameCheckStatus === 'loading' || frameCheckStatus === 'idle' ? (
                <div className="flex flex-col items-center justify-center py-20">
                  <Loader2 className="w-12 h-12 animate-spin text-tiktok-cyan mb-4" />
                  <p className="text-tiktok-lightgray">フレームを読み込み中...</p>
                </div>
              ) : frameCheckStatus === 'ok' ? (
                <FrameEditor id={frameId} user={user} />
              ) : (
                <Expired />
              )
            ) : (
              <Home user={user} />
            )
          )}
        </div>

        {showContactLink ? (
          <div className="flex w-full items-center justify-center gap-3 pt-8 pb-2 text-center">
            <a
              href="https://www.tiktok.com/@yu_ki_nojo?lang=ja-JP"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-tiktok-lightgray/80 underline underline-offset-4 hover:text-white"
            >
              お問い合わせ先
            </a>
            <span className="text-xs text-tiktok-lightgray/40">|</span>
            <a
              href="/"
              className="text-xs text-tiktok-lightgray/80 underline underline-offset-4 hover:text-white"
            >
              TikRingトップページ
            </a>
          </div>
        ) : null}

        {user ? (
          <UserSettingsModal
            open={settingsOpen}
            user={user}
            onClose={() => setSettingsOpen(false)}
            onUserChange={handleUserChange}
          />
        ) : null}
      </main>
    </div>
  );
}

export default App;
