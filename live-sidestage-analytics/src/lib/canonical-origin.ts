// サブドメイン化後、各機能の「正規ホスト」を単一の env var 群(*_ORIGIN)から導出する。
// NEXTAUTH_URL を認証ライブラリの設定からアプリ全体の canonical URL として
// 流用する結合を避けるため、専用の env var を新設して独立させてある。
//
// middleware.ts(Edge ランタイム)からも参照するため、Prisma 等サーバー専用モジュールは
// import しないこと。Client Component からも import 可能だが、process.env.*_ORIGIN は
// NEXT_PUBLIC_ 接頭辞が無いためブラウザへは常に undefined になる。呼び出しは
// Server Component 側で行い、値は props 経由で Client Component へ渡すこと。

export type OriginKind = "analytics" | "events" | "agency" | "overlays" | "api";

const ORIGIN_ENV_VARS: Record<OriginKind, string | undefined> = {
  analytics: process.env.ANALYTICS_ORIGIN,
  events: process.env.EVENTS_ORIGIN,
  agency: process.env.AGENCY_ORIGIN,
  overlays: process.env.OVERLAYS_ORIGIN,
  api: process.env.API_ORIGIN,
};

// ローカル開発では *_ORIGIN が未設定なのが既定。NEXTAUTH_URL(それも無ければ
// localhost:3000)へフォールバックし、これまでどおり単一オリジンで動かす。
const DEV_FALLBACK_ORIGIN = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

export function canonicalOrigin(kind: OriginKind): string {
  return ORIGIN_ENV_VARS[kind] ?? DEV_FALLBACK_ORIGIN;
}

function hostOf(origin: string): string | null {
  try {
    // 大文字小文字・末尾ドットを正規化する(ポート番号は URL.host に含まれる)。
    return new URL(origin).host.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

// *_ORIGIN が実際に設定されている(= 本番でサブドメイン構成が入っている)ホストだけを集める。
const CONFIGURED_HOSTS: Partial<Record<OriginKind, string>> = {};
for (const kind of Object.keys(ORIGIN_ENV_VARS) as OriginKind[]) {
  const value = ORIGIN_ENV_VARS[kind];
  const host = value ? hostOf(value) : null;
  if (host) CONFIGURED_HOSTS[kind] = host;
}

function normalizeRequestHost(raw: string | null): string | null {
  if (!raw) return null;
  return raw.trim().toLowerCase().replace(/\.$/, "");
}

interface HeaderLike {
  headers: { get(name: string): string | null };
}

// Railway は転送元 host を x-forwarded-host で渡す(AUTH_TRUST_HOST=1 が読むのと同じ値)。
export function requestHost(req: HeaderLike): string | null {
  const forwarded = req.headers.get("x-forwarded-host");
  return normalizeRequestHost(forwarded ?? req.headers.get("host"));
}

function allowlistFor(kinds: OriginKind[]): string[] {
  return kinds.map((k) => CONFIGURED_HOSTS[k]).filter((h): h is string => h !== undefined);
}

// /api/auth: analytics/events/agency/overlaysの4hostを許可(agencyのGoogle callbackもここに戻る)。
// overlaysは/overlays(設定UI)がauthOptionsのセッションで保護されているため、
// 他の3hostと同じくこのNextAuthエントリポイントへログインが戻ってくる。
export const STREAMER_AUTH_ALLOWED_HOSTS = allowlistFor(["analytics", "events", "agency", "overlays"]);
// /api/agency-auth: agencyのみ。NextAuth(agencyAuthOptions)を独立に呼ぶ別エントリポイント。
export const AGENCY_AUTH_ALLOWED_HOSTS = allowlistFor(["agency"]);

// allowlistが空(*_ORIGINが1つも設定されていない = ローカル開発)なら検証をスキップし、
// 単一オリジンのこれまでの挙動を維持する。本番は5つとも設定されるため必ず有効になる。
export function isAllowedHost(req: HeaderLike, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const host = requestHost(req);
  return host !== null && allowed.includes(host);
}

// middleware の裸の `/` リダイレクト先。host が未設定(ローカル開発)なら対象外になる。
const ROOT_REDIRECT_KINDS: ReadonlyArray<readonly [OriginKind, string]> = [
  ["events", "/events"],
  ["agency", "/agency"],
  ["overlays", "/overlays"],
];

export const ROOT_REDIRECT_TARGETS: ReadonlyArray<readonly [string, string]> = ROOT_REDIRECT_KINDS.map(
  ([kind, path]): readonly [string | undefined, string] => [CONFIGURED_HOSTS[kind], path],
).filter((entry): entry is readonly [string, string] => entry[0] !== undefined);
