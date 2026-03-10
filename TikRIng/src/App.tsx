import { useState, useEffect } from 'react';
import Home from './pages/Home';
import FrameEditor from './pages/FrameEditor';
import BrowserWarning from './components/BrowserWarning';

function App() {
  const [frameId, setFrameId] = useState<string | null>(null);

  useEffect(() => {
    // Basic routing based on the '?f=' query parameter
    const params = new URLSearchParams(window.location.search);
    const fId = params.get('f');
    if (fId) {
      setFrameId(fId);
    }
  }, []);

  return (
    <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
      <BrowserWarning />
      <main className="container mx-auto px-4 py-8 max-w-2xl min-h-screen flex flex-col items-center justify-center">
        {frameId ? <FrameEditor id={frameId} /> : <Home />}
      </main>
    </div>
  );
}

export default App;
