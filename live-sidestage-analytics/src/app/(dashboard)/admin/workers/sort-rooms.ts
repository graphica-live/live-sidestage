import type { AssignedRoom } from "@/lib/worker-status";

export type RoomSortKey = "tiktokHandle" | "listenerUpdatedAt" | "weeklyEulerSignUsageCount" | "signatureUsage24hCount" | "collabSignatureUsage24hCount";
export type RoomSortDir = "asc" | "desc";

// buildWorkerReport() と同じく副作用・時刻依存を持たない純粋関数として切り出す。
// listenerUpdatedAt が null の行は昇順・降順を問わず末尾に固定する。
export function sortAssignedRooms(
  rooms: AssignedRoom[],
  key: RoomSortKey,
  dir: RoomSortDir
): AssignedRoom[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rooms].sort((a, b) => {
    if (key === "tiktokHandle") return sign * a.tiktokHandle.localeCompare(b.tiktokHandle);
    if (key === "listenerUpdatedAt") {
      if (a.listenerUpdatedAt == null && b.listenerUpdatedAt == null) return 0;
      if (a.listenerUpdatedAt == null) return 1;
      if (b.listenerUpdatedAt == null) return -1;
      return sign * (new Date(a.listenerUpdatedAt).getTime() - new Date(b.listenerUpdatedAt).getTime());
    }
    if (key === "weeklyEulerSignUsageCount") {
      if (a.weeklyEulerSignUsageCount == null && b.weeklyEulerSignUsageCount == null) return 0;
      if (a.weeklyEulerSignUsageCount == null) return 1;
      if (b.weeklyEulerSignUsageCount == null) return -1;
      return sign * (a.weeklyEulerSignUsageCount - b.weeklyEulerSignUsageCount);
    }
    if (key === "signatureUsage24hCount") {
      if (a.signatureUsage24hCount == null && b.signatureUsage24hCount == null) return 0;
      if (a.signatureUsage24hCount == null) return 1;
      if (b.signatureUsage24hCount == null) return -1;
      return sign * (a.signatureUsage24hCount - b.signatureUsage24hCount);
    }
    if (key === "collabSignatureUsage24hCount") {
      if (a.collabSignatureUsage24hCount == null && b.collabSignatureUsage24hCount == null) return 0;
      if (a.collabSignatureUsage24hCount == null) return 1;
      if (b.collabSignatureUsage24hCount == null) return -1;
      return sign * (a.collabSignatureUsage24hCount - b.collabSignatureUsage24hCount);
    }
    return 0;
  });
}
