'use strict';

const express = require('express');

module.exports = function registerCaptionRoutes({
    app, io,
    WhisperEngine, SherpaEngine, ASR_DATA_DIR,
    buildCaptionConfig,
    setWidgetCaptionSettings, setCaptionWidgetTextAppearance, getCaptionWidgetTextAppearance,
    getCaptionCorrectionRules, setCaptionCorrectionRules,
    handleCaptionText, isLoopbackRequest,
    getWhisperEngine, getSherpaEngine,
}) {
    app.get('/api/widgets/caption/config', (req, res) => {
        res.json(buildCaptionConfig());
    });

    app.get('/api/caption/correction-rules', (_req, res) => {
        res.json(getCaptionCorrectionRules());
    });

    app.post('/api/caption/correction-rules', express.json(), (req, res) => {
        if (!Array.isArray(req.body)) return res.status(400).json({ error: 'array required' });
        res.json(setCaptionCorrectionRules(req.body));
    });

    app.get('/api/widgets/caption/asr-status', (req, res) => {
        const w = getWhisperEngine() || new WhisperEngine(ASR_DATA_DIR);
        const s = getSherpaEngine() || new SherpaEngine(ASR_DATA_DIR);
        res.json({
            whisper: { binaryReady: w.isBinaryReady(), models: w.modelList() },
            sherpa: { moduleAvailable: s.isSherpaAvailable(), modelReady: s.isModelReady() },
        });
    });

    app.patch('/api/widgets/caption', (req, res) => {
        const settings = setWidgetCaptionSettings(req.body || {});
        const captionAppearance = req.body?.appearance
            ? setCaptionWidgetTextAppearance(req.body.appearance)
            : getCaptionWidgetTextAppearance();
        const whisperEngine = getWhisperEngine();
        const sherpaEngine = getSherpaEngine();
        if (whisperEngine) whisperEngine.noiseGateThreshold = settings.noiseGateThreshold;
        if (sherpaEngine) sherpaEngine.noiseGateThreshold = settings.noiseGateThreshold;
        io.emit('widgets:caption:config', buildCaptionConfig());
        res.json({ ok: true, settings, appearance: captionAppearance });
    });

    // Parakeet Python サブプロセスからのテキスト受信（loopback のみ許可）
    app.post('/api/widgets/caption/asr-text', (req, res) => {
        if (!isLoopbackRequest(req)) {
            return res.status(403).json({ ok: false, error: 'loopback only' });
        }
        const { text, isFinal = true, srcLang = 'ja' } = req.body || {};
        if (!text || typeof text !== 'string') {
            return res.status(400).json({ ok: false });
        }
        handleCaptionText(text.slice(0, 500), Boolean(isFinal), srcLang);
        res.json({ ok: true });
    });
};
