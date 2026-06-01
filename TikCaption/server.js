'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// シンプル JSON ストア（electron-store v10 が ESM-only のため代替）
const SETTINGS_PATH = path.join(os.homedir(), '.tikcaption-settings.json');
let _settings = null;

function loadSettings() {
  if (_settings) return { ..._settings };
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    _settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (_) {
    _settings = { ...DEFAULT_SETTINGS };
  }
  return { ..._settings };
}

function saveSettings(data) {
  if (!_settings) loadSettings();
  for (const [key, val] of Object.entries(data)) {
    if (key in DEFAULT_SETTINGS) _settings[key] = val;
  }
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(_settings, null, 2), 'utf8');
}

let translatePipelines = {};

const DEFAULT_SETTINGS = {
  deviceId: '',
  noiseGateThreshold: 0.2,
  showOriginal: true,
  translationEnabled: false,
  targetLang: 'en',
  fontSize: 52,
  verticalOffset: 120,
  segmentDuration: 6,
  maxCharsPerSegment: 20,
  charsPerSec: 12,
  showInterim: false,
  bgStyle: 'transparent',
  fontFamily: 'M PLUS Rounded 1c',
  textStyleKey: 'gold-night',
  strokeWidth: 6,
  vadThreshold: 0.5,
  vadSilenceMs: 800,
  vadMinSpeechMs: 500,
  vadPaddingMs: 200,
  correctionRules: [],
};

const TRANSLATION_MODELS = {
  en: 'Xenova/opus-mt-ja-en',
  zh: 'Xenova/opus-mt-ja-zh',
  ko: 'Xenova/opus-mt-ja-ko',
  fr: 'Xenova/opus-mt-ja-fr',
  de: 'Xenova/opus-mt-ja-de',
};

function getIO() {
  return io;
}

class CaptionCorrector {
  constructor(rules) {
    this.rules = rules || [];
  }

  apply(text) {
    let result = text;
    for (const rule of this.rules) {
      if (!rule.from) continue;
      if (rule.useRegex) {
        try {
          const re = new RegExp(rule.from, rule.flags || 'g');
          result = result.replace(re, rule.to || '');
        } catch (e) {
          // invalid regex — skip
        }
      } else {
        const escaped = rule.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'g'), rule.to || '');
      }
    }
    return result;
  }
}

async function translateWithXenova(text, targetLang) {
  const modelId = TRANSLATION_MODELS[targetLang];
  if (!modelId) return null;

  if (!translatePipelines[targetLang]) {
    const { pipeline } = await import('@xenova/transformers');
    translatePipelines[targetLang] = await pipeline('translation', modelId);
  }

  const pipe = translatePipelines[targetLang];
  const result = await pipe(text, { max_new_tokens: 256 });
  return result[0]?.translation_text || null;
}

async function handleCaptionText(text, isFinal, srcLang) {
  const settings = loadSettings();
  const corrector = new CaptionCorrector(settings.correctionRules);
  const corrected = corrector.apply(text);

  io.emit('caption:updated', {
    original: corrected,
    translated: null,
    isFinal,
    settings,
  });

  if (settings.translationEnabled && isFinal && corrected.trim()) {
    try {
      const translated = await translateWithXenova(corrected, settings.targetLang);
      if (translated) {
        io.emit('caption:translation', { translated });
      }
    } catch (e) {
      console.error('Translation error:', e.message);
    }
  }
}

// POST /api/caption/asr-text — loopback only
app.post('/api/caption/asr-text', (req, res) => {
  const addr = req.socket.remoteAddress;
  if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') {
    return res.status(403).json({ error: 'forbidden' });
  }
  const { text, isFinal, srcLang } = req.body;
  if (typeof text === 'string') {
    handleCaptionText(text, !!isFinal, srcLang || 'ja').catch(() => {});
  }
  res.json({ ok: true });
});

// GET /api/caption/config
app.get('/api/caption/config', (req, res) => {
  res.json(loadSettings());
});

// PATCH /api/caption/config
app.patch('/api/caption/config', (req, res) => {
  saveSettings(req.body);
  io.emit('caption:config', loadSettings());
  res.json(loadSettings());
});

io.on('connection', (socket) => {
  socket.emit('caption:config', loadSettings());
});

function startServer(port) {
  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

module.exports = { loadSettings, saveSettings, getIO, handleCaptionText, startServer, CaptionCorrector, app, DEFAULT_SETTINGS };
