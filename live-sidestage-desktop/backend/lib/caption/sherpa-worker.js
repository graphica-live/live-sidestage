'use strict';
const { parentPort } = require('worker_threads');

let recognizer = null;

parentPort.on('message', (msg) => {
    if (msg.type === 'init') {
        const sherpa = require('sherpa-onnx');
        try {
            recognizer = sherpa.createOfflineRecognizer(msg.cfg);
            parentPort.postMessage({ type: 'ready', provider: 'directml' });
        } catch {
            msg.cfg.modelConfig.provider = 'cpu';
            recognizer = sherpa.createOfflineRecognizer(msg.cfg);
            parentPort.postMessage({ type: 'ready', provider: 'cpu' });
        }
    } else if (msg.type === 'decode') {
        if (!recognizer) { parentPort.postMessage({ type: 'silence' }); return; }
        const i16 = new Int16Array(msg.buf);
        const f32 = new Float32Array(i16.length);
        let rms = 0;
        for (let i = 0; i < i16.length; i++) {
            f32[i] = i16[i] / 32768;
            rms += f32[i] * f32[i];
        }
        rms = Math.sqrt(rms / (i16.length || 1));
        if (rms < msg.threshold) { parentPort.postMessage({ type: 'silence' }); return; }
        try {
            const stream = recognizer.createStream();
            stream.acceptWaveform(16000, f32);
            recognizer.decode(stream);
            const text = (recognizer.getResult(stream)?.text || '').trim();
            parentPort.postMessage({ type: 'result', text });
        } catch (e) {
            parentPort.postMessage({ type: 'error', message: e.message });
        }
    }
});
