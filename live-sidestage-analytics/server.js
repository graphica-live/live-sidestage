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

const app = next({ dev });
const handle = app.getRequestHandler();

// Socket.io の接続認証だけに使う専用インスタンス。src/lib/prisma.ts のシングルトンは
// TypeScript(ts-nodeなし)からrequireできないため、ここでは独立して生成する。
const prisma = new PrismaClient();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer);

  // src/lib/overlay/emit.ts の emitOverlayUpdate などが参照する。
  global.__io = io;

  // ブラウザ製オーバーレイウィジェット: ?token=overlayToken → overlay:{streamerId} ルーム
  // Android/iOSアプリ: ?apiKey=streamer.apiKey → chat:{streamerId} ルーム
  io.use(async (socket, next) => {
    const { token, apiKey } = socket.handshake.query ?? {};

    if (typeof token === "string" && token) {
      try {
        // verified未完了でもオーバーレイは即時利用可能にする。
        const streamer = await prisma.streamer.findFirst({
          where: { overlayToken: token },
          select: { id: true },
        });
        if (!streamer) return next(new Error("unauthorized"));
        socket.data.streamerId = streamer.id;
        socket.data.room = `overlay:${streamer.id}`;
        return next();
      } catch (err) {
        console.error("[socket] auth error:", err);
        return next(new Error("unauthorized"));
      }
    }

    if (typeof apiKey === "string" && apiKey) {
      try {
        const streamer = await prisma.streamer.findFirst({
          where: { apiKey, verified: true },
          select: { id: true },
        });
        if (!streamer) return next(new Error("unauthorized"));
        socket.data.streamerId = streamer.id;
        socket.data.room = `chat:${streamer.id}`;
        return next();
      } catch (err) {
        console.error("[socket] auth error:", err);
        return next(new Error("unauthorized"));
      }
    }

    return next(new Error("unauthorized"));
  });

  io.on("connection", (socket) => {
    socket.join(socket.data.room);
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`> Ready on http://0.0.0.0:${port} (${dev ? "development" : "production"})`);
  });
});
