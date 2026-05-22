'use strict';
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

// sherpa-onnx nemo parakeet TDT-CTC-0.6b-ja INT8 quantised model
const MODEL_INFO = {
    name:    'sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8',
    archive: 'sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8.tar.bz2',
    url:     'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8.tar.bz2',
    size:    670000000,  // ~640 MB
    onnxFile:   'model.int8.onnx',
    tokensFile: 'tokens.txt',
};

class SherpaEngine extends EventEmitter {
    constructor(dataDir) {
        super();
        this.dataDir  = dataDir;
        this.modelDir = path.join(dataDir, 'sherpa-models', MODEL_INFO.name);
        this._recognizer = null;
        this._audioBufs  = [];
        this._running    = false;
        this._timer      = null;
        this._busy       = false;
        this.SAMPLE_RATE = 16000;
        this.noiseGateThreshold = 0.003;
    }

    // ── Status helpers ──────────────────────────────────────────────────────

    isModelReady() {
        return fs.existsSync(path.join(this.modelDir, MODEL_INFO.onnxFile))
            && fs.existsSync(path.join(this.modelDir, MODEL_INFO.tokensFile));
    }

    isSherpaAvailable() {
        try { require.resolve('sherpa-onnx'); return true; } catch { return false; }
    }

    // ── Initialise (download if needed, load model) ─────────────────────────

    async init() {
        if (!this.isSherpaAvailable()) {
            await this._installSherpa();
        }
        if (!this.isModelReady()) await this._downloadModel();

        this.emit('status', 'Parakeet モデルを読み込み中...');

        const sherpa = require('sherpa-onnx');
        const onnxPath   = path.join(this.modelDir, MODEL_INFO.onnxFile);
        const tokensPath = path.join(this.modelDir, MODEL_INFO.tokensFile);
        const cfg = {
            modelConfig: {
                tokens: tokensPath,
                nemoCtc: { model: onnxPath },
                numThreads: 4,
                provider: 'directml',   // GPU on Windows (NVIDIA / AMD / Intel)
                debug: 0,
            },
            decodingConfig: { method: 'greedy_search' },
        };

        try {
            this._recognizer = sherpa.createOfflineRecognizer(cfg);
            this.emit('status', 'Parakeet 準備完了（DirectML）');
        } catch {
            // DirectML unavailable – fall back to CPU
            cfg.modelConfig.provider = 'cpu';
            this._recognizer = sherpa.createOfflineRecognizer(cfg);
            this.emit('status', 'Parakeet 準備完了（CPU）');
        }
    }

    // ── Start / Stop audio streaming ────────────────────────────────────────

    start() {
        if (this._timer) clearInterval(this._timer);
        this._running   = true;
        this._audioBufs = [];
        this._busy      = false;
        this._timer     = setInterval(() => this._flush(), 4000);
    }

    stop() {
        this._running = false;
        clearInterval(this._timer);
        this._timer      = null;
        this._audioBufs  = [];
        this._busy       = false;
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
        const pcm    = Buffer.concat(chunks);

        // Convert Int16 to Float32 and check silence
        const i16  = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
        const f32  = new Float32Array(i16.length);
        let rms = 0;
        for (let i = 0; i < i16.length; i++) {
            f32[i] = i16[i] / 32768.0;
            rms += f32[i] * f32[i];
        }
        rms = Math.sqrt(rms / (i16.length || 1));
        if (rms < this.noiseGateThreshold) return;

        this._busy = true;
        try {
            // Run synchronous decode on next event-loop tick to avoid blocking
            const text = await new Promise(resolve => setImmediate(() => {
                try {
                    const stream = this._recognizer.createStream();
                    stream.acceptWaveform(this.SAMPLE_RATE, f32);
                    this._recognizer.decode(stream);
                    const result = this._recognizer.getResult(stream);
                    resolve((result?.text || '').trim());
                } catch { resolve(''); }
            }));
            if (text) this.emit('transcript', { text, isFinal: true });
        } finally {
            this._busy = false;
        }
    }

    // ── Private: npm install sherpa-onnx ────────────────────────────────────

    _installSherpa() {
        return new Promise((resolve, reject) => {
            this.emit('status', 'sherpa-onnx をインストール中...');
            const projectRoot = path.resolve(__dirname, '../../../');
            const proc = spawn('npm', ['install', 'sherpa-onnx'], {
                cwd: projectRoot,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: true,
            });
            proc.stdout.on('data', d => this.emit('status', d.toString().trim().slice(0, 120)));
            proc.stderr.on('data', d => this.emit('status', d.toString().trim().slice(0, 120)));
            proc.on('close', code => {
                if (code !== 0) return reject(new Error(`npm install sherpa-onnx exit ${code}`));
                // Bust require cache so the newly installed module is found
                try { delete require.cache[require.resolve('sherpa-onnx')]; } catch {}
                resolve();
            });
            proc.on('error', reject);
        });
    }

    // ── Private: model download ──────────────────────────────────────────────

    async _downloadModel() {
        const baseDir    = path.join(this.dataDir, 'sherpa-models');
        const archivePath = path.join(baseDir, MODEL_INFO.archive);
        fs.mkdirSync(baseDir, { recursive: true });

        this.emit('status', 'Parakeet モデルをダウンロード中... (初回のみ、約640MB)');
        await this._downloadFile(MODEL_INFO.url, archivePath, (r, t) => {
            this.emit('download-progress', { pct: Math.round(r / t * 100), label: 'Parakeetモデル', received: r, total: t });
        });

        this.emit('status', 'モデルを展開中...');
        await this._extractTarBz2(archivePath, baseDir);
        try { fs.unlinkSync(archivePath); } catch {}
        this.emit('status', 'Parakeet モデル展開完了');
    }

    async _downloadFile(url, dest, onProgress) {
        const resp = await fetch(url, { headers: { 'User-Agent': 'TikEffect-ASR/1.0' } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText} (${url})`);

        const total  = parseInt(resp.headers.get('content-length') || '0', 10);
        let received = 0;
        const file   = fs.createWriteStream(dest);

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

    _extractTarBz2(archivePath, destDir) {
        return new Promise((resolve, reject) => {
            // Windows 10+ ships a built-in tar that handles .tar.bz2
            const proc = spawn('tar', ['-xjf', archivePath, '-C', destDir], { stdio: 'pipe' });
            proc.on('close', code => (code === 0 ? resolve() : reject(new Error(`tar exit ${code}`))));
            proc.on('error', reject);
        });
    }
}

module.exports = { SherpaEngine };
