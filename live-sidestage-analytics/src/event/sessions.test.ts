import { describe, it, expect } from "vitest";
import {
  MAX_EVENT_SESSIONS,
  expandAndMergeWindows,
  intersectWindows,
  normalizeSessionInputs,
  parseSessionRequest,
  resolveEventWindows,
  windowContaining,
} from "./sessions";

const at = (iso: string) => new Date(iso);

// 「1日目 22:00-23:00 予選 / 2日目 22:00-23:00 決勝」(JST) を UTC で書いたもの。
const DAY1 = { start: at("2026-09-01T13:00:00.000Z"), end: at("2026-09-01T14:00:00.000Z") };
const DAY2 = { start: at("2026-09-02T13:00:00.000Z"), end: at("2026-09-02T14:00:00.000Z") };

describe("resolveEventWindows", () => {
  it("日程を持たないイベントは外枠を1日程として扱う", () => {
    const windows = resolveEventWindows({ startAt: DAY1.start, endAt: DAY2.end, sessions: [] });
    // 実体の日程が無いので id は null(対戦の割り当て先には使えない)。
    expect(windows).toEqual([{ id: null, start: DAY1.start, end: DAY2.end, name: null }]);
  });

  it("sessionsが未指定(select漏れ)でも外枠へ落ちる", () => {
    const windows = resolveEventWindows({ startAt: DAY1.start, endAt: DAY2.end });
    expect(windows).toHaveLength(1);
  });

  it("日程はstartAt昇順に並べ替える", () => {
    const windows = resolveEventWindows({
      startAt: DAY1.start,
      endAt: DAY2.end,
      sessions: [
        { startAt: DAY2.start, endAt: DAY2.end, name: "決勝" },
        { startAt: DAY1.start, endAt: DAY1.end, name: "予選" },
      ],
    });
    expect(windows.map((w) => w.name)).toEqual(["予選", "決勝"]);
  });
});

describe("normalizeSessionInputs", () => {
  it("外枠は全日程のmin/max", () => {
    const result = normalizeSessionInputs([
      { startAt: DAY2.start, endAt: DAY2.end },
      { startAt: DAY1.start, endAt: DAY1.end },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.startAt).toEqual(DAY1.start);
      expect(result.endAt).toEqual(DAY2.end);
    }
  });

  it("名前は前後の空白を落とし、空なら null にする", () => {
    const result = normalizeSessionInputs([
      { startAt: DAY1.start, endAt: DAY1.end, name: "  予選  " },
      { startAt: DAY2.start, endAt: DAY2.end, name: "   " },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((s) => s.name)).toEqual(["予選", null]);
  });

  it("重なる日程を弾く", () => {
    const result = normalizeSessionInputs([
      { startAt: DAY1.start, endAt: at("2026-09-01T15:00:00.000Z") },
      { startAt: at("2026-09-01T14:00:00.000Z"), endAt: at("2026-09-01T16:00:00.000Z") },
    ]);
    expect(result.ok).toBe(false);
  });

  it("終わりと次の始まりが同時刻なのは許す(半開区間なので重複しない)", () => {
    const result = normalizeSessionInputs([
      { startAt: DAY1.start, endAt: DAY1.end },
      { startAt: DAY1.end, endAt: at("2026-09-01T15:00:00.000Z") },
    ]);
    expect(result.ok).toBe(true);
  });

  it("上限を超えたら弾く", () => {
    const many = Array.from({ length: MAX_EVENT_SESSIONS + 1 }, (_, i) => ({
      startAt: new Date(DAY1.start.getTime() + i * 86_400_000),
      endAt: new Date(DAY1.end.getTime() + i * 86_400_000),
    }));
    expect(normalizeSessionInputs(many).ok).toBe(false);
  });

  it("0件を弾く", () => {
    expect(normalizeSessionInputs([]).ok).toBe(false);
  });
});

describe("parseSessionRequest", () => {
  it("datetime-local の値をJSTとして読む", () => {
    const result = parseSessionRequest([
      { startAt: "2026-09-01T22:00", endAt: "2026-09-01T23:00", name: "予選" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0].startAt.toISOString()).toBe("2026-09-01T13:00:00.000Z");
      expect(result.value[0].name).toBe("予選");
    }
  });

  it("配列でなければ弾く", () => {
    expect(parseSessionRequest({ startAt: "2026-09-01T22:00" }).ok).toBe(false);
    expect(parseSessionRequest(null).ok).toBe(false);
  });

  it("日時が欠けている行を弾く", () => {
    const result = parseSessionRequest([{ startAt: "2026-09-01T22:00" }]);
    expect(result.ok).toBe(false);
  });

  // id は「既存のどの日程を更新するか」に使うので読む。**それがこのイベントの日程か**は
  // 更新API がロックの内側で突き合わせる(ここでは判定できない)。eventId は読まない。
  it("id は読み、eventId は読まない", () => {
    const result = parseSessionRequest([
      { id: "ses_1", eventId: "evt_other", startAt: "2026-09-01T22:00", endAt: "2026-09-01T23:00" },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value[0]).sort()).toEqual(["endAt", "id", "name", "startAt"]);
      expect(result.value[0].id).toBe("ses_1");
    }
  });

  it("id の型が不正な行は弾く", () => {
    const result = parseSessionRequest([
      { id: 123, startAt: "2026-09-01T22:00", endAt: "2026-09-01T23:00" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("同じ id を2回送ってきたら弾く(片方が黙って消えるため)", () => {
    const result = normalizeSessionInputs([
      { id: "ses_1", startAt: at("2026-09-01T13:00:00.000Z"), endAt: at("2026-09-01T14:00:00.000Z") },
      { id: "ses_1", startAt: at("2026-09-02T13:00:00.000Z"), endAt: at("2026-09-02T14:00:00.000Z") },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("windowContaining", () => {
  const windows = [
    { ...DAY1, name: "予選" },
    { ...DAY2, name: "決勝" },
  ];

  it("日程に完全に収まる区間だけ通す", () => {
    expect(windowContaining(windows, DAY2.start, DAY2.end)?.name).toBe("決勝");
  });

  it("日程の隙間は通さない", () => {
    expect(windowContaining(windows, DAY1.end, DAY2.start)).toBeNull();
  });

  it("日程をまたぐ区間は通さない", () => {
    expect(windowContaining(windows, at("2026-09-01T13:30:00.000Z"), DAY2.end)).toBeNull();
  });
});

describe("intersectWindows", () => {
  const windows = [
    { ...DAY1, name: null },
    { ...DAY2, name: null },
  ];

  it("日程の外へはみ出した部分を切る", () => {
    // 22:59 に始まって 23:04 に終わったバトル(1日目の終端をまたぐ)。
    const spans = intersectWindows(
      { start: at("2026-09-01T13:59:00.000Z"), end: at("2026-09-01T14:04:00.000Z") },
      windows
    );
    expect(spans).toEqual([{ start: at("2026-09-01T13:59:00.000Z"), end: DAY1.end }]);
  });

  it("日程をまたぐ区間は複数に割れる", () => {
    const spans = intersectWindows({ start: DAY1.start, end: DAY2.end }, windows);
    expect(spans).toEqual([
      { start: DAY1.start, end: DAY1.end },
      { start: DAY2.start, end: DAY2.end },
    ]);
  });

  it("どの日程にも重ならなければ空", () => {
    expect(intersectWindows({ start: DAY1.end, end: DAY2.start }, windows)).toEqual([]);
  });
});

describe("expandAndMergeWindows", () => {
  const windows = [
    { ...DAY1, name: null },
    { ...DAY2, name: null },
  ];

  it("前後に広げても離れている日程は別々のまま", () => {
    const spans = expandAndMergeWindows(windows, 3600_000);
    expect(spans).toEqual([
      { start: at("2026-09-01T12:00:00.000Z"), end: at("2026-09-01T15:00:00.000Z") },
      { start: at("2026-09-02T12:00:00.000Z"), end: at("2026-09-02T15:00:00.000Z") },
    ]);
  });

  it("広げて重なったらつなぐ(同じ区間を2回引かない)", () => {
    const spans = expandAndMergeWindows(
      [
        { ...DAY1, name: null },
        { start: at("2026-09-01T15:00:00.000Z"), end: at("2026-09-01T16:00:00.000Z"), name: null },
      ],
      3600_000
    );
    expect(spans).toEqual([
      { start: at("2026-09-01T12:00:00.000Z"), end: at("2026-09-01T17:00:00.000Z") },
    ]);
  });
});
