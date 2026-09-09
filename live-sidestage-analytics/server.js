const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");

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

  // src/lib/refresh-token-replay-crypto.ts の getKey() と同じ検証をここに複製する
  // (TSモジュールをrequireできないため)。未設定/不正な鍵のまま起動すると、
  // ログインと最初の access token 利用は成功してしまい、最初の refresh rotation で
  // 初めて500になる — 起動時に検出してfail-fastさせる。
  const replayEncKeyRaw = process.env.REFRESH_TOKEN_REPLAY_ENC_KEY;
  const replayEncKey = replayEncKeyRaw
    ? Buffer.from(replayEncKeyRaw, "base64")
    : null;
  if (!replayEncKeyRaw || !replayEncKey || replayEncKey.length !== 32) {
    console.error(
      "[startup] 本番起動には REFRESH_TOKEN_REPLAY_ENC_KEY (base64デコードで32byte) が必要です。"
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

// ---------------------------------------------------------------------------
// モバイルJWT(access token)の検証。
//
// src/lib/mobile-auth.ts の verifyMobileToken() と**同じ規則**を複製したもの。
// server.js からは TS モジュールを require できないため(上の isAllowedHost /
// reviveSuspendedMonitoring と同じ理由)、意図的な複製である。
// **mobile-auth.ts 側の検証規則(秘密鍵の環境変数名・LEGACY_TOKEN_CUTOFF_SEC・
// ペイロード形状)を変えたら、ここも手動で同期すること。** 簡略化・削除しないこと。
// ---------------------------------------------------------------------------

/// これより前に発行されたトークンは無効として扱う(src/lib/mobile-auth.ts より複製)。
/// 値は 5a3e97a(モバイル認証をメール/パスワードから Google へ移行)の**本番デプロイ時刻**
/// から切り上げたもので、メール所有確認なしに発行されていた旧90日トークンを弾くためのもの。
const LEGACY_TOKEN_CUTOFF_SEC = Math.floor(Date.parse("2026-08-15T02:00:00Z") / 1000);

function getMobileJwtSecret() {
  const secret = process.env.MOBILE_JWT_SECRET;
  if (!secret) throw new Error("MOBILE_JWT_SECRET is not set");
  return secret;
}

// 戻り値: { ok: true, principalId, exp } | { ok: false, code }
// code は unauthorizedError() へそのまま渡す機械可読コード。
function verifyMobileAccessToken(token) {
  let secret;
  try {
    secret = getMobileJwtSecret();
  } catch {
    // 設定漏れをトークン不正と取り違えないよう、ここだけは明示的に記録する
    // (mobile側は INVALID_TOKEN として扱うしかないため、原因はサーバーログに残す)。
    console.error(
      "[socket] MOBILE_JWT_SECRET が未設定のため、モバイルのsocket接続を認証できません"
    );
    return { ok: false, code: "INVALID_TOKEN" };
  }

  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch (err) {
    // jsonwebtoken が複数コピー存在しても判別できるよう instanceof ではなく name を見る。
    if (err && err.name === "TokenExpiredError") return { ok: false, code: "TOKEN_EXPIRED" };
    return { ok: false, code: "INVALID_TOKEN" };
  }

  if (typeof decoded === "string") return { ok: false, code: "INVALID_TOKEN" };
  const { principalId, iat, exp } = decoded;
  if (typeof principalId !== "string" || !principalId) return { ok: false, code: "INVALID_TOKEN" };
  // iat が無いトークンは jwt.sign が付ける前提から外れているので信用しない。
  if (typeof iat !== "number" || iat < LEGACY_TOKEN_CUTOFF_SEC) {
    return { ok: false, code: "INVALID_TOKEN" };
  }

  return { ok: true, principalId, exp: typeof exp === "number" ? exp : null };
}

// setTimeout の遅延は符号付き32bitを超えると即時発火に化ける。access tokenの寿命が
// これを超える場合(現行の90日トークン等)は強制切断タイマーを仕込まない —
// 「即座に切断」へ倒れる方が危険なため。
const MAX_TIMEOUT_MS = 2147483647;

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
  // Android/iOSアプリ: handshake.auth.token = モバイルJWT → chat:{streamerId} ルーム
  //
  // モバイル側の資格情報は query ではなく **handshake.auth** から読む。query の `token` は
  // 上のオーバーレイ認証が使用中で、同じ名前を混在させると衝突するため。
  //
  // クライアントが err.message ではなく err.data で理由を判別できるよう、
  // 機械可読な code を付与する（err.message は互換のため "unauthorized" のまま固定）。
  // モバイル側は comment_feed.dart がこの code を日本語メッセージへ変換する。
  const unauthorizedError = (code) => {
    const err = new Error("unauthorized");
    err.data = code;
    return err;
  };

  // src/lib/mark-last-active.ts の reviveSuspendedMonitoring() と同じロジック。
  // server.js はTSモジュールをrequireできないためここに複製する(上のisAllowedHostと同じ理由)。
  // OBSがoverlayTokenでsocket接続した = 配信者が実際に使っている証拠として、監視停止
  // (monitoringSuspended)を能動的に復活させる。呼び出し元でroomIdまで取得済みのため
  // Streamerの再取得はしない(Code Modeレビューで指摘)。
  //
  // lastWatchInstructedAtのスタンプ更新も複製する(匿名観測room自動停止トグル用。
  // watched-room-filter.ts参照)。現状OBS接続roomは常にStreamerを持つため匿名判定には
  // 乗らないが、将来Streamer削除で「降格」したroomをOBSが叩き続けるケースに備える
  // (Code Modeレビューで指摘)。スロットル(5分)はmark-last-active.tsの
  // WATCH_INSTRUCTION_STAMP_THROTTLE_MSと同じ値。
  const WATCH_INSTRUCTION_STAMP_THROTTLE_MS = 5 * 60 * 1000;
  const reviveSuspendedMonitoringForRoom = async (roomId) => {
    try {
      await prisma.tiktokRoom.updateMany({
        where: {
          id: roomId,
          lastWatchInstructedAt: { lt: new Date(Date.now() - WATCH_INSTRUCTION_STAMP_THROTTLE_MS) },
        },
        data: { lastWatchInstructedAt: new Date() },
      });
      await prisma.tiktokRoom.updateMany({
        where: { id: roomId, monitoringSuspended: true },
        data: {
          monitoringSuspended: false,
          unhealthySince: null,
          notFoundStreak: 0,
          notFoundFirstAt: null,
          lastExistenceCheckAt: null,
          lastLowValueCheckAt: new Date(),
          consecutiveBlockedCount: 0,
        },
      });
    } catch (err) {
      console.error("[socket] 監視復活処理に失敗:", err);
    }
  };

  io.use(async (socket, next) => {
    const { token } = socket.handshake.query ?? {};
    const mobileToken = socket.handshake.auth?.token;

    if (typeof token === "string" && token) {
      try {
        // verified未完了でもオーバーレイは即時利用可能にする。
        const streamer = await prisma.streamer.findFirst({
          where: { overlayToken: token },
          select: { id: true, roomId: true },
        });
        if (!streamer) return next(unauthorizedError("INVALID_OVERLAY_TOKEN"));
        socket.data.streamerId = streamer.id;
        socket.data.room = `overlay:${streamer.id}`;
        if (streamer.roomId) void reviveSuspendedMonitoringForRoom(streamer.roomId);
        return next();
      } catch (err) {
        console.error("[socket] auth error:", err);
        return next(unauthorizedError("INVALID_OVERLAY_TOKEN"));
      }
    }

    if (typeof mobileToken === "string" && mobileToken) {
      const verified = verifyMobileAccessToken(mobileToken);
      if (!verified.ok) return next(unauthorizedError(verified.code));

      try {
        // chat:{streamerId} は他人のギフト・コメントへのアクセス境界そのものなので、
        // JWTペイロードの streamerId クレームは信用せず principalId から引き直す
        // (resolveMobileAnalyticsContext() と同じ規律)。
        // モバイルアプリはBIO認証ゲート対象外。verifiedを問わず通す。
        const streamer = await prisma.streamer.findFirst({
          where: { principalId: verified.principalId },
          select: { id: true },
        });
        if (!streamer) return next(unauthorizedError("STREAMER_NOT_REGISTERED"));
        socket.data.streamerId = streamer.id;
        socket.data.room = `chat:${streamer.id}`;
        socket.data.tokenExp = verified.exp;
        return next();
      } catch (err) {
        console.error("[socket] auth error:", err);
        return next(unauthorizedError("INVALID_TOKEN"));
      }
    }

    return next(unauthorizedError("MISSING_CREDENTIALS"));
  });

  io.on("connection", (socket) => {
    socket.join(socket.data.room);

    // handshake の検証は接続時の1回だけなので、そのままだと access token が失効しても
    // 接続済みsocketは繋がり続ける(短命access tokenの意図が接続中socketに効かない)。
    // exp 到達時にサーバー側から切断し、mobile側の自動再接続 → TOKEN_EXPIRED →
    // トークン再発行 → 再接続、という既存の流れで復帰させる。
    // overlay認証のsocketは別の失効規則なのでタイマーを仕込まない(tokenExp が無い)。
    const exp = socket.data.tokenExp;
    if (typeof exp === "number") {
      const delay = exp * 1000 - Date.now();
      if (delay <= MAX_TIMEOUT_MS) {
        socket.data.expiryTimer = setTimeout(() => {
          socket.data.expiryTimer = null;
          socket.disconnect(true);
        }, Math.max(delay, 0));
      }
    }

    socket.on("disconnect", () => {
      if (socket.data.expiryTimer) {
        clearTimeout(socket.data.expiryTimer);
        socket.data.expiryTimer = null;
      }
    });
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`> Ready on http://0.0.0.0:${port} (${dev ? "development" : "production"})`);
  });
});
