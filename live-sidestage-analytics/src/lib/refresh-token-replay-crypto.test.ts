// `RefreshTokenReplay` に載せる短命ペイロードの暗号化。
//
// 固定したいのは2点だけ:
//   1. 往復して元に戻ること（rotation の猶予期間がここに依存している）
//   2. **壊れた入力・別鍵の入力では例外になること**（黙って平文や誤った値を返さない）
//      呼び出し元はこの例外を「キャッシュに無かった」扱いでフォールバックする設計なので、
//      ここが例外を投げずに何かを返してしまうと fail-safe が崩れる。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

const KEY = crypto.randomBytes(32).toString("base64");
process.env.REFRESH_TOKEN_REPLAY_ENC_KEY = KEY;

const { encryptReplayPayload, decryptReplayPayload } = await import("./refresh-token-replay-crypto");

beforeEach(() => {
  process.env.REFRESH_TOKEN_REPLAY_ENC_KEY = KEY;
});

afterEach(() => {
  process.env.REFRESH_TOKEN_REPLAY_ENC_KEY = KEY;
});

describe("encryptReplayPayload / decryptReplayPayload", () => {
  it("往復すると元の文字列に戻る", () => {
    const plain = "eyJhbGciOiJIUzI1NiJ9.payload.signature";
    expect(decryptReplayPayload(encryptReplayPayload(plain))).toBe(plain);
  });

  it("暗号文に平文が含まれない（平文保存への退行を防ぐ）", () => {
    const plain = "raw-refresh-token-value";
    expect(encryptReplayPayload(plain)).not.toContain(plain);
  });

  it("同じ平文でも毎回異なる暗号文になる（IV がランダム）", () => {
    expect(encryptReplayPayload("same")).not.toBe(encryptReplayPayload("same"));
  });

  it("マルチバイト文字も往復できる", () => {
    expect(decryptReplayPayload(encryptReplayPayload("配信者ユーザー"))).toBe("配信者ユーザー");
  });

  it("`:` 区切りが3つでない値は例外", () => {
    expect(() => decryptReplayPayload("not-encrypted")).toThrow();
    expect(() => decryptReplayPayload("a:b")).toThrow();
  });

  it("認証タグが合わない（改竄された）値は例外", () => {
    const [iv, , ciphertext] = encryptReplayPayload("plain").split(":");
    const forgedTag = crypto.randomBytes(16).toString("base64");
    expect(() => decryptReplayPayload(`${iv}:${forgedTag}:${ciphertext}`)).toThrow();
  });

  it("別の鍵で暗号化された値は例外（鍵ローテーション直後の挙動）", () => {
    const enc = encryptReplayPayload("plain");
    process.env.REFRESH_TOKEN_REPLAY_ENC_KEY = crypto.randomBytes(32).toString("base64");
    expect(() => decryptReplayPayload(enc)).toThrow();
  });

  it("鍵が未設定なら分かりやすく即失敗する", () => {
    delete process.env.REFRESH_TOKEN_REPLAY_ENC_KEY;
    expect(() => encryptReplayPayload("plain")).toThrow(/REFRESH_TOKEN_REPLAY_ENC_KEY/);
  });

  it("鍵の長さが32byteでなければ拒否する（弱い鍵で黙って動かさない）", () => {
    process.env.REFRESH_TOKEN_REPLAY_ENC_KEY = crypto.randomBytes(16).toString("base64");
    expect(() => encryptReplayPayload("plain")).toThrow(/32 bytes/);
  });
});
