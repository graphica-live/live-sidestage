import { NextRequest, NextResponse } from "next/server";
import { requireEventOwner } from "@/event/authz";
import { prisma } from "@/lib/prisma";

// チームを削除する。所属していた参加者は EventTeam の onDelete: SetNull で
// 未所属に戻るだけで、参加者自体は消えない(監視も継続する)。
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; teamId: string } }
) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const deleted = await prisma.eventTeam.deleteMany({
    where: { id: params.teamId, eventId: params.id },
  });
  if (deleted.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
