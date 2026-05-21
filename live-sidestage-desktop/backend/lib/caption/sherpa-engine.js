'use strict';
const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');
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
            throw new Error('sherpa-onnx モジュールが見つかりません。npm install sherpa-onnx を実行してください。');
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
            this._recognizer = new sherpa.OfflineRecognizer(cfg);
            this.emit('status', 'Parakeet 準備完了（DirectML）');
        } catch {
            // DirectML unavailable – fall back to CPU
            cfg.modelConfig.provider = 'cpu';
            this._recognizer = new sherpa.OfflineRecognizer(cfg);
            this.emit('status', 'Parakeet 準備完了（CPU）');
        }
    }

    // ── Start / Stop audio streaming ────────────────────────────────────────

    start() {
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
        if (rms < 0.003) return;

        this._busy = true;
        try {
            // Run synchronous decode on next event-loop tick to avoid blocking
            const text = await new Promise(resolve => setImmediate(() => {
                try {
                    const stream = this._recognizer.createStream();
                    stream.acceptWaveform(this.SAMPLE_RATE, f32);
                    this._recognizer.decode(stream);
                    const result = stream.getResult();
                    resolve((result?.text || '').trim());
                } catch { resolve(''); }
            }));
            if (text) this.emit('transcript', { text, isFinal: true });
        } finally {
            this._busy = false;
        }
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

    _downloadFile(url, dest, onProgress) {
        return new Promise((resolve, reject) => {
            const proto = url.startsWith('https') ? https : http;
            proto.get(url, { headers: { 'User-Agent': 'TikEffect-ASR/1.0' } }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return this._downloadFile(res.headers.location, dest, onProgress).then(resolve).catch(reject);
                }
                if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
                const total    = parseInt(res.headers['content-length'] || '0', 10);
                let received   = 0;
                const file     = fs.createWriteStream(dest);
                res.on('data', chunk => {
                    received += chunk.length;
                    if (onProgress && total > 0) onProgress(received, total);
                });
                res.pipe(file);
                file.on('finish', () => file.close(resolve));
                file.on('error', err => { try { fs.unlinkSync(dest); } catch {} reject(err); });
            }).on('error', err => { try { fs.unlinkSync(dest); } catch {} reject(err); });
        });
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
