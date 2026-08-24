import { NextRequest, NextResponse } from "next/server";

/// Apple の web フロー(Android / 将来の Web)の着地点。
///
/// Android にはネイティブの Apple 認証が無いので、`sign_in_with_apple` は Custom Tab で
/// Apple のページを開く。Apple は **`response_mode=form_post` で自分のサーバーへ POST** して
/// くるので、その結果をアプリのカスタムスキームへ中継する中間地点がどうしても要る。
/// 転送先の形式(`intent://callback?...#Intent;package=...;scheme=signinwithapple;end`)は
/// パッケージ側の規定。
///
/// **ここは何も認証しない単なる中継**で、Apple から来たのかどうかも検証できない
/// （Apple は署名付きの発信元を名乗らない）。実際の検証は
/// `POST /api/mobile/auth/apple` が authorization code を Apple と交換して行う。
/// 中継先は固定スキーム・固定パッケージなのでオープンリダイレクトにはならない。

/// Apple が返しうるキーだけを通す。未知のキーを素通しすると、中継先の
/// アプリへ任意のクエリを送り込む道具になる。
const FORWARDED_KEYS = ["code", "id_token", "state", "user", "error", "error_description"] as const;

const MAX_BODY_LENGTH = 64 * 1024;
const MAX_VALUE_LENGTH = 8 * 1024;
const CALLBACK_SCHEME = "signinwithapple";
const DEFAULT_ANDROID_PACKAGE = "com.liveanalytics.live_sidestage_mobile";

/// `Location` に載る値なので no-store。ブラウザ履歴や中間キャッシュに
/// authorization code を残さない。
const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

/// intent URI の `package=` に入る値。区切り文字(`;` `#`)が混ざると
/// intent の解釈を変えられるので、Android のパッケージ名として妥当な文字だけ許す。
function androidPackage(): string {
  const configured = process.env.APPLE_ANDROID_PACKAGE?.trim();
  if (configured && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(configured)) {
    return configured;
  }
  return DEFAULT_ANDROID_PACKAGE;
}

export async function POST(req: NextRequest) {
  // Apple は form_post しか使わない。JSON など別形式は受けない。
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
    return new NextResponse("Unsupported Media Type", { status: 415, headers: SECURITY_HEADERS });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_LENGTH) {
    return new NextResponse("Payload Too Large", { status: 413, headers: SECURITY_HEADERS });
  }

  const form = new URLSearchParams(raw);
  const params = new URLSearchParams();
  for (const key of FORWARDED_KEYS) {
    const value = form.get(key);
    if (!value) continue;
    // URLSearchParams が再エンコードするのでヘッダ分割は起きないが、
    // アプリ側へ制御文字を持ち込まない。
    const sanitized = value.replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, MAX_VALUE_LENGTH);
    if (sanitized) params.set(key, sanitized);
  }

  const location =
    `intent://callback?${params.toString()}` +
    `#Intent;package=${androidPackage()};scheme=${CALLBACK_SCHEME};end`;

  // NextResponse.redirect() は URL として解釈しようとするので使わない。
  return new NextResponse(null, {
    status: 302,
    headers: { ...SECURITY_HEADERS, Location: location },
  });
}

export async function GET() {
  return new NextResponse("Method Not Allowed", {
    status: 405,
    headers: { ...SECURITY_HEADERS, Allow: "POST" },
  });
}
