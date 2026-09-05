// DB不要。403ブロック検知(isBlockedError)の判定ロジックのみを検証する純粋関数テスト。
// worker-guardian.tsの403フェイルオーバー(別workerへの再割当)のトリガー判定なので、
// 誤検知(非ブロックのエラーをブロックと誤認)・見逃し(実ブロックを検知しない)の両方を
// カバーする。SIGI_STATE抽出失敗系は意図的に対象外(実装前レビューで指摘された
// 「TikTok側のHTML構造変更でも同じ文言が出て誤検知になる」ため)。
import { describe, it, expect } from "vitest";
import { isBlockedError } from "./tiktok-listener";
import { FetchIsLiveError } from "TLC-sidestage";

function axiosError(status: number) {
  const err = new Error(`Request failed with status code ${status}`);
  (err as unknown as { isAxiosError: boolean }).isAxiosError = true;
  (err as unknown as { response: { status: number } }).response = { status };
  return err;
}

describe("isBlockedError", () => {
  it("直接のAxiosError(403)を検知する", () => {
    expect(isBlockedError(axiosError(403))).toBe(true);
  });

  it("FetchIsLiveErrorのerrors配列内に403があれば検知する", () => {
    const wrapped = new FetchIsLiveError([new Error("html parse failed"), axiosError(403)]);
    expect(isBlockedError(wrapped)).toBe(true);
  });

  it("SIGI_STATE抽出失敗のErrorは対象外(誤検知回避のため意図的に除外)", () => {
    const err = new Error("Failed to extract the SIGI_STATE HTML tag, you might be blocked by TikTok.");
    expect(isBlockedError(err)).toBe(false);
  });

  it("無関係なエラーはfalse", () => {
    expect(isBlockedError(new Error("network timeout"))).toBe(false);
  });

  it("AxiosErrorでも403以外のステータスはfalse", () => {
    expect(isBlockedError(axiosError(429))).toBe(false);
    expect(isBlockedError(axiosError(500))).toBe(false);
  });

  it("UserOfflineError(配信オフライン)はfalse(排他確認)", () => {
    const err = new Error("requested user is offline");
    (err as unknown as { name: string }).name = "UserOfflineError";
    expect(isBlockedError(err)).toBe(false);
  });
});
