/**
 * Playwright用の最小限テストサーバー。
 * backend/public の静的ファイルを配信し、socket.io をスタブ化する。
 * TikTok接続・DB不要。ウィジェットを ?preview=1 で起動するだけ。
 */
const express = require('express');
const path = require('path');

const PORT = process.env.TEST_SERVER_PORT || 38199;
const app = express();

// ヘルスチェック用エンドポイント（Playwright webServer の起動確認に使用）
app.get('/health', (req, res) => res.send('ok'));

// socket.io スタブ（イベントを受け取らないが on/emit は動く）
app.get('/socket.io/socket.io.js', (req, res) => {
    res.type('js').send(`
        window.io = function(url, opts) {
            var handlers = {};
            var self = {
                on: function(event, fn) { handlers[event] = fn; return self; },
                once: function(event, fn) { handlers[event] = fn; return self; },
                off: function(event) { delete handlers[event]; return self; },
                emit: function() { return self; },
                disconnect: function() {},
                connected: false
            };
            // 'connect_error' は発火させないのでウィジェット側でsampleModeに入る
            return self;
        };
    `);
});

// ── Admin ページ用 API スタブ ──────────────────────────────────────────────────

const MOCK_COMMENT_SETTINGS = {
    readAloudEnabled: true,
    readAloudVoiceName: '',
    readAloudVoiceCreditEnabled: true,
    readAloudRandomVoiceEnabled: true,
    readAloudVolume: 100,
    readAloudSpeed: 1.0,
    readAloudFilters: [],
    readAloudVoiceMappings: [],
    readAloudTextReplacements: [],
    readAloudEmojiReplacements: [],
    readAloudEmoteReplacements: [],
    readAloudAudioOutput: 'overlay1',
};

app.get('/api/state', (req, res) => res.json({ connected: false, streamTitle: '', uniqueId: '' }));
app.get('/api/comments/config', (req, res) => res.json({ settings: MOCK_COMMENT_SETTINGS }));
app.get('/api/comments/read-aloud-voices', (req, res) => res.json({ voices: [] }));
app.get('/api/effects/global-pause', (req, res) => res.json({ paused: false }));
app.get('/api/users/recent', (req, res) => res.json({ users: [] }));

// ── backend/public を静的配信 ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../../backend/public')));

app.listen(PORT, () => {
    // Playwright の webServer.stdout が "ready" を検出するまで待機
    process.stdout.write(`Test server ready on http://localhost:${PORT}\n`);
});
