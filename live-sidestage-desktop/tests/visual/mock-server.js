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

// backend/public を静的配信
app.use(express.static(path.join(__dirname, '../../backend/public')));

app.listen(PORT, () => {
    // Playwright の webServer.stdout が "ready" を検出するまで待機
    process.stdout.write(`Test server ready on http://localhost:${PORT}\n`);
});
