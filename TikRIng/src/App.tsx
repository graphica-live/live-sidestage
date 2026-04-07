import { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import Home from './pages/Home';
import FrameEditor from './pages/FrameEditor';
import Expired from './pages/Expired';
import Dashboard from './pages/Dashboard';
import BrowserWarning from './components/BrowserWarning';
import { isTikTokInAppBrowser } from './utils/browser';

type User = {
  id: string;
  display_name: string;
  plan: string;
  isAdmin: boolean;
  email?: string | null;
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

  const showContactLink = !isDashboard;

  return (
    <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
      <main className="container mx-auto px-4 py-8 max-w-2xl min-h-screen flex flex-col">
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
      </main>
    </div>
  );
}

export default App;
