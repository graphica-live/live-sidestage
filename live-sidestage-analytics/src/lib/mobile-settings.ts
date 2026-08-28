import { getSetting } from "./settings";

// mobileアプリをサーバー側から遠隔操作するための設定キー。全て AppSetting(key/value の汎用KV) 経由。
// 新規マイグレーションは不要。

export const MOBILE_BETA_ENABLED_SETTING = "mobileBetaEnabled";
export const MOBILE_MIN_SUPPORTED_VERSION_SETTING = "mobileMinSupportedVersion";
export const MOBILE_LATEST_VERSION_SETTING = "mobileLatestVersion";
export const MOBILE_MAINTENANCE_MODE_SETTING = "mobileMaintenanceMode";

/**
 * "true"/"false" 以外(未設定・typo・null・大文字小文字違い等)は全て false に倒す。
 *
 * 他のkill switch系AppSettingキー(tiktokCleanupDisabled等)と違い、このキーは
 * 「有効側」を確認する用途で使われる。fail-openにすると、β終了のつもりで
 * mobileBetaEnabled を消す/typoする事故が「β継続」として気づかれずに残る
 * (β終了できていないのに終了したと思い込む、最悪のfail-open)ので、必ずfail-closed(false)にする。
 *
 * そのため、β開始時はこの関数の既定値に頼らず、必ず setSetting("mobileBetaEnabled", "true")
 * を明示的に実行してから初回リリースを出すこと。
 */
export function parseMobileBetaEnabled(settingValue: string | null): boolean {
  return settingValue === "true";
}

export async function isMobileBetaEnabled(): Promise<boolean> {
  return parseMobileBetaEnabled(await getSetting(MOBILE_BETA_ENABLED_SETTING));
}

/** 未設定時は "0.0.0"(=常に許可)。空文字列や不正値もそのまま "0.0.0" 扱いにする。 */
export function parseMobileMinSupportedVersion(settingValue: string | null): string {
  const trimmed = settingValue?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "0.0.0";
}

export async function getMobileMinSupportedVersion(): Promise<string> {
  return parseMobileMinSupportedVersion(await getSetting(MOBILE_MIN_SUPPORTED_VERSION_SETTING));
}

/** 未設定時は null(クライアントは「更新案内なし」として扱う)。 */
export async function getMobileLatestVersion(): Promise<string | null> {
  const value = await getSetting(MOBILE_LATEST_VERSION_SETTING);
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function parseMobileMaintenanceMode(settingValue: string | null): boolean {
  return settingValue === "true";
}

export async function isMobileMaintenanceMode(): Promise<boolean> {
  return parseMobileMaintenanceMode(await getSetting(MOBILE_MAINTENANCE_MODE_SETTING));
}
