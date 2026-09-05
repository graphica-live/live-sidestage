// sortAssignedRooms() は buildWorkerReport() と同じく副作用・時刻依存を持たない純粋関数。
// page.tsx はコンポーネント本体に prisma/next 系の依存を持つため、DOM環境なしの unit test として分離する。
import { describe, it, expect } from "vitest";
import { sortAssignedRooms } from "./sort-rooms";
import type { AssignedRoom } from "@/lib/worker-status";

function room(overrides: Partial<AssignedRoom> = {}): AssignedRoom {
  return {
    roomId: "room-1",
    tiktokId: "b",
    workerId: 0,
    listenerStatus: "connected",
    listenerMessage: null,
    listenerUpdatedAt: null,
    streamerCount: 0,
    watchCount: 0,
    eventMonitored: false,
    consecutiveBlockedCount: 0,
    weeklyEulerSignUsageCount: null,
    monitoringSuspended: false,
    ...overrides,
  };
}

describe("sortAssignedRooms", () => {
  it("tiktokIdの昇順に並べる", () => {
    const rooms = [room({ roomId: "1", tiktokId: "charlie" }), room({ roomId: "2", tiktokId: "alpha" }), room({ roomId: "3", tiktokId: "bravo" })];
    const sorted = sortAssignedRooms(rooms, "tiktokId", "asc");
    expect(sorted.map((r) => r.tiktokId)).toEqual(["alpha", "bravo", "charlie"]);
  });

  it("tiktokIdの降順に並べる", () => {
    const rooms = [room({ roomId: "1", tiktokId: "charlie" }), room({ roomId: "2", tiktokId: "alpha" }), room({ roomId: "3", tiktokId: "bravo" })];
    const sorted = sortAssignedRooms(rooms, "tiktokId", "desc");
    expect(sorted.map((r) => r.tiktokId)).toEqual(["charlie", "bravo", "alpha"]);
  });

  it("listenerUpdatedAtのnullは昇順・降順どちらでも末尾に固定される", () => {
    const rooms = [
      room({ roomId: "1", listenerUpdatedAt: null }),
      room({ roomId: "2", listenerUpdatedAt: "2026-09-01T00:00:00.000Z" }),
      room({ roomId: "3", listenerUpdatedAt: "2026-09-03T00:00:00.000Z" }),
    ];
    const asc = sortAssignedRooms(rooms, "listenerUpdatedAt", "asc");
    expect(asc.map((r) => r.roomId)).toEqual(["2", "3", "1"]);
    const desc = sortAssignedRooms(rooms, "listenerUpdatedAt", "desc");
    expect(desc.map((r) => r.roomId)).toEqual(["3", "2", "1"]);
  });

  it("weeklyEulerSignUsageCountの昇順に並べ、nullは末尾に固定される", () => {
    const rooms = [
      room({ roomId: "1", weeklyEulerSignUsageCount: 5 }),
      room({ roomId: "2", weeklyEulerSignUsageCount: null }),
      room({ roomId: "3", weeklyEulerSignUsageCount: 1 }),
    ];
    const asc = sortAssignedRooms(rooms, "weeklyEulerSignUsageCount", "asc");
    expect(asc.map((r) => r.roomId)).toEqual(["3", "1", "2"]);
  });

  it("weeklyEulerSignUsageCountの降順に並べ、nullは末尾に固定される", () => {
    const rooms = [
      room({ roomId: "1", weeklyEulerSignUsageCount: 5 }),
      room({ roomId: "2", weeklyEulerSignUsageCount: null }),
      room({ roomId: "3", weeklyEulerSignUsageCount: 1 }),
    ];
    const desc = sortAssignedRooms(rooms, "weeklyEulerSignUsageCount", "desc");
    expect(desc.map((r) => r.roomId)).toEqual(["1", "3", "2"]);
  });

  it("元の配列を破壊しない", () => {
    const rooms = [room({ roomId: "1", tiktokId: "b" }), room({ roomId: "2", tiktokId: "a" })];
    const original = [...rooms];
    sortAssignedRooms(rooms, "tiktokId", "asc");
    expect(rooms).toEqual(original);
  });
});
