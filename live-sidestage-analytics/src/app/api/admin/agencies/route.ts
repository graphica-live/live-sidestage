import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import {
  createAgency,
  deleteAgency,
  listAllAgencies,
  setMaxWatchTargets,
} from "@/lib/agency/agency";

// 事務所の発行は管理者操作。ここで相手のGoogleアカウントのメールアドレスを登録しておけば、
// 本人はそのアカウントでログインするだけで事務所コンソールを使える(申請・承認のやり取りはない)。
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return NextResponse.json({ agencies: await listAllAgencies() });
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { name?: unknown; email?: unknown; maxWatchTargets?: unknown }
    | null;

  const name = typeof body?.name === "string" ? body.name : "";
  const email = typeof body?.email === "string" ? body.email : "";
  const maxWatchTargets =
    body?.maxWatchTargets === undefined || body.maxWatchTargets === null
      ? undefined
      : Number(body.maxWatchTargets);

  const result = await createAgency(email, name, maxWatchTargets);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.code === "duplicate" ? 409 : 400 }
    );
  }

  return NextResponse.json({ agency: result.agency }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { id?: unknown; maxWatchTargets?: unknown }
    | null;

  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "idを指定してください。" }, { status: 400 });

  const max = Number(body?.maxWatchTargets);
  if (!Number.isInteger(max) || max < 0 || max > 1000) {
    return NextResponse.json(
      { error: "maxWatchTargetsは0〜1000の整数で指定してください。" },
      { status: 400 }
    );
  }

  const agency = await setMaxWatchTargets(id, max);
  if (!agency) return NextResponse.json({ error: "事務所が見つかりません。" }, { status: 404 });

  return NextResponse.json({ agency });
}

// 事務所を削除すると監視対象もカスケードで消え、その部屋を他に見ている人がいなければ
// TikTok接続も次のensure周回で切れる。
export async function DELETE(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "idを指定してください。" }, { status: 400 });

  const removed = await deleteAgency(id);
  if (!removed) return NextResponse.json({ error: "事務所が見つかりません。" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
