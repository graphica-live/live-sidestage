// 未ログインのリクエストをどのログイン画面へ飛ばすかをパスだけで決める。
//
// middleware.ts から使う。あちらは Edge ランタイムなので Prisma を引き込めない。
// ここは純粋なパス判定だけに保つこと。
//
// 振り分けは3系統:
//   /agency, /api/agency        → 事務所コンソール(セッションcookieも別)
//   /event, /events, /api/events → イベント運営(表向き別サービス。cookieは配信者と共有)
//   それ以外                     → analytics(配信者/管理者)
//
// middleware.ts の matcher(除外リスト)は保護範囲を決めるだけで、ここは**飛び先**しか
// 決めない。したがってこの関数を変えても認可範囲は動かない。
import { AGENCY_LOGIN_PATH } from "./agency/session-cookie";

export const EVENT_LOGIN = "/event/login";
export const DEFAULT_LOGIN = "/login";

const AGENCY_PREFIXES = ["/agency", "/api/agency"];
// `/event` 自体も含めるのは、`/event/...` という URL 面ごとイベント側の領域にするため。
// `/event/login` は matcher の除外リストにあるので middleware 自体が走らない。
const EVENT_PREFIXES = ["/event", "/events", "/api/events"];

function hasPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isAgencyPath(pathname: string): boolean {
  return hasPrefix(pathname, AGENCY_PREFIXES);
}

export function isEventPath(pathname: string): boolean {
  return hasPrefix(pathname, EVENT_PREFIXES);
}

export function loginPathFor(pathname: string): string {
  if (isAgencyPath(pathname)) return AGENCY_LOGIN_PATH;
  if (isEventPath(pathname)) return EVENT_LOGIN;
  return DEFAULT_LOGIN;
}
