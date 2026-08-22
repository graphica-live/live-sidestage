import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireEventOwner } from "@/event/authz";
import { buildCoverKey, isValidCoverKey } from "@/event/cover-key";
import {
  createCoverUploadUrl,
  deleteCoverObject,
  isCoverUploadEnabled,
  verifyCoverObject,
} from "@/lib/media-storage";

// カバー画像(hero用)のアップロード。presigned URL方式:
//   POST   … アップロード先の presigned PUT URL を発行する(DBは触らない)
//   PATCH  … ブラウザが直接バケットへPUTした後、アップロードを確定してDBへ保存する
//   DELETE … 現在のカバー画像を外す
//
// 3メソッドとも requireEventOwner でオーナーのみに絞る。

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isCoverUploadEnabled()) {
    return NextResponse.json({ error: "画像アップロードは現在利用できない。" }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const contentType = typeof body?.contentType === "string" ? body.contentType : "";
  const size = typeof body?.size === "number" ? body.size : NaN;

  const key = buildCoverKey(params.id, contentType);
  if (!key) {
    return NextResponse.json({ error: "画像形式はJPEG/PNG/WebPのみ対応している。" }, { status: 400 });
  }

  const result = await createCoverUploadUrl(key, contentType, size);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ uploadUrl: result.uploadUrl, key });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isCoverUploadEnabled()) {
    return NextResponse.json({ error: "画像アップロードは現在利用できない。" }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const key = typeof body?.key === "string" ? body.key : "";

  // 命名規則(events/<eventId>/cover-<timestamp>.<ext>)への完全一致で、
  // 他イベント/他人が発行したキーを書かせない。
  if (!isValidCoverKey(key, params.id)) {
    return NextResponse.json({ error: "画像キーが不正。" }, { status: 400 });
  }

  // presigned PUT の ContentLength 指定はS3互換実装が必ず強制する保証が無いため、
  // 確定はここでの HeadObject 検証を信頼の起点にする。
  const verified = await verifyCoverObject(key);
  if (!verified.ok) {
    await deleteCoverObject(key);
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }

  const before = await prisma.event.findUnique({
    where: { id: params.id },
    select: { coverImageKey: true },
  });

  await prisma.event.update({ where: { id: params.id }, data: { coverImageKey: key } });

  if (before?.coverImageKey && before.coverImageKey !== key) {
    await deleteCoverObject(before.coverImageKey);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const owned = await requireEventOwner(params.id);
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const before = await prisma.event.findUnique({
    where: { id: params.id },
    select: { coverImageKey: true },
  });

  await prisma.event.update({ where: { id: params.id }, data: { coverImageKey: null } });

  if (before?.coverImageKey) {
    await deleteCoverObject(before.coverImageKey);
  }

  return NextResponse.json({ ok: true });
}
