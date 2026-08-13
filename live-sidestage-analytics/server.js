const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");

const dev = process.env.NODE_ENV !== "production";
const port = process.env.PORT || 3000;

const app = next({ dev });
const handle = app.getRequestHandler();

// Socket.io の接続認証だけに使う専用インスタンス。src/lib/prisma.ts のシングルトンは
// TypeScript(ts-nodeなし)からrequireできないため、ここでは独立して生成する。
const prisma = new PrismaClient();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));
  const io = new Server(httpServer);

  // src/lib/overlay.ts の emitOverlaySnapshot などが参照する。
  global.__io = io;

  // ブラウザ製オーバーレイウィジェット: ?token=overlayToken → overlay:{streamerId} ルーム
  // Android/iOSアプリ: ?apiKey=streamer.apiKey → chat:{streamerId} ルーム
  io.use(async (socket, next) => {
    const { token, apiKey } = socket.handshake.query ?? {};

    if (typeof token === "string" && token) {
      try {
        const streamer = await prisma.streamer.findFirst({
          where: { overlayToken: token, verified: true },
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
