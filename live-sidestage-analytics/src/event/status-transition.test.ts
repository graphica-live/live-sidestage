import { describe, it, expect } from "vitest";
import { isAllowedStatusTransition, STATUS_TRANSITIONS } from "./status-transition";
import { EVENT_STATUSES } from "./validation";

describe("STATUS_TRANSITIONS", () => {
  it("すべてのステータスに遷移先の定義がある", () => {
    for (const status of EVENT_STATUSES) {
      expect(STATUS_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("遷移先はすべて既知のステータス", () => {
    for (const transitions of Object.values(STATUS_TRANSITIONS)) {
      for (const { to } of transitions) {
        expect(EVENT_STATUSES).toContain(to);
      }
    }
  });

  it("開催中から開催準備中へ戻せる", () => {
    expect(STATUS_TRANSITIONS.RUNNING.map((t) => t.to)).toContain("SCHEDULED");
  });
});

describe("isAllowedStatusTransition", () => {
  it("表にある遷移は通す", () => {
    expect(isAllowedStatusTransition("SCHEDULED", "RUNNING")).toBe(true);
    expect(isAllowedStatusTransition("RUNNING", "SCHEDULED")).toBe(true);
    expect(isAllowedStatusTransition("RUNNING", "FINISHED")).toBe(true);
    expect(isAllowedStatusTransition("FINISHED", "RUNNING")).toBe(true);
    expect(isAllowedStatusTransition("FINISHED", "ARCHIVED")).toBe(true);
    expect(isAllowedStatusTransition("ARCHIVED", "FINISHED")).toBe(true);
  });

  it("表にない遷移は拒む", () => {
    // 開催準備中からいきなりアーカイブ・終了へは飛ばせない。
    expect(isAllowedStatusTransition("SCHEDULED", "ARCHIVED")).toBe(false);
    expect(isAllowedStatusTransition("SCHEDULED", "FINISHED")).toBe(false);
    expect(isAllowedStatusTransition("RUNNING", "ARCHIVED")).toBe(false);
    expect(isAllowedStatusTransition("ARCHIVED", "RUNNING")).toBe(false);
    expect(isAllowedStatusTransition("ARCHIVED", "SCHEDULED")).toBe(false);
  });

  it("同じステータスへの遷移は通す(二重クリック・別タブでの先行操作)", () => {
    for (const status of EVENT_STATUSES) {
      expect(isAllowedStatusTransition(status, status)).toBe(true);
    }
  });

  it("未知のステータスからの遷移は拒む(fail closed)", () => {
    expect(isAllowedStatusTransition("SOMETHING_NEW", "RUNNING")).toBe(false);
    expect(isAllowedStatusTransition("", "RUNNING")).toBe(false);
  });
});
