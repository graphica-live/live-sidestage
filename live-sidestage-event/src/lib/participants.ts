import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { AnalyticsClientError, releaseRoomLease, requestRoomLease } from "./analytics-client";
import { computeLeaseWindow } from "./room-lease";
import { MAX_DISPLAY_NAME_LENGTH, MAX_PARTICIPANTS, normalizeTiktokId } from "./validation";

// 参加者登録と room 監視要求。analytics 側に副作用が出る唯一の経路なので、
// 失敗時の後始末までここに閉じ込める。

export class ParticipantError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ParticipantError";
  }
}

export type RegisterResult = {
  participantId: string;
  tiktokId: string;
  roomId: string;
  /** analytics 側で room を新規作成したか(false = 既存 room の再利用) */
  createdRoom: boolean;
  /** 監視期限を切り詰めたか。true なら期限前に再登録が要る */
  leaseClamped: boolean;
};

/**
 * 参加者を1人登録する。
 *
 * analytics 側に room がなければ作らせ、イベント終了+猶予まで配信開始監視を要求する。
 * 既存 room があればそれを再利用する(同じ配信者のギフトが分裂しないように)。
 */
export async function registerParticipant(input: {
  eventId: string;
  rawTiktokId: string;
  displayName?: string | null;
  teamId?: string | null;
}): Promise<RegisterResult> {
  const tiktokId = normalizeTiktokId(input.rawTiktokId);
  if (!tiktokId) {
    throw new ParticipantError("TikTok ID の形式が正しくない。", 400);
  }

  const displayName = (input.displayName ?? "").trim() || tiktokId;
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new ParticipantError(`表示名は${MAX_DISPLAY_NAME_LENGTH}文字以内にすること。`, 400);
  }

  const event = await prisma.event.findUnique({
    where: { id: input.eventId },
    select: { id: true, endAt: true, _count: { select: { participants: true } } },
  });
  if (!event) {
    throw new ParticipantError("イベントが見つからない。", 404);
  }
  if (event._count.participants >= MAX_PARTICIPANTS) {
    throw new ParticipantError(`参加者は${MAX_PARTICIPANTS}人までです。`, 400);
  }

  const duplicate = await prisma.eventParticipant.findUnique({
    where: { eventId_tiktokId: { eventId: input.eventId, tiktokId } },
    select: { id: true },
  });
  if (duplicate) {
    throw new ParticipantError("この TikTok ID はすでに登録されている。", 409);
  }

  if (input.teamId) {
    const team = await prisma.eventTeam.findFirst({
      where: { id: input.teamId, eventId: input.eventId },
      select: { id: true },
    });
    if (!team) {
      throw new ParticipantError("指定されたチームが見つからない。", 400);
    }
  }

  const lease = computeLeaseWindow(event.endAt);

  // 先に analytics 側の room を確保する。roomId が決まらないと参加者行を作れないため。
  let leased;
  try {
    leased = await requestRoomLease(tiktokId, lease.granted);
  } catch (err) {
    if (err instanceof AnalyticsClientError) {
      throw new ParticipantError(`監視の登録に失敗した: ${err.message}`, err.status);
    }
    throw err;
  }

  try {
    const participant = await prisma.$transaction(async (tx) => {
      const created = await tx.eventParticipant.create({
        data: {
          eventId: input.eventId,
          tiktokId,
          roomId: leased.roomId,
          displayName,
          teamId: input.teamId ?? null,
        },
        select: { id: true },
      });

      // 台帳。同じ room を再登録した場合は解放済みエントリを復活させる。
      await tx.eventRoomLease.upsert({
        where: { eventId_roomId: { eventId: input.eventId, roomId: leased.roomId } },
        create: {
          eventId: input.eventId,
          roomId: leased.roomId,
          tiktokId,
          createdBySystem: leased.created,
          monitorUntil: lease.requested,
          releasedAt: null,
        },
        update: { monitorUntil: lease.requested, releasedAt: null },
      });

      return created;
    });

    return {
      participantId: participant.id,
      tiktokId,
      roomId: leased.roomId,
      createdRoom: leased.created,
      leaseClamped: lease.clamped,
    };
  } catch (err) {
    // event 側の書き込みが失敗したら、確保した監視要求を戻す(他が使っていなければ)。
    await releaseIfUnused(input.eventId, leased.roomId).catch((e) =>
      console.error("[participants] 補償の解放に失敗:", e)
    );

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // @@unique([eventId, roomId]) — 別表記で同じ配信者を二重登録しようとした場合。
      throw new ParticipantError("この配信者はすでに登録されている。", 409);
    }
    throw err;
  }
}

/**
 * 参加者を削除し、他に使っているイベントがなければ監視要求も解除する。
 *
 * analytics 側の解除に失敗しても event 側の削除は成立させる。
 * 期限(monitorUntil)が来れば analytics 側は自然に監視を止めるため、
 * 解除漏れは「余分に監視が続く」だけで、データの不整合にはならない。
 */
export async function removeParticipant(eventId: string, participantId: string): Promise<void> {
  const participant = await prisma.eventParticipant.findFirst({
    where: { id: participantId, eventId },
    select: { id: true, roomId: true },
  });
  if (!participant) {
    throw new ParticipantError("参加者が見つからない。", 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.eventParticipant.delete({ where: { id: participant.id } });
    await tx.eventRoomLease.updateMany({
      where: { eventId, roomId: participant.roomId, releasedAt: null },
      data: { releasedAt: new Date() },
    });
  });

  await releaseIfUnused(eventId, participant.roomId).catch((err) =>
    console.error("[participants] 監視要求の解除に失敗(期限切れを待つ):", err)
  );
}

/**
 * この room を確保している未解放の lease が他のイベントに残っていなければ、
 * analytics 側の監視要求を解除する。
 *
 * analytics 側の monitorUntil は room につき1本しかないので、他イベントが使っている
 * 間に解除すると、そのイベントの監視まで止めてしまう。
 */
async function releaseIfUnused(eventId: string, roomId: string): Promise<void> {
  const others = await prisma.eventRoomLease.count({
    where: { roomId, releasedAt: null, eventId: { not: eventId } },
  });
  if (others > 0) return;

  await releaseRoomLease(roomId);
}

/**
 * イベント削除前に、そのイベントが確保している監視要求をすべて解除する。
 * 参加者行は Event の cascade で消えるが、analytics 側の monitorUntil は
 * 明示的に解除しないと期限まで残るため、ここで戻す。
 */
export async function releaseEventLeases(eventId: string): Promise<void> {
  const leases = await prisma.eventRoomLease.findMany({
    where: { eventId, releasedAt: null },
    select: { roomId: true },
  });

  for (const lease of leases) {
    await releaseIfUnused(eventId, lease.roomId).catch((err) =>
      console.error(`[participants] room ${lease.roomId} の解除に失敗:`, err)
    );
  }
}
