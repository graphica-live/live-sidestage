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

  io.use(async (socket, next) => {
    const token = socket.handshake.query?.token;
    if (typeof token !== "string" || !token) {
      return next(new Error("unauthorized"));
    }

    try {
      const streamer = await prisma.streamer.findFirst({
        where: { overlayToken: token, verified: true },
        select: { id: true },
      });
      if (!streamer) return next(new Error("unauthorized"));
      socket.data.streamerId = streamer.id;
      next();
    } catch (err) {
      console.error("[socket] auth error:", err);
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`overlay:${socket.data.streamerId}`);
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`> Ready on http://0.0.0.0:${port} (${dev ? "development" : "production"})`);
  });
});
