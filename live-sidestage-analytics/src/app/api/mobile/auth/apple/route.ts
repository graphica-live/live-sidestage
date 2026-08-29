import { NextRequest, NextResponse } from "next/server";
import {
  AppleAuthError,
  appleConfig,
  exchangeAuthorizationCode,
  sanitizeName,
  verifyAppleIdToken,
  type AppleClientKind,
} from "@/lib/apple-auth";
import { resolveAppleUser } from "@/lib/apple-account";
import { mobileAuthResponseBody } from "@/lib/mobile-oauth";

/// Flutter アプリからの Apple サインイン。
///
/// Google 版(`../google/route.ts`)と違い、**id_token を直接受け取らない**。
/// Android は web フローなので端末が受け取る応答は exported Activity 経由で
/// 第三者が差し込めてしまう。単回・短命な authorization code を Apple と交換して
/// 初めて認証が成立し、端末が生成した nonce が id_token に載って戻ることまで
/// 確認する。

const MAX_CODE_LENGTH = 2048;
const MAX_NONCE_LENGTH = 256;

function readString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

export async function POST(req: NextRequest) {
  const config = appleConfig();
  if (!config) {
    // Apple Developer 側の設定が済むまでは何も作らずに閉じる。
    return NextResponse.json({ error: "Appleサインインは現在利用できません" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const authorizationCode = readString(body.authorizationCode, MAX_CODE_LENGTH);
  const nonce = readString(body.nonce, MAX_NONCE_LENGTH);
  if (!authorizationCode || !nonce) {
    return NextResponse.json({ error: "authorizationCodeとnonceが必要です" }, { status: 400 });
  }

  // どのクライアントで認証したかで client_id と redirect_uri が変わる。
  // **知らない値を android に丸めない** — 黙って別のクライアント設定で
  // code を交換しにいくと、原因の分からない invalid_grant になる。
  if (body.clientKind !== "android" && body.clientKind !== "ios") {
    return NextResponse.json({ error: "clientKindが不正です" }, { status: 400 });
  }
  const clientKind: AppleClientKind = body.clientKind;

  try {
    const { idToken, clientId, refreshToken } = await exchangeAuthorizationCode(config, {
      code: authorizationCode,
      clientKind,
    });
    // aud は「交換に使った client_id」ちょうどでなければならない。
    const claims = await verifyAppleIdToken(idToken, clientId);

    // ★ 端末が生成した nonce と一致しなければ、その id_token は
    // この端末が始めた認証の結果ではない（ログインCSRF・使い回し）。
    if (!claims.nonce || claims.nonce !== nonce) {
      return NextResponse.json({ error: "Apple認証の照合に失敗しました" }, { status: 401 });
    }

    // 氏名は初回認可のときしか届かない。2回目以降は null のままでよい。
    const user = await resolveAppleUser(claims, sanitizeName(body.givenName, body.familyName), {
      refreshToken,
      clientId,
    });
    return NextResponse.json(mobileAuthResponseBody(user));
  } catch (error) {
    if (error instanceof AppleAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
