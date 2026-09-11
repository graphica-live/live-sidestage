import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateVerificationCode } from "@/lib/tiktok-verify";
import { resolveUserByMobileToken, signMobileToken } from "@/lib/mobile-auth";
import { normalizeTiktokId, resolveRoomForStreamer, resolveRoomForStreamerInTx } from "@/lib/tiktok-room";
import { reviveSuspendedMonitoring } from "@/lib/mark-last-active";
import type { Streamer } from "@prisma/client";
import { requireExistingTiktokAccount } from "@/lib/tiktok-existence";
import {
  checkTiktokHandleChangeAllowed,
  checkTiktokUidMatch,
  formatTiktokHandleLockError,
  formatTiktokUidMismatchError,
} from "@/lib/tiktok-id-lock";
import { isAdminEmail } from "@/lib/admin";

/**
 * 入口の実在確認(書き込み前、fail-closed)。通ったら TikTok の不変ID(tiktokUid)を返す —
  * room 作成・更新時に TikTok の不変IDとして保存する。
 */
async function checkTiktokExistence(
  tiktokHandle: string
): Promise<{ error: NextResponse; tiktokUid?: undefined } | { error: null; tiktokUid: string | null }> {
  // 所有の根拠として tiktokUid を永続化するので positive キャッシュを読まない
  // (ハンドル再利用による第三者取り違えを防ぐ)。
  const existence = await requireExistingTiktokAccount(tiktokHandle, undefined, {
    skipPositiveCache: true,
  });
  if (existence.ok) return { error: null, tiktokUid: existence.tiktokUid };
  return {
    error: NextResponse.json(
      {
        error:
          existence.reason === "MISSING"
            ? "このTikTok IDのアカウントが見つかりません。IDを確認してください"
            : "TikTok上の実在確認ができませんでした。しばらくしてから再試行してください",
      },
      { status: existence.reason === "MISSING" ? 400 : 503 }
    ),
  };
}

export async function POST(req: NextRequest) {
  const auth = resolveUserByMobileToken(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { tiktokHandle } = await req.json();
  const cleanTiktokHandle = String(tiktokHandle ?? "").replace(/^@/, "").trim();
  if (!cleanTiktokHandle) {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  const user = await prisma.principal.findUnique({
    where: { id: auth.principalId },
    include: { streamer: true },
  });
  if (!user) {
    return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 401 });
  }

  if (user.streamer) {
    return NextResponse.json({ error: "既にTikTokアカウントが登録されています" }, { status: 409 });
  }

  const normalized = normalizeTiktokId(cleanTiktokHandle);
  const entryCheck = await checkTiktokExistence(normalized);
  if (entryCheck.error) return entryCheck.error;

  // 登録は無条件で許可する(Web版と同様、他アカウントとの重複登録も可)。
  //
  // **verified: true を書かない。** かつてモバイル登録は無条件に verified を立てていたが、
  // このフローは所有の根拠を1つも確認していない。証明していないものを証明済みとして
  // 記録すると、将来 BIO 認証を何かの前提に戻したときモバイル経由の全ユーザーが
  // 無審査で通ってしまう(CLAUDE.md の「User.email はそのメールの所有者であることを
  // 証明していない」と同型の罠)。BIO 認証は現在どの機能の前提でもないので、
  // 既定の false のままで機能上の差は無い。
  // 所有の根拠として tiktokUid を必ず保存する。取れなければ登録を通さない(fail-closed)。
  if (!entryCheck.tiktokUid) {
    return NextResponse.json(
      { error: "TikTok 上の実在確認ができませんでした。しばらくしてから再試行してください。" },
      { status: 503 },
    );
  }
  const streamer = await prisma.$transaction(async (tx) => {
    const created = await tx.streamer.create({
      data: {
        principalId: user.id,
        tiktokUid: entryCheck.tiktokUid!,
        tiktokHandle: cleanTiktokHandle,
        verificationCode: generateVerificationCode(),
        tiktokHandleChangedAt: new Date(),
      },
    });
    return created;
  });

  // 同じtiktokHandleを共有するTiktokRoomへ紐付ける。
  const roomId = await resolveRoomForStreamer(streamer.id);

  const token = signMobileToken({ principalId: user.id, streamerId: streamer.id });

  return NextResponse.json(
    {
      token,
      streamer: {
        id: streamer.id,
        tiktokHandle: streamer.tiktokHandle,
        verified: streamer.verified,
      },
    },
    { status: 201 }
  );
}

export async function PATCH(req: NextRequest) {
  const auth = resolveUserByMobileToken(req);
  if (!auth) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const { tiktokHandle } = await req.json();
  const cleanTiktokHandle = String(tiktokHandle ?? "").replace(/^@/, "").trim();
  if (!cleanTiktokHandle) {
    return NextResponse.json({ error: "TikTok IDを入力してください" }, { status: 400 });
  }

  const user = await prisma.principal.findUnique({
    where: { id: auth.principalId },
    include: { streamer: true },
  });
  if (!user) {
    return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 401 });
  }
  if (!user.streamer) {
    return NextResponse.json({ error: "TikTokアカウントが未登録です" }, { status: 404 });
  }

  const normalized = normalizeTiktokId(cleanTiktokHandle);
  const currentNormalized = normalizeTiktokId(user.streamer.tiktokHandle);

  // ハンドルが実際に変わる場合のみ実在確認で得られる、検証済みの新tiktokUid。
  // 冪等リトライ(ハンドル不変)では実在確認自体を行わないためnullのまま。
  let verifiedTiktokUid: string | null = null;

  // デバッグ用アカウント(ADMIN_EMAIL)は7日ロックの対象外。
  const lockExempt = isAdminEmail(user.email);

  // 事前チェック: 7日ロック中なら実在確認(TikTok照会)を省いて即409で返す。
  if (currentNormalized !== normalized && !lockExempt) {
    const preCheck = checkTiktokHandleChangeAllowed(
      { normalizedTiktokHandle: currentNormalized, tiktokHandleChangedAt: user.streamer.tiktokHandleChangedAt },
      normalized
    );
    if (!preCheck.ok) {
      const { error, code, retryAfter } = formatTiktokHandleLockError(preCheck.retryAfter);
      return NextResponse.json({ error, code, retryAfter }, { status: 409 });
    }
  }

  // tiktokHandleが変わらない更新(再送信・冪等リトライ)は実在確認を通さない。
  // 既に登録済みのIDを再送するだけの操作をTikTok側の障害で止める理由がない。
  if (cleanTiktokHandle !== user.streamer.tiktokHandle) {
    const entryCheck = await checkTiktokExistence(normalized);
    if (entryCheck.error) return entryCheck.error;
    // 所有の根拠が取れない変更は通さない(fail-closed。POST側の登録ゲートと同じ規律)。
    if (!entryCheck.tiktokUid) {
      return NextResponse.json(
        { error: "TikTok 上の実在確認ができませんでした。しばらくしてから再試行してください。" },
        { status: 503 }
      );
    }
    verifiedTiktokUid = entryCheck.tiktokUid;
    // 同一アカウントの改名だけを許す想定だが、UID mismatchチェックは現在一時的に無効化されて
    // おり(isTiktokUidMismatchCheckDisabled()参照)、lockExempt(ADMIN_EMAIL)以外の通常ユーザーも
    // 別アカウントへの付け替えが通る状態にある。この無効化フラグの挙動自体は別件(2026-09-11)
    // なので今回は変更しない。ただし通った場合、Streamer.tiktokUidは常に「検証済みの現在の
    // ハンドルが指すアカウント」へ追従させる(下のtx内でverifiedTiktokUidを書き込む) -
    // room解決(resolveRoomForStreamer)がStreamer.tiktokUidをキーにするため、ここを更新しない限り
    // ハンドルを何度変えても常に最初のroomへ紐付き続けてしまう(過去の不具合)。
    if (!checkTiktokUidMatch({ tiktokUid: user.streamer.tiktokUid }, entryCheck.tiktokUid, { exempt: lockExempt }).ok) {
      return NextResponse.json(formatTiktokUidMismatchError(), { status: 409 });
    }
  }

  // tiktokHandleの変更にはCAS(楽観的排他)を使う(web /api/verify/generateと同じパターン)。
  const now = new Date();

  // P2002(TiktokRoom.hostTiktokUidの同時新規作成競合)はtx全体を巻き込んで失敗する。
  // upsertRoom()が単体で持っていた「再フェッチで救済」と同じ挙動を保つため、tx全体を1回だけ再試行する。
  let result:
    | { kind: "locked"; retryAfter: Date }
    | { kind: "conflict" }
    | { kind: "ok"; streamer: Streamer; room: { roomId: string; shouldRevive: boolean; commit: () => void } };
  for (let attempt = 0; ; attempt++) {
    try {
      result = await prisma.$transaction(async (tx) => {
        const current = await tx.streamer.findUniqueOrThrow({
          where: { id: user.streamer!.id },
          select: { id: true, tiktokHandle: true, tiktokHandleChangedAt: true },
        });
        const currentNormalizedTx = normalizeTiktokId(current.tiktokHandle);

        if (currentNormalizedTx === normalized) {
          if (verifiedTiktokUid) {
            // 大文字小文字のみの変更: 実在確認が走りUIDを再取得済み。UID書き込みを伴うため、
            // 通常分岐と同じCAS・verifiedリセットを適用する(tiktokHandleChangedAtだけは
            // 7日ロックの対象にしないため更新しない)。
            const { count } = await tx.streamer.updateMany({
              where: { id: current.id, tiktokHandleChangedAt: current.tiktokHandleChangedAt },
              data: {
                tiktokHandle: cleanTiktokHandle,
                tiktokUid: verifiedTiktokUid,
                verified: false,
                verifiedAt: null,
              },
            });
            if (count === 0) {
              return { kind: "conflict" as const };
            }
            const updated = await tx.streamer.findUniqueOrThrow({ where: { id: current.id } });
            const room = await resolveRoomForStreamerInTx(tx, updated.id);
            return { kind: "ok" as const, streamer: updated, room };
          }
          // 真の冪等リトライ: entryCheckが走っておらずverifiedTiktokUidはnull。何も検証すべき値がないので
          // 従来通りtiktokHandleの表記のみ更新する(CAS・verifiedリセットは不要、実質的な変更が無いため)。
          // tiktokUidは書き換わらないためroom付替えの対象外だが、statically shapeを揃えるため
          // resolveRoomForStreamerInTxを通す(既存roomと一致すれば早期returnするだけで実害はない)。
          const updated = await tx.streamer.update({
            where: { id: current.id },
            data: { tiktokHandle: cleanTiktokHandle },
          });
          const room = await resolveRoomForStreamerInTx(tx, updated.id);
          return { kind: "ok" as const, streamer: updated, room };
        }

        if (!verifiedTiktokUid) {
          // 外側でentryCheckを省略した後(=自分視点ではハンドル不変のつもりだった)に、
          // 別リクエストが実際にハンドルを変えていた場合のレース。ここに到達する時点で
          // currentNormalizedTx(tx内で再読取した最新値) !== normalized(自分の目標値)が
          // 確定しているにもかかわらずverifiedTiktokUidがnullなのは、検証済みuidを
          // 持たないまま実質的な変更へ進もうとしている状態。fail-closedのため書き込まず
          // 競合として扱い、クライアントに最新状態を取得のうえ再試行させる。
          return { kind: "conflict" as const };
        }

        if (!lockExempt) {
          const check = checkTiktokHandleChangeAllowed(
            { normalizedTiktokHandle: currentNormalizedTx, tiktokHandleChangedAt: current.tiktokHandleChangedAt },
            normalized,
            now
          );
          if (!check.ok) {
            return { kind: "locked" as const, retryAfter: check.retryAfter };
          }
        }

        const { count } = await tx.streamer.updateMany({
          where: { id: current.id, tiktokHandleChangedAt: current.tiktokHandleChangedAt },
          data: {
            tiktokHandle: cleanTiktokHandle,
            tiktokUid: verifiedTiktokUid,
            tiktokHandleChangedAt: now,
            // BIO認証(verified)は正しさを保っていない値を新IDへ引き継がない。
            verified: false,
            verifiedAt: null,
          },
        });
        if (count === 0) {
          return { kind: "conflict" as const };
        }
        const updated = await tx.streamer.findUniqueOrThrow({ where: { id: current.id } });
        const room = await resolveRoomForStreamerInTx(tx, updated.id);
        return { kind: "ok" as const, streamer: updated, room };
      });
      break;
    } catch (err) {
      if (attempt === 0 && (err as { code?: string })?.code === "P2002") {
        continue;
      }
      throw err;
    }
  }

  if (result.kind === "locked") {
    const { error, code, retryAfter } = formatTiktokHandleLockError(result.retryAfter);
    return NextResponse.json({ error, code, retryAfter }, { status: 409 });
  }
  if (result.kind === "conflict") {
    return NextResponse.json(
      { error: "他のリクエストと競合しました。もう一度お試しください", code: "CONFLICT" },
      { status: 409 }
    );
  }

  const streamer = result.streamer;

  // room付替え(TiktokRoomのupsert + Streamer.roomId更新)は上のtx内で確定済み。
  // ここではtx確定後にだけ実行してよい副作用(スロットル記録・監視復活)を処理する。
  result.room.commit();
  if (result.room.shouldRevive) {
    try {
      await reviveSuspendedMonitoring(result.room.roomId);
    } catch (err) {
      console.error("[mobile/streamer] 監視復活処理に失敗:", err);
    }
  }

  return NextResponse.json({
    streamer: {
      id: streamer.id,
      tiktokHandle: streamer.tiktokHandle,
      verified: streamer.verified,
    },
  });
}
