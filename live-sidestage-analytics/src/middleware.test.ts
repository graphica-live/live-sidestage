import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";

// middleware の matcher を「実際にデプロイされる文字列そのもの」で検証する。
//
// Next.js は matcher にリテラルしか受け付けない(ビルド時に静的解析するため、変数は無視される)。
// そのため定数を export して共有できず、テスト側に書き写すと本体とずれても気づけない。
// ここではファイルから matcher を読み出して正規表現として評価する。
//
// 実際に守りたいのは「境界なしの前置一致で意図しないパスまで公開されないこと」で、
// これは HTTP レスポンスからは判別しにくい(除外されていてもページ側の getServerSession が
// 別途 redirect すれば同じ結果になるため)。matcher を直接見るのが唯一の確実な検証になる。
function loadMatcher(): RegExp {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(resolve(here, "middleware.ts"), "utf8");
  const found = src.match(/matcher:\s*\[\s*("(?:[^"\\]|\\.)*")/);
  if (!found) throw new Error("middleware.ts から matcher を取り出せなかった");
  const pattern: string = JSON.parse(found[1]);
  return new RegExp(`^${pattern}$`);
}

const matcher = loadMatcher();

/** true = middleware が走る = 未ログインならログインへ飛ばされる */
function isProtected(pathname: string): boolean {
  return matcher.test(pathname);
}

describe("middleware の matcher", () => {
  it("主催者向けの画面とAPIは保護される", () => {
    for (const path of [
      "/analytics",
      "/setup",
      "/admin",
      "/events",
      "/events/new",
      "/events/abc123",
      "/events/abc123/participants",
      "/api/events",
      "/api/events/abc123/matches",
      "/api/streamer/api-key",
    ]) {
      expect(isProtected(path), `${path} は保護されるべき`).toBe(true);
    }
  });

  it("イベントの公開ページと公開APIは認証なしで通る", () => {
    for (const path of [
      "/e/summer-cup",
      "/e/summer-cup/ranking",
      "/e/summer-cup/bracket",
      "/api/public/events/summer-cup/snapshot",
      "/event/login", // 主催者のログイン導線そのもの(保護すると自分自身へ無限リダイレクト)
    ]) {
      expect(isProtected(path), `${path} は公開されるべき`).toBe(false);
    }
  });

  it("既存の公開パスをイベント追加で巻き込んでいない", () => {
    for (const path of [
      "/login",
      "/register",
      "/api/auth/session",
      "/api/auth/callback/google",
      "/api/mobile/streamer",
      "/api/health",
      "/api/debug/battle-payloads",
      "/api/internal/gift-event",
      "/api/analytics/monthly-contributors",
      "/api/overlay/settings",
      "/overlay/contribution",
      "/images/trophy.png", // public/images 配下の静的画像(公開トーナメント表の優勝トロフィー等)
      "/_next/static/chunks/main.js",
      "/_next/image",
      "/favicon.ico",
    ]) {
      expect(isProtected(path), `${path} は公開されるべき`).toBe(false);
    }
  });

  // ここが本題。除外エントリに境界がないと前置一致になり、
  // `e` が `/events` を、`login` が `/login-history` を公開してしまう。
  it("除外エントリは前置一致ではなくパス境界で判定する", () => {
    for (const path of [
      "/events", // `e` にも `event/login` にも食われてはいけない
      "/events/abc123",
      "/event/logins", // `event/login` に食われてはいけない
      "/registered", // `register` に食われてはいけない
      "/login-history", // `login` に食われてはいけない
      "/overlays", // オーバーレイ管理ページ(要ログイン)。OBS用の公開パス `overlay` に食われてはいけない
      "/api/publicity", // `api/public` に食われてはいけない
      "/api/internally", // `api/internal` に食われてはいけない
      "/imageshop", // `images` に食われてはいけない
    ]) {
      expect(isProtected(path), `${path} は保護されるべき(前置一致の漏れ)`).toBe(true);
    }
  });

  it("事務所コンソールとセッション認証のAPIは保護される", () => {
    for (const path of [
      "/agency",
      "/agency/",
      "/api/agency",
      "/api/agency/api-key",
      "/api/agency/watches",
      "/api/agency/watches/abc123",
    ]) {
      expect(isProtected(path), `${path} は保護されるべき`).toBe(true);
    }
  });

  it("事務所のログイン導線と企業向けAPIは認証なしで通る", () => {
    for (const path of [
      "/agency/login", // 保護すると自分自身へ無限リダイレクトする
      "/api/agency-auth/session", // NextAuth(事務所)
      "/api/agency-auth/callback/google",
      "/api/agency/gifts/summary", // x-api-key ヘッダで route 内認証
    ]) {
      expect(isProtected(path), `${path} は公開されるべき`).toBe(false);
    }
  });

  it("事務所向けの除外エントリも前置一致にならない", () => {
    for (const path of [
      "/agency/logins", // `agency/login` に食われてはいけない
      "/api/agency/giftsomething", // `api/agency/gifts` に食われてはいけない
    ]) {
      expect(isProtected(path), `${path} は保護されるべき(前置一致の漏れ)`).toBe(true);
    }
  });

  it("Stripe Webhookは署名検証で保護されるためNextAuthセッションを要求しない", () => {
    for (const path of ["/api/webhooks/stripe", "/api/webhooks/stripe/"]) {
      expect(isProtected(path), `${path} は公開されるべき`).toBe(false);
    }
  });

  it("課金ページと似た文字列のWebhookパスは保護されたままになる", () => {
    for (const path of [
      "/billing", // 共通課金ページ(要ログイン)
      "/api/webhooks/stripe-evil", // `api/webhooks/stripe` に食われてはいけない
      "/api/webhooks", // 境界より手前
    ]) {
      expect(isProtected(path), `${path} は保護されるべき(前置一致の漏れ)`).toBe(true);
    }
  });

  it("プライバシーポリシーは認証なしで通る", () => {
    for (const path of ["/privacy", "/privacy/"]) {
      expect(isProtected(path), `${path} は公開されるべき`).toBe(false);
    }
  });

  it("プライバシーポリシーと似た文字列のパスは保護されたままになる", () => {
    for (const path of ["/privacy-something", "/privacypolicy"]) {
      expect(isProtected(path), `${path} は保護されるべき(前置一致の漏れ)`).toBe(true);
    }
  });
});

// canonical-origin.ts は *_ORIGIN 環境変数をモジュール読み込み時に評価するため、
// 各テストで env を設定してからモジュールを再読み込みする(vi.resetModules)。
describe("裸の `/` の host別リダイレクト", () => {
  const ORIGIN_ENV_KEYS = [
    "ANALYTICS_ORIGIN",
    "EVENTS_ORIGIN",
    "AGENCY_ORIGIN",
    "OVERLAYS_ORIGIN",
    "API_ORIGIN",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ORIGIN_ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.ANALYTICS_ORIGIN = "https://analytics.livesidestage.com";
    process.env.EVENTS_ORIGIN = "https://events.livesidestage.com";
    process.env.AGENCY_ORIGIN = "https://agency.livesidestage.com";
    process.env.OVERLAYS_ORIGIN = "https://overlays.livesidestage.com";
    process.env.API_ORIGIN = "https://api.livesidestage.com";
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of ORIGIN_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.resetModules();
  });

  async function runMiddleware(host: string, pathname: string) {
    const { default: mw } = await import("./middleware");
    const req = new NextRequest(`https://example.invalid${pathname}`, {
      headers: { "x-forwarded-host": host },
    });
    return mw(req);
  }

  it("events.livesidestage.com の裸の `/` は /events へ307リダイレクトする", async () => {
    const res = await runMiddleware("events.livesidestage.com", "/");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/events");
  });

  it("agency.livesidestage.com の裸の `/` は /agency へ307リダイレクトする", async () => {
    const res = await runMiddleware("agency.livesidestage.com", "/");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/agency");
  });

  it("overlays.livesidestage.com の裸の `/` は /overlays へ307リダイレクトする", async () => {
    const res = await runMiddleware("overlays.livesidestage.com", "/");
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/overlays");
  });

  it("裸の `/` 以外のパスはリダイレクト対象にならない", async () => {
    const res = await runMiddleware("events.livesidestage.com", "/events");
    // root redirect は発火せず、通常の認証チェック(未ログイン→ログイン画面)へ進む
    expect(new URL(res.headers.get("location") ?? "https://example.invalid/").pathname).not.toBe("/events");
  });
});
