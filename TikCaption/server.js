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
  // TikTok基本
  { from: 'てぃっくとっく',             to: 'TikTok' },
  { from: 'てぃくとく',                 to: 'TikTok' },
  { from: 'てぃっくとっくらいぶ',       to: 'TikTok Live' },
  { from: 'てぃくとくらいぶ',           to: 'TikTok Live' },
  { from: 'てぃっくとっくゆにばーす',   to: 'TikTok Universe' },
  // フォロー・交流
  { from: 'ふぉろー',                   to: 'フォロー' },
  { from: 'ふぉろわー',                 to: 'フォロワー' },
  { from: 'らいく',                     to: 'ライク' },
  { from: 'しぇあ',                     to: 'シェア' },
  { from: 'こめんと',                   to: 'コメント' },
  { from: 'りすなー',                   to: 'リスナー' },
  { from: 'らいばー',                   to: 'ライバー' },
  { from: 'おし',                       to: '推し' },
  { from: 'おしまーく',                 to: '推しマーク' },
  { from: 'ふぁんま',                   to: 'ファンマ' },
  { from: 'いつめん',                   to: 'いつメン' },
  { from: 'がちぜい',                   to: 'ガチ勢' },
  { from: 'しょけん',                   to: '初見' },
  { from: 'しょけんさん',               to: '初見さん' },
  { from: 'じょうれん',                 to: '常連' },
  { from: 'ろむる',                     to: 'ロムる' },
  // 配信機能・システム
  { from: 'らいぶはいしん',             to: 'ライブ配信' },
  { from: 'はいしん',                   to: '配信' },
  { from: 'こらぼはいしん',             to: 'コラボ配信' },
  { from: 'こらぼ',                     to: 'コラボ' },
  { from: 'もでれーたー',               to: 'モデレーター' },
  { from: 'もで',                       to: 'モデ' },
  { from: 'さぶすく',                   to: 'サブスク' },
  { from: 'えもーと',                   to: 'エモート' },
  { from: 'ぴくちゃーいんぴくちゃー',   to: 'ピクチャーインピクチャー' },
  { from: 'でいりーらんきんぐ',         to: 'デイリーランキング' },
  { from: 'じかんたいらんきんぐ',       to: '時間帯ランキング' },
  { from: 'しゃどうばん',               to: 'シャドウバン' },
  { from: 'ぷろもーと',                 to: 'プロモート' },
  { from: 'ちーむめんばー',             to: 'チームメンバー' },
  { from: 'みゅーと',                   to: 'ミュート' },
  { from: 'ぜんがめん',                 to: '全画面' },
  { from: 'わく',                       to: '枠' },
  { from: 'たっぷ',                     to: 'タップ' },
  { from: 'ぶろ',                       to: 'ブロ' },
  { from: 'ぶろっく',                   to: 'ブロック' },
  { from: 'ばん',                       to: 'バン' },
  // ギフト・コイン
  { from: 'ぎふと',                     to: 'ギフト' },
  { from: 'ぎふとぎゃらりー',           to: 'ギフトギャラリー' },
  { from: 'ぎふぎゃら',                 to: 'ギフギャラ' },
  { from: 'おたのしみぶくろ',           to: 'お楽しみ袋' },
  { from: 'はーとみー',                 to: 'ハートミー' },
  { from: 'たからばこ',                 to: '宝箱' },
  { from: 'こいん',                     to: 'コイン' },
  { from: 'ないぎふ',                   to: 'ナイギフ' },
  { from: 'ないすぅ',                   to: 'ナイスゥ' },
  { from: 'おはなつみ',                 to: 'お花摘み' },
  { from: 'ぎふりあ',                   to: 'ギフリア' },
  { from: 'やみなげ',                   to: '闇投げ' },
  { from: 'わくなげ',                   to: '枠投げ' },
  { from: 'すらる',                     to: 'スラる' },
  { from: 'もぐる',                     to: '潜る' },
  // バトル・競技
  { from: 'がちばとる',                 to: 'ガチバトル' },
  { from: 'よやくばとる',               to: '予約バトル' },
  { from: 'すぴーどちゃれんじ',         to: 'スピードチャレンジ' },
  { from: 'すぴちゃれ',                 to: 'スピチャレ' },
  { from: 'まっちんぐ',                 to: 'マッチング' },
  { from: 'すこあ',                     to: 'スコア' },
  { from: 'れんしょう',                 to: '連勝' },
  { from: 'すとりーく',                 to: 'ストリーク' },
  { from: 'ひきわけ',                   to: '引き分け' },
  { from: 'ぴーけー',                   to: 'PK' },
  { from: 'えんちょうせん',             to: '延長戦' },
  // バトルアイテム
  { from: 'ぶーすてぃんぐぐろーぶ',     to: 'ブースティンググローブ' },
  { from: 'ぐろーぶ',                   to: 'グローブ' },
  { from: 'すたんはんまー',             to: 'スタンハンマー' },
  { from: 'まじっくみすと',             to: 'マジックミスト' },
  { from: 'みすと',                     to: 'ミスト' },
  { from: 'ふぁーすとぎふとみっしょん', to: 'ファーストギフトミッション' },
  { from: 'ふぁーすとぎふと',           to: 'ファーストギフト' },
  // ギフトアイテム名
  { from: 'ゆにば',                     to: 'ユニバ' },
  { from: 'らいおん',                   to: 'ライオン' },
  { from: 'れおんあんどらいおん',       to: 'レオンアンドライオン' },
  { from: 'ぜうす',                     to: 'ゼウス' },
  { from: 'いんたーすてらー',           to: 'インターステラー' },
  { from: 'どらごん',                   to: 'ドラゴン' },
  { from: 'おしろ',                     to: 'お城' },
  { from: 'ひこうせん',                 to: '飛行船' },
  { from: 'すぽーつかー',               to: 'スポーツカー' },
  { from: 'ばら',                       to: 'バラ' },
  { from: 'ろーず',                     to: 'ローズ' },
  { from: 'ゆびはーと',                 to: '指ハート' },
  { from: 'かみひこうき',               to: '紙飛行機' },
  { from: 'こるべっと',                 to: 'コルベット' },
  { from: 'かんらんしゃ',               to: '観覧車' },
  { from: 'めりーごーらんど',           to: 'メリーゴーランド' },
  { from: 'ぎたー',                     to: 'ギター' },
  { from: 'まいく',                     to: 'マイク' },
  { from: 'ぱんだ',                     to: 'パンダ' },
  { from: 'はなび',                     to: '花火' },
  { from: 'ながれぼし',                 to: '流れ星' },
  { from: 'わくせい',                   to: '惑星' },
  { from: 'ぎんが',                     to: '銀河' },
  { from: 'ゆにこーん',                 to: 'ユニコーン' },
  { from: 'まほうのらんぷ',             to: '魔法のランプ' },
  { from: 'おうかん',                   to: '王冠' },
  { from: 'てぃあら',                   to: 'ティアラ' },
  { from: 'とろふぃー',                 to: 'トロフィー' },
  { from: 'だいや',                     to: 'ダイヤ' },
  { from: 'きのこ',                     to: 'キノコ' },
  { from: 'さぶまりん',                 to: 'サブマリン' },
  { from: 'くるーざー',                 to: 'クルーザー' },
  { from: 'ぺがさす',                   to: 'ペガサス' },
  { from: 'ぱん',                       to: 'パン' },
  { from: 'ぶろっこりー',               to: 'ブロッコリー' },
  // 人名・配信者名
  { from: 'ぷりんすこうや',             to: 'プリンスこうや' },
  { from: 'ぷりんすこーや',             to: 'プリンスこうや' },
  { from: 'ぷりこう',                   to: 'プリこう' },
  { from: 'むげん',                     to: '夢幻' },
  { from: 'あつねぇ',                   to: '圧ねぇ' },
  { from: 'なつえここ',                 to: '夏絵ココ' },
  { from: 'たきこみごはん',             to: '炊き込みご飯' },
  { from: 'さとる',                     to: 'SATORU' },
  { from: 'きむら',                     to: 'KIMURA' },
  { from: 'でぃーじぇーふぉい',         to: 'DJふぉい' },
  { from: 'きんばえ',                   to: '金バエ' },
  { from: 'てぃーじぇー',               to: 'TJ' },
  { from: 'これこれ',                   to: 'コレコレ' },
  { from: 'いしかわのりゆき',           to: '石川典行' },
  { from: 'よこやまみどり',             to: '横山緑' },
  { from: 'のだぞうり',                 to: '野田草履' },
  { from: 'あしたのゆきのじょう',       to: 'あしたの雪之丞' },
  { from: 'ゆきのじょう',               to: 'ゆきのじょー' },
  { from: 'ぜろわん',                   to: 'ゼロワン' },
  { from: 'あたおかかいちょう',         to: 'ATAOKA会長' },
  { from: 'きんぐろ',                   to: '金グロ' },
  { from: 'ばらばしゃ',                 to: 'バラ馬車' },
  { from: 'いきりすと',                 to: 'イキリスト' },
  { from: 'あがりえ',                   to: 'あがりえ' },
  { from: 'かりーの',                   to: 'CARiNO' },
  { from: 'もぶまーと',                 to: 'MOBmart' },
  { from: 'とこなつまなつ',             to: '常夏真夏' },
  { from: 'とこなつ',                   to: '常夏' },
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

function hiraganaToKatakana(str) {
  return str.replace(/[ぁ-ゖ]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

class CaptionCorrector {
  constructor(rules) {
    this.rules = (rules || []).flatMap(rule => {
      if (!rule.from) return [rule];
      const kata = hiraganaToKatakana(rule.from);
      return kata !== rule.from ? [rule, { ...rule, from: kata }] : [rule];
    });
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
