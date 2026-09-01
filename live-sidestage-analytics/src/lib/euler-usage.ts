import { prisma } from "./prisma";

// tiktok-listener.tsのconnectInstance()がどの経路から呼ばれたか。
// "start" = 初回接続 / reconcileでの復元、"scheduled_reconnect" = disconnected等からの通常再接続、
// "watchdog" = 無応答検知による強制再接続。
export type EulerSignTrigger = "start" | "scheduled_reconnect" | "watchdog";

interface RecordEulerSignUsageInput {
  roomId: string;
  tiktokId: string;
  requestedAt: Date;
  outcome: "success" | "error";
  errorMessage?: string;
  trigger: EulerSignTrigger;
  reason: string | null;
  role: "web" | "worker";
  workerIndex: number | null;
  listenerEpoch: bigint | null;
  credentialMode: "configured" | "anonymous";
}

/**
 * EulerStream署名APIへの実際のリクエスト(署名消費)を1行記録する。
 * 呼び出し元(tiktok-listener.tsのsignedWebSocketProviderラッパー)はawaitせず呼ぶこと
 * — 記録の遅延・失敗で実際のTikTok接続を止めないため。失敗はconsole.errorのみで握りつぶす。
 */
export async function recordEulerSignUsage(input: RecordEulerSignUsageInput): Promise<void> {
  try {
    const now = new Date();
    const [room, leases] = await Promise.all([
      prisma.tiktokRoom.findUnique({
        where: { id: input.roomId },
        select: {
          workerId: true,
          monitorUntil: true,
          streamers: { select: { userId: true } },
          watches: { select: { agencyId: true } },
        },
      }),
      // 「有効な監視要求」の3条件(releasedAt無し / 期限内 / イベントがARCHIVEDでない)は
      // src/event/participants.ts の判定と揃える。releasedAtだけで絞ると期限切れ・
      // アーカイブ済みイベントの残骸まで「監視目的」として記録してしまう。
      prisma.eventRoomLease.findMany({
        where: {
          roomId: input.roomId,
          releasedAt: null,
          monitorUntil: { gt: now },
          event: { status: { not: "ARCHIVED" } },
        },
        select: { eventId: true },
      }),
    ]);

    await prisma.eulerSignUsage.create({
      data: {
        roomId: input.roomId,
        tiktokId: input.tiktokId,
        requestedAt: input.requestedAt,
        outcome: input.outcome,
        errorMessage: input.errorMessage ?? null,
        trigger: input.trigger,
        reason: input.reason,
        role: input.role,
        workerIndex: input.workerIndex,
        listenerEpoch: input.listenerEpoch,
        assignedWorkerId: room?.workerId ?? null,
        credentialMode: input.credentialMode,
        streamerUserIds: room?.streamers.map((s) => s.userId) ?? [],
        agencyIds: room?.watches.map((w) => w.agencyId) ?? [],
        eventIds: leases.map((l) => l.eventId),
        roomMonitorUntil: room?.monitorUntil ?? null,
      },
    });
  } catch (err) {
    console.error("[euler-usage] record failed:", err);
  }
}
