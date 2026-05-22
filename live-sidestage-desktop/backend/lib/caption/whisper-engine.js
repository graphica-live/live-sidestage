'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const WHISPER_MODELS = {
    small:  { name: 'ggml-small.bin',  size: 244000000, label: 'Small  (~244MB)' },
    medium: { name: 'ggml-medium.bin', size: 769000000, label: 'Medium (~769MB)' },
    large:  { name: 'ggml-large-v3-turbo.bin', size: 874000000, label: 'Large-v3-turbo (~874MB)' },
};

// HuggingFace model URLs (ggerganov/whisper.cpp repo)
const HF_BASE = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const MODEL_URLS = {
    small:  HF_BASE + 'ggml-small.bin',
    medium: HF_BASE + 'ggml-medium.bin',
    large:  HF_BASE + 'ggml-large-v3-turbo.bin',
};

class WhisperEngine extends EventEmitter {
    constructor(dataDir) {
        super();
        this.dataDir  = dataDir;
        this.binDir   = path.join(dataDir, 'whisper-bin');
        this.modelDir = path.join(dataDir, 'whisper-models');
        this._mainExe = null;
        this._modelKey = 'medium';
        this._audioBufs = [];
        this._running = false;
        this._timer = null;
        this._busy = false;
        this.noiseGateThreshold = 0.015;
    }

    // ── Status helpers ──────────────────────────────────────────────────────

    isBinaryReady() {
        return this._findExe(this.binDir) !== null;
    }

    isModelReady(key) {
        const m = WHISPER_MODELS[key];
        return m ? fs.existsSync(path.join(this.modelDir, m.name)) : false;
    }

    modelList() {
        return Object.entries(WHISPER_MODELS).map(([key, m]) => ({
            key,
            label: m.label,
            ready: this.isModelReady(key),
        }));
    }

    // ── Initialise (download if needed) ────────────────────────────────────

    async init(modelKey = 'medium') {
        this._modelKey = modelKey;
        if (!this.isBinaryReady()) await this._downloadBinary();
        if (!this.isModelReady(modelKey)) await this._downloadModel(modelKey);
        this._mainExe = this._findExe(this.binDir);
        if (!this._mainExe) {
            throw new Error(`実行ファイルが見つかりません (${this.binDir})。フォルダを確認してください。`);
        }
        // Probe the exe — CUDA builds fail with 0xC0000135 (STATUS_DLL_NOT_FOUND) when
        // CUDA runtime is not installed. Auto-retry with a CPU-only build.
        const probeOk = await this._probeExe(this._mainExe);
        if (!probeOk) {
            this.emit('status', 'DLL エラー検出（CUDA未インストール）— CPU ビルドで再取得中...');
            try { fs.rmSync(this.binDir, { recursive: true, force: true }); } catch {}
            await this._downloadBinary(true);
            this._mainExe = this._findExe(this.binDir);
            if (!this._mainExe) throw new Error('CPU ビルド取得後も実行ファイルが見つかりません。');
        }
        this.emit('status', `Whisper 準備完了（${path.basename(this._mainExe)}）`);
    }

    // ── Start / Stop audio streaming ────────────────────────────────────────

    start() {
        if (this._timer) clearInterval(this._timer); // guard against double-start
        this._running = true;
        this._audioBufs = [];
        this._busy = false;
        this._timer = setInterval(() => this._flush(), 2000);
    }

    stop() {
        this._running = false;
        clearInterval(this._timer);
        this._timer = null;
        this._audioBufs = [];
        this._busy = false;
    }

    // Receives Int16 PCM at 16 kHz from the browser
    feedAudio(buf) {
        if (!this._running) return;
        this._audioBufs.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    }

    // ── Private: flush & transcribe ─────────────────────────────────────────

    async _flush() {
        if (!this._running || this._audioBufs.length === 0 || this._busy) return;

        const chunks = this._audioBufs.splice(0);
        const pcm = Buffer.concat(chunks);

        // Silence gate — 0.015 prevents noise hallucination (whisper outputs English junk on near-silence)
        const i16 = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
        let rms = 0;
        for (let i = 0; i < i16.length; i++) rms += (i16[i] / 32768) ** 2;
        rms = Math.sqrt(rms / (i16.length || 1));
        this.emit('status', `認識中... (RMS ${rms.toFixed(4)})`);
        if (rms < this.noiseGateThreshold) return;

        this._busy = true;
        const t0 = Date.now();
        this.emit('status', `Whisper 処理中... (${(pcm.length / 32000).toFixed(1)}s 音声)`);
        this.emit('interim', '...');
        try {
            const { text, dbg } = await this._transcribe(pcm);
            const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
            if (text) {
                this.emit('status', `認識完了 (${elapsed}s): ${text.slice(0, 40)}`);
                this.emit('transcript', { text, isFinal: true });
            } else {
                this.emit('status', `認識結果なし (${elapsed}s) ${dbg || ''}`);
            }
        } catch (e) {
            this.emit('error', `認識エラー: ${e.message}`);
        } finally {
            this._busy = false;
        }
    }

    async _transcribe(pcmBuf) {
        const wavPath = path.join(os.tmpdir(), `caption_${Date.now()}.wav`);

        this._writePcmWav(wavPath, pcmBuf, 16000);

        const modelPath = path.join(this.modelDir, WHISPER_MODELS[this._modelKey].name);
        const exeDir    = path.dirname(this._mainExe);

        return new Promise((resolve, reject) => {
            // No -oj/-of: capture plain-text stdout, strip timestamps
            const proc = spawn(this._mainExe, [
                '-m', modelPath,
                '-f', wavPath,
                '--language', 'ja',
                '--threads', '4',
            ], { cwd: exeDir, stdio: ['ignore', 'pipe', 'pipe'] });

            let stdoutBuf = '';
            let stderrBuf = '';
            proc.stdout.on('data', d => { stdoutBuf += d.toString(); });
            proc.stderr.on('data', d => { stderrBuf += d.toString(); });

            proc.on('close', (code) => {
                try { fs.unlinkSync(wavPath); } catch {}
                if (code !== 0) {
                    const combined = (stderrBuf + stdoutBuf).trim();
                    const detail = combined.split('\n').at(-1)?.slice(0, 300) || `code ${code}`;
                    this.emit('status', `whisper stderr: ${combined.slice(0, 400) || '(empty)'}`);
                    return reject(new Error(`whisper exit ${code}: ${detail}`));
                }
                const extractText = (buf) => buf
                    .replace(/\x1b\[[0-9;]*m/g, '')
                    .split('\n')
                    .filter(l => /^\s*\[[\d:.,\s>-]+\]/.test(l))
                    .map(l => l.replace(/^\s*\[[\d:.,\s>-]+\]\s*/, '').trim())
                    .filter(l => l && l !== '[BLANK_AUDIO]' && l !== '[ BLANK_AUDIO ]')
                    .join('');
                // whisper-cli may write transcript to stdout or stderr depending on build
                const text = extractText(stdoutBuf) || extractText(stderrBuf);
                if (!text) {
                    const dbg = `stdout:「${stdoutBuf.slice(0, 100)}」stderr:「${stderrBuf.slice(0, 100)}」`;
                    return resolve({ text: null, dbg });
                }
                resolve({ text, dbg: null });
            });
            proc.on('error', (e) => {
                try { fs.unlinkSync(wavPath); } catch {}
                reject(e);
            });
        });
    }

    _writePcmWav(wavPath, pcmBuf, sr) {
        const nCh   = 1;
        const bps   = 16;
        const dSize = pcmBuf.length;
        const buf   = Buffer.allocUnsafe(44 + dSize);
        buf.write('RIFF', 0, 'ascii');
        buf.writeUInt32LE(36 + dSize, 4);
        buf.write('WAVE', 8, 'ascii');
        buf.write('fmt ', 12, 'ascii');
        buf.writeUInt32LE(16, 16);
        buf.writeUInt16LE(1, 20);
        buf.writeUInt16LE(nCh, 22);
        buf.writeUInt32LE(sr, 24);
        buf.writeUInt32LE(sr * nCh * (bps >> 3), 28);
        buf.writeUInt16LE(nCh * (bps >> 3), 32);
        buf.writeUInt16LE(bps, 34);
        buf.write('data', 36, 'ascii');
        buf.writeUInt32LE(dSize, 40);
        pcmBuf.copy(buf, 44);
        fs.writeFileSync(wavPath, buf);
    }

    // ── Private: binary download ─────────────────────────────────────────────

    async _downloadBinary(cpuOnly = false) {
        this.emit('status', 'GitHub から Whisper バイナリ情報を取得中...');

        let assetUrl, assetName;
        try {
            const info = await this._fetchJson('https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest');
            const assets = info.assets || [];
            let asset;
            if (!cpuOnly) {
                // Try CUDA/cublas build first (requires CUDA runtime on target machine)
                asset = assets.find(a => /cublas.*bin.*x64/i.test(a.name) && a.name.endsWith('.zip'));
            }
            // CPU-only: prefer non-CUDA x64 build (self-contained, no runtime deps)
            if (!asset) asset = assets.find(a => /bin.*x64/i.test(a.name) && !/cublas/i.test(a.name) && a.name.endsWith('.zip'));
            // Last resort: any x64 zip
            if (!asset) asset = assets.find(a => /bin.*x64/i.test(a.name) && a.name.endsWith('.zip'));
            if (!asset) throw new Error('x64 ビルドが見つかりません');
            assetUrl  = asset.browser_download_url;
            assetName = asset.name;
        } catch (e) {
            throw new Error(`バイナリ取得失敗: ${e.message}`);
        }

        fs.mkdirSync(this.binDir, { recursive: true });
        const zipPath = path.join(this.binDir, 'whisper-bin.zip');

        this.emit('status', `バイナリをダウンロード中... (${assetName})`);
        await this._downloadFile(assetUrl, zipPath, (r, t) => {
            this.emit('download-progress', { pct: Math.round(r / t * 100), label: 'バイナリ', received: r, total: t });
        });

        this.emit('status', '展開中...');
        await this._extractZip(zipPath, this.binDir);
        try { fs.unlinkSync(zipPath); } catch {}
        this.emit('status', 'バイナリ展開完了');
    }

    async _downloadModel(key) {
        const m = WHISPER_MODELS[key];
        fs.mkdirSync(this.modelDir, { recursive: true });
        const dest = path.join(this.modelDir, m.name);

        this.emit('status', `モデルをダウンロード中... (${m.name}, ${m.label})`);
        await this._downloadFile(MODEL_URLS[key], dest, (r, t) => {
            this.emit('download-progress', { pct: Math.round(r / t * 100), label: 'モデル', received: r, total: t });
        });
        this.emit('status', 'モデルダウンロード完了');
    }

    // ── Private: network helpers (use global fetch, available in Node 18+) ────

    async _fetchJson(url) {
        const ctrl  = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        try {
            const resp = await fetch(url, {
                headers: { 'User-Agent': 'TikEffect-ASR/1.0', Accept: 'application/json' },
                signal: ctrl.signal,
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
            return resp.json();
        } finally {
            clearTimeout(timer);
        }
    }

    async _downloadFile(url, dest, onProgress) {
        const resp = await fetch(url, {
            headers: { 'User-Agent': 'TikEffect-ASR/1.0' },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} (${url})`);

        const total    = parseInt(resp.headers.get('content-length') || '0', 10);
        let received   = 0;
        const file     = fs.createWriteStream(dest);

        try {
            for await (const chunk of resp.body) {
                received += chunk.length;
                if (!file.write(chunk)) await new Promise(r => file.once('drain', r));
                if (onProgress && total > 0) onProgress(received, total);
            }
            await new Promise((res, rej) => { file.end(); file.on('finish', res); file.on('error', rej); });
        } catch (err) {
            file.destroy();
            try { fs.unlinkSync(dest); } catch {}
            throw err;
        }
    }

    _extractZip(zipPath, destDir) {
        return new Promise((resolve, reject) => {
            const proc = spawn('powershell', [
                '-Command',
                `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
            ], { stdio: 'pipe' });
            proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`Expand-Archive exit ${code}`))));
            proc.on('error', reject);
        });
    }

    _probeExe(exe) {
        // Quick sanity-test: Windows NTSTATUS >= 0xC0000000 means fatal DLL/crash error
        return new Promise(resolve => {
            const p = spawn(exe, ['--help'], {
                stdio: 'ignore',
                cwd: path.dirname(exe),
                timeout: 6000,
            });
            p.on('close', code => {
                const ntError = typeof code === 'number' && (code >>> 0) >= 0xC0000000;
                resolve(!ntError);
            });
            p.on('error', () => resolve(false));
        });
    }

    _findExe(dir) {
        if (!fs.existsSync(dir)) return null;
        // whisper.cpp renamed main → whisper-cli in late 2024; prefer new name
        const PRIORITY = ['whisper-cli.exe', 'main.exe'];
        const entries = fs.readdirSync(dir);
        const subdirs = [];
        const found = new Map();
        for (const entry of entries) {
            const p = path.join(dir, entry);
            try {
                const stat = fs.statSync(p);
                if (stat.isDirectory()) subdirs.push(p);
                else if (PRIORITY.includes(entry)) found.set(entry, p);
            } catch {}
        }
        for (const name of PRIORITY) {
            if (found.has(name)) return found.get(name);
        }
        for (const sub of subdirs) {
            const r = this._findExe(sub);
            if (r) return r;
        }
        return null;
    }
}

module.exports = { WhisperEngine, WHISPER_MODELS };
