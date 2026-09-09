import crypto from "crypto";

/// `RefreshTokenReplay` 行に載せる短命ペイロード(access token / 生の refresh token)の
/// 対称暗号化。
///
/// refresh token の生の値は原則 DB に残さない(保存するのは SHA-256 ハッシュだけ)。
/// **唯一の例外が `RefreshTokenReplay` の30秒 TTL キャッシュ**で、これは
/// 「同じ古いトークンでの正常な同時提示」(モバイルのメイン/背景 Isolate、ネットワーク再試行)を
/// プロセスをまたいで idempotent に吸収するために、rotation の結果そのものを短時間持つ必要が
/// あるため。ただし平文で置くと、このテーブルの漏洩(バックアップ流出・内部者アクセス)だけで
/// 生の refresh token がそのまま漏れる。そこで DB 接続情報とは独立に管理する
/// アプリケーション層の鍵(`REFRESH_TOKEN_REPLAY_ENC_KEY`)で AES-256-GCM 暗号化する。
///
/// 鍵ローテーションは新しい32byteランダム値へ差し替えて再デプロイするだけでよい。
/// このテーブルは30秒TTLの短命データしか持たないため、直後の数十秒だけ復号に失敗する
/// 行が残りうるが、呼び出し元(`rotateRefreshToken`)は「キャッシュに無かった」のと同じ扱いで
/// 通常の rotation へフォールバックする(fail-safe。fail-open ではない)。

const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.REFRESH_TOKEN_REPLAY_ENC_KEY;
  if (!raw) throw new Error("REFRESH_TOKEN_REPLAY_ENC_KEY is not set");

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    // 値そのものはログに出さない(鍵なので)。長さだけ示す。
    throw new Error(
      `REFRESH_TOKEN_REPLAY_ENC_KEY must be ${KEY_BYTES} bytes when base64-decoded (got ${key.length})`,
    );
  }
  return key;
}

/// `<iv>:<authTag>:<ciphertext>` を base64 で連結した1つの文字列を返す
/// (JWT のドット連結と同じ発想。base64 に `:` は出ないので分割は曖昧にならない)。
export function encryptReplayPayload(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/// フォーマット不正・認証タグ不一致(鍵ローテーション直後など)は例外を投げる。
/// 呼び出し元は「replay キャッシュに無かった」のと同じ扱いでフォールバックすること。
export function decryptReplayPayload(enc: string): string {
  const parts = enc.split(":");
  if (parts.length !== 3) throw new Error("replay payload の形式が不正です");

  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
    throw new Error("replay payload の形式が不正です");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
