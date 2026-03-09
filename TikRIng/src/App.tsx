import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import FrameEditor from './pages/FrameEditor';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
        <main className="container mx-auto px-4 py-8 max-w-2xl min-h-screen flex flex-col items-center justify-center">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/f/:id" element={<FrameEditor />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
