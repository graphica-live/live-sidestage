import type { Env } from './_types';

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function importAesKey(secret: string) {
  const secretBytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', secretBytes);
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function hashFramePassword(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return bytesToHex(digest);
}

export async function encryptFramePassword(env: Env, password: string): Promise<string | null> {
  const secret = env.FRAME_PASSWORD_ENCRYPTION_KEY?.trim();
  if (!secret) {
    return null;
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(secret);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(password)
  );

  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptFramePassword(env: Env, encryptedValue: string | null): Promise<string | null> {
  if (!encryptedValue) {
    return null;
  }

  const secret = env.FRAME_PASSWORD_ENCRYPTION_KEY?.trim();
  if (!secret) {
    return null;
  }

  const parts = encryptedValue.split('.');
  if (parts.length !== 2) {
    return null;
  }

  try {
    const iv = base64ToBytes(parts[0]);
    const payload = base64ToBytes(parts[1]);
    const key = await importAesKey(secret);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, payload);
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('Failed to decrypt frame password:', error);
    return null;
  }
}

type FrameAccessTokenPayload = {
  frameId: string;
  exp: number;
};

export async function createFrameAccessToken(env: Env, frameId: string, ttlMs = 10 * 60 * 1000): Promise<string | null> {
  const expiresAt = Date.now() + ttlMs;
  return encryptFramePassword(env, JSON.stringify({ frameId, exp: expiresAt }));
}

export async function verifyFrameAccessToken(
  env: Env,
  token: string | null,
  expectedFrameId: string
): Promise<boolean> {
  if (!token) {
    return false;
  }

  const decrypted = await decryptFramePassword(env, token);
  if (!decrypted) {
    return false;
  }

  try {
    const payload = JSON.parse(decrypted) as Partial<FrameAccessTokenPayload>;
    return payload.frameId === expectedFrameId && typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch {
    return false;
  }
}