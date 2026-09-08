import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin";
import {
  addAmbassadorByEmail,
  createInvite,
  listActiveInvites,
  listAmbassadors,
  removeAmbassador,
  revokeInvite,
} from "@/lib/ambassador/ambassador";
import { canonicalOrigin } from "@/lib/canonical-origin";

export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [ambassadors, invites] = await Promise.all([listAmbassadors(), listActiveInvites()]);
  const baseUrl = canonicalOrigin("analytics");
  return NextResponse.json({
    ambassadors,
    invites: invites.map((i) => ({ ...i, url: `${baseUrl}/invite/ambassador/${i.token}` })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; email?: unknown }
    | null;

  if (body?.action === "createInvite") {
    const invite = await createInvite();
    const baseUrl = canonicalOrigin("analytics");
    return NextResponse.json(
      { invite: { ...invite, url: `${baseUrl}/invite/ambassador/${invite.token}` } },
      { status: 201 }
    );
  }

  if (body?.action === "addByEmail") {
    const email = typeof body.email === "string" ? body.email : "";
    const result = await addAmbassadorByEmail(email);
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : result.code === "duplicate" ? 409 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ ambassador: result.ambassador }, { status: 201 });
  }

  return NextResponse.json({ error: "actionを指定してください。" }, { status: 400 });
}

// idとtypeの組み合わせで招待の失効/アンバサダーの解除を分岐する。
export async function DELETE(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const type = url.searchParams.get("type");
  if (!id || (type !== "invite" && type !== "ambassador")) {
    return NextResponse.json({ error: "idとtypeを指定してください。" }, { status: 400 });
  }

  if (type === "invite") {
    const removed = await revokeInvite(id);
    if (!removed) return NextResponse.json({ error: "招待が見つかりません。" }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  const result = await removeAmbassador(id);
  if (!result.removed) return NextResponse.json({ error: "アンバサダーが見つかりません。" }, { status: 404 });
  return NextResponse.json({ ok: true, hadActiveAmbassadorUltraSubscription: result.hadActiveAmbassadorUltraSubscription });
}
