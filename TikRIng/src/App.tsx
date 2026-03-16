import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import Home from './pages/Home';
import FrameEditor from './pages/FrameEditor';
import Expired from './pages/Expired';
import Dashboard from './pages/Dashboard';
import BrowserWarning from './components/BrowserWarning';
import { isTikTokInAppBrowser } from './utils/browser';

function App() {
  const [frameId, setFrameId] = useState<string | null>(null);
  const [frameCheckStatus, setFrameCheckStatus] = useState<'idle' | 'loading' | 'ok' | 'expired'>('idle');
  const [isDashboard, setIsDashboard] = useState(false);
  const isTikTokInApp = isTikTokInAppBrowser();
  const [user, setUser] = useState<{ id: string; display_name: string; plan: string } | null | undefined>(undefined);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch user');
        return r.json();
      })
      .then((data: any) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    // Basic routing based on the query parameters
    const params = new URLSearchParams(window.location.search);
    const dashboard = params.get('dashboard');
    setIsDashboard(dashboard === '1');
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
        const res = await fetch(`/api/frames/${encodeURIComponent(frameId)}`, {
          method: 'GET',
          signal: controller.signal,
        });

        // 画像を二重にダウンロードしないため、ボディは読まずにキャンセルしておく
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }

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
  }, [frameId, isTikTokInApp]);

  useEffect(() => {
    if (isTikTokInApp) return;
    if (!isDashboard) return;
    if (user !== null) return;
    window.location.href = '/';
  }, [isDashboard, user, isTikTokInApp]);

  if (isTikTokInApp) {
    return <BrowserWarning />;
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
      <main className="container mx-auto px-4 py-8 max-w-2xl min-h-screen flex flex-col items-center justify-center">
        {isDashboard ? (
          user === undefined ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-12 h-12 animate-spin text-tiktok-cyan mb-4" />
              <p className="text-tiktok-lightgray">読み込み中...</p>
            </div>
          ) : user ? (
            <Dashboard user={user} />
          ) : (
            <Home user={user} />
          )
        ) : frameId ? (
          frameCheckStatus === 'loading' || frameCheckStatus === 'idle' ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="w-12 h-12 animate-spin text-tiktok-cyan mb-4" />
              <p className="text-tiktok-lightgray">フレームを読み込み中...</p>
            </div>
          ) : frameCheckStatus === 'ok' ? (
            <FrameEditor id={frameId} />
          ) : (
            <Expired />
          )
        ) : (
          <Home user={user} />
        )}
      </main>
    </div>
  );
}

export default App;
