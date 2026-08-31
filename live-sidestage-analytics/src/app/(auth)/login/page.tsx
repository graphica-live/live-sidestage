import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import GoogleLoginPanel from "../GoogleLoginPanel";
import { isEventPath } from "@/lib/login-path";
import { canonicalOrigin } from "@/lib/canonical-origin";

// NextAuth が戻り先を覚えている Cookie。本番(https)では __Secure- が付く。
const CALLBACK_COOKIES = ["next-auth.callback-url", "__Secure-next-auth.callback-url"];

function callbackPathFromCookie(): string | null {
  const jar = cookies();
  for (const name of CALLBACK_COOKIES) {
    const value = jar.get(name)?.value;
    if (!value) continue;
    try {
      // 絶対URLで入っていることも相対パスのこともある。
      return new URL(value, "http://localhost").pathname;
    } catch {
      // 壊れた値は無視する。
    }
  }
  return null;
}

/**
 * analytics(配信者/管理者)のログイン画面。
 *
 * イベント側から始まったフローがここへ落ちてくる経路が1つだけある。
 * src/lib/auth.ts は `pages: { signIn: "/login" }` だけを設定していて `pages.error` が無く、
 * NextAuth v4 は OAuth コールバックのエラー(**Google の同意画面でのキャンセルを含む**)を
 * `pages.error ?? pages.signIn` へ `?error=` 付きで戻す。そのままだとイベント主催者が
 * analytics ブランドの画面を見ることになるので、NextAuth が持っている callback-url Cookie が
 * /events 配下を指していたらイベント側のログインへ送り直す。
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const path = callbackPathFromCookie();
  if (path && isEventPath(path)) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string") params.set(key, value);
    }
    const query = params.toString();
    redirect(query ? `/event/login?${query}` : "/event/login");
  }

  return (
    <GoogleLoginPanel
      brandSuffix="Analytics"
      tagline="TikTok Live ギフト解析"
      defaultCallbackUrl="/"
      origin={canonicalOrigin("analytics")}
    />
  );
}
