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
  autoStartCaption: false,
  launchOnBoot: false,
};

const TIKTOK_BUILTIN_VOCAB = [
  { from: 'てぃっくとっく',        to: 'TikTok' },
  { from: 'てぃくとく',            to: 'TikTok' },
  { from: 'てぃっくとっくらいぶ',  to: 'TikTok Live' },
  { from: 'てぃくとくらいぶ',      to: 'TikTok Live' },
  { from: 'ふぉろー',              to: 'フォロー' },
  { from: 'ふぉろわー',            to: 'フォロワー' },
  { from: 'らいぶはいしん',        to: 'ライブ配信' },
  { from: 'ぎふと',                to: 'ギフト' },
  { from: 'こめんと',              to: 'コメント' },
  { from: 'すきー',                to: 'スキー' },
  { from: 'らいく',                to: 'ライク' },
  { from: 'しぇあ',                to: 'シェア' },
];

const GOOGLE_LANG_MAP = {
  en: 'en',
  zh: 'zh-CN',
  ko: 'ko',
  fr: 'fr',
  de: 'de',
  es: 'es',
  pt: 'pt',
  it: 'it',
  ru: 'ru',
  ar: 'ar',
  th: 'th',
  vi: 'vi',
  id: 'id',
  nl: 'nl',
  tr: 'tr',
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
      const escaped = rule.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), rule.to || '');
    }
    return result;
  }
}

async function translateWithGoogle(text, srcLang, targetLang) {
  const tl = GOOGLE_LANG_MAP[targetLang] || targetLang;
  const sl = srcLang || 'ja';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const data = await resp.json();
  return data[0]?.map(chunk => chunk[0]).filter(Boolean).join('') || null;
}

async function handleCaptionText(text, isFinal, srcLang) {
  const settings = loadSettings();
  let corrected = new CaptionCorrector(TIKTOK_BUILTIN_VOCAB).apply(text);
  corrected = new CaptionCorrector(settings.correctionRules).apply(corrected);

  io.emit('caption:updated', {
    original: corrected,
    translated: null,
    isFinal,
    settings,
  });

  if (settings.translationEnabled && isFinal && corrected.trim()) {
    try {
      const translated = await translateWithGoogle(corrected, srcLang || 'ja', settings.targetLang);
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
