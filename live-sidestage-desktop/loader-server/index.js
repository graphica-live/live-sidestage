'use strict';

const http = require('http');
const net = require('net');

const LOADER_PORT = 38099;
const BACKEND_PORT = 38100;

/**
 * バックエンド（ポート 38100）が TCP レベルで応答可能か確認する。
 * ローカル接続なので最大 200ms で判定できる。
 */
function isBackendUp(callback) {
    const socket = new net.Socket();
    socket.setTimeout(200);
    socket.once('connect', () => { socket.destroy(); callback(true); });
    socket.once('error',   () => { socket.destroy(); callback(false); });
    socket.once('timeout', () => { socket.destroy(); callback(false); });
    socket.connect(BACKEND_PORT, '127.0.0.1');
}

const POLLING_HTML = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<style>html,body{margin:0;padding:0;background:transparent;color:rgba(255,255,255,.45);font:11px sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}</style>
</head><body><div>起動待機中...</div><script>
(function(){
  var inFlight=false;
  function probe(){
    if(inFlight)return;inFlight=true;
    // 同一オリジン（ローダーサーバー 38099）に redirect:'manual' でリクエストする。
    // バックエンドが起動していれば 302 が返り type==='opaqueredirect' になる。
    // クロスポート fetch（→38100）と違い CORS 制約や Private Network Access の影響を受けない。
    var t=setTimeout(function(){inFlight=false;},5000);
    fetch(location.href,{cache:'no-store',redirect:'manual'})
      .then(function(r){clearTimeout(t);inFlight=false;if(r.type==='opaqueredirect')location.reload();})
      .catch(function(){clearTimeout(t);inFlight=false;});
  }
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')probe();});
  setInterval(probe,2000);
  probe();
})();
</script></body></html>`;

const server = http.createServer((req, res) => {
    isBackendUp((isUp) => {
        if (isUp) {
            // バックエンドが起動中 → 302 リダイレクト（JSなし・最速）
            const host = (req.headers.host || `127.0.0.1:${LOADER_PORT}`).split(':')[0];
            const target = `http://${host}:${BACKEND_PORT}${req.url}`;
            res.writeHead(302, { 'Location': target, 'Cache-Control': 'no-store' });
            res.end();
        } else {
            // バックエンド停止中 → ポーリング HTML を返す
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(POLLING_HTML);
        }
    });
});

server.listen(LOADER_PORT, '0.0.0.0', () => {
    console.log(`[loader-server] Listening on port ${LOADER_PORT}`);
});

server.on('error', (err) => {
    console.error('[loader-server] Error:', err.message);
});
