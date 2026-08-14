import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import { EULER_SIGN_API_KEY_SETTING, getSetting, setSetting } from "@/lib/settings";

function maskKey(key: string): string {
  if (key.length <= 4) return "*".repeat(key.length);
  return `${"*".repeat(key.length - 4)}${key.slice(-4)}`;
}

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const key = await getSetting(EULER_SIGN_API_KEY_SETTING);
  return NextResponse.json({
    configured: Boolean(key),
    maskedKey: key ? maskKey(key) : null,
  });
}

export async function PUT(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) {
    return NextResponse.json({ error: "APIキーを入力してください" }, { status: 400 });
  }

  await setSetting(EULER_SIGN_API_KEY_SETTING, apiKey);
  return NextResponse.json({ configured: true, maskedKey: maskKey(apiKey) });
}

export async function DELETE() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await setSetting(EULER_SIGN_API_KEY_SETTING, null);
  return NextResponse.json({ configured: false, maskedKey: null });
}
