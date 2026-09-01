const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");

const dev = process.env.NODE_ENV !== "production";
const port = process.env.PORT || 3000;

// src/lib/canonical-origin.ts の isAllowedHost() は allowlist が空(*_ORIGIN が
// 1つも設定されていない)なら host 検証そのものをスキップする——ローカル開発を
// 単一オリジンのまま動かすためのフォールバックだが、本番で設定を1つでも
// 落とすと AUTH_TRUST_HOST=1 が転送 Host を無条件に信頼する状態になる。
// TSモジュールを require できないためチェックはここに複製する。
if (!dev) {
  const REQUIRED_ORIGIN_ENV_VARS = [
    "ANALYTICS_ORIGIN",
    "EVENTS_ORIGIN",
    "AGENCY_ORIGIN",
    "OVERLAYS_ORIGIN",
    "API_ORIGIN",
  ];
  const missing = REQUIRED_ORIGIN_ENV_VARS.filter((key) => {
    const value = process.env[key];
    if (!value) return true;
    try {
      return new URL(value).protocol !== "https:";
    } catch {
      return true;
    }
  });
  if (missing.length > 0) {
    console.error(
      `[startup] 本番起動には https:// の *_ORIGIN が5つとも必要です。未設定/不正な値: ${missing.join(", ")}`
    );
    process.exit(1);
  }
}

// *.livesidestage.com はワイルドカードcustom domainのため、DNS上は
// 任意のサブドメインがこのサービスへ到達しうる。ここでHostをallowlistへ
// 厳密一致させ、未知サブドメインは421で拒否する(デフォルト画面へは絶対に
// フォールバックしない)。`.endsWith(".livesidestage.com")` 方式は使わない。
const PUBLIC_ORIGIN_ENV_VARS = [
  "ANALYTICS_ORIGIN",
  "EVENTS_ORIGIN",
  "AGENCY_ORIGIN",
  "OVERLAYS_ORIGIN",
  "API_ORIGIN",
];

function buildAllowedHosts() {
  const hosts = new Set();
  for (const key of PUBLIC_ORIGIN_ENV_VARS) {
    const value = process.env[key];
    if (!value) continue;
    try {
      hosts.add(new URL(value).host.toLowerCase());
    } catch {
      // 起動時チェック(上のREQUIRED_ORIGIN_ENV_VARS)で既に弾かれているはず
    }
  }
  return hosts;
}

// ローカル開発はallowlistを無効化(単一オリジンのまま動かす)。本番のみ強制。
const ALLOWED_HOSTS = dev ? null : buildAllowedHosts();

// Worker(worker.js)からWeb(server.js)への内部通信は Railway private network
// 経由のみを許可する。host名だけの前方一致だとポートを詐称されうるため、
// host:port の完全一致で判定する(このプロセス自身がlistenするportと揃える)。
const PRIVATE_DOMAIN = (process.env.RAILWAY_PRIVATE_DOMAIN || "").toLowerCase();
const PRIVATE_HOST_PORT = PRIVATE_DOMAIN ? `${PRIVATE_DOMAIN}:${port}` : "";

function isAllowedRequestHost(req) {
  if (!ALLOWED_HOSTS) return true; // dev

  // 重複Hostヘッダはリクエストスマグリング/authority混乱の典型的な手口。
  // 1つに定まらない時点で拒否する。
  const distinctHosts = req.headersDistinct?.host;
  if (distinctHosts && distinctHosts.length > 1) return false;

  const raw = req.headers.host || "";
  const host = String(raw).trim().toLowerCase().replace(/\.$/, "");
  if (!host) return false;

  if (ALLOWED_HOSTS.has(host)) return true;
  if (PRIVATE_HOST_PORT && host === PRIVATE_HOST_PORT) return true;

  return false;
}

function rejectUnknownHost(req, res) {
  if (isAllowedRequestHost(req)) return false;
  res.statusCode = 421;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Misdirected Request");
  return true;
}

const app = next({ dev });
const handle = app.getRequestHandler();

// Socket.io の接続認証だけに使う専用インスタンス。src/lib/prisma.ts のシングルトンは
// TypeScript(ts-nodeなし)からrequireできないため、ここでは独立して生成する。
const prisma = new PrismaClient();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    // socket.io.attach() は自身がattachされる前に登録された "request" リスナーを
    // 退避し、/socket.io/ 以外のパスにのみ委譲する(socket.ioパスはここを通らない)。
    // そのためsocket.io側のHost検証は下の io.engine.use() で別途行う。
    if (rejectUnknownHost(req, res)) return;
    handle(req, res);
  });
  const io = new Server(httpServer, {
    // クライアントJS配信もHost allowlist外に漏らさないため無効化。
    // ブラウザ側はnpm経由でバンドルされたsocket.io-clientを使う想定で、
    // サーバー配信のクライアントJSには依存していない。
    serveClient: false,
  });

  // engine.ioの `allowRequest` オプションは sid の無い初回handshakeにしか
  // 呼ばれず、既存sidでのpolling継続やWebSocket upgradeはHost非検証のまま
  // 通ってしまう(engine.io@6.6.9 の verify() 実装で確認済み)。
  // 一方 io.engine.use() の middleware は handleRequest / handleUpgrade の
  // どちらでも verify() より前に必ず実行されるため、初回handshake・sid付き
  // polling・WebSocket upgradeの全経路をここ1箇所でカバーできる。
  // 拒否は next(err) 経由(engine.io側がBAD_REQUEST=400として処理する。
  // upgrade中のsocketにはHTTPステータス行を直接書けないため421固定にはできない)。
  io.engine.use((req, res, next) => {
    if (isAllowedRequestHost(req)) return next();
    next(new Error("Bad Host"));
  });

  // src/lib/overlay/emit.ts の emitOverlayUpdate などが参照する。
  global.__io = io;

  // ブラウザ製オーバーレイウィジェット: ?token=overlayToken → overlay:{streamerId} ルーム
  // Android/iOSアプリ: ?apiKey=streamer.apiKey → chat:{streamerId} ルーム
  //
  // クライアントが err.message ではなく err.data で理由を判別できるよう、
  // 機械可読な code を付与する（err.message は互換のため "unauthorized" のまま固定）。
  // モバイル側は comment_feed.dart がこの code を日本語メッセージへ変換する。
  const unauthorizedError = (code) => {
    const err = new Error("unauthorized");
    err.data = code;
    return err;
  };

  io.use(async (socket, next) => {
    const { token, apiKey } = socket.handshake.query ?? {};

    if (typeof token === "string" && token) {
      try {
        // verified未完了でもオーバーレイは即時利用可能にする。
        const streamer = await prisma.streamer.findFirst({
          where: { overlayToken: token },
          select: { id: true },
        });
        if (!streamer) return next(unauthorizedError("INVALID_OVERLAY_TOKEN"));
        socket.data.streamerId = streamer.id;
        socket.data.room = `overlay:${streamer.id}`;
        return next();
      } catch (err) {
        console.error("[socket] auth error:", err);
        return next(unauthorizedError("INVALID_OVERLAY_TOKEN"));
      }
    }

    if (typeof apiKey === "string" && apiKey) {
      try {
        // モバイルアプリはBIO認証ゲート対象外。verifiedを問わず通す。
        const streamer = await prisma.streamer.findFirst({
          where: { apiKey },
          select: { id: true },
        });
        if (!streamer) return next(unauthorizedError("INVALID_API_KEY"));
        socket.data.streamerId = streamer.id;
        socket.data.room = `chat:${streamer.id}`;
        return next();
      } catch (err) {
        console.error("[socket] auth error:", err);
        return next(unauthorizedError("INVALID_API_KEY"));
      }
    }

    return next(unauthorizedError("MISSING_CREDENTIALS"));
  });

  io.on("connection", (socket) => {
    socket.join(socket.data.room);
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`> Ready on http://0.0.0.0:${port} (${dev ? "development" : "production"})`);
  });
});
