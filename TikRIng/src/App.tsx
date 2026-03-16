import { useState, useEffect } from 'react';
import Home from './pages/Home';
import FrameEditor from './pages/FrameEditor';
import BrowserWarning from './components/BrowserWarning';
import { isTikTokInAppBrowser } from './utils/browser';

function App() {
  const [frameId, setFrameId] = useState<string | null>(null);
  const isTikTokInApp = isTikTokInAppBrowser();
  const [user, setUser] = useState<{ id: string; display_name: string; plan: string } | null | undefined>(undefined);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(r => r.json<{ user: typeof user }>())
      .then(data => setUser(data.user));
  }, []);

  useEffect(() => {
    // Basic routing based on the '?f=' query parameter
    const params = new URLSearchParams(window.location.search);
    const fId = params.get('f');
    if (fId) {
      setFrameId(fId);
    }
  }, []);

  if (isTikTokInApp) {
    return <BrowserWarning />;
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
      <main className="container mx-auto px-4 py-8 max-w-2xl min-h-screen flex flex-col items-center justify-center">
        {frameId ? <FrameEditor id={frameId} /> : <Home user={user} />}
      </main>
    </div>
  );
}

export default App;
