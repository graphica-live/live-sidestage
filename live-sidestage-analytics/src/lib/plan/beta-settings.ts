import { prisma } from "@/lib/prisma";
import { MOBILE_BETA_ENABLED_SETTING, parseMobileBetaEnabled } from "../mobile-settings";

// 機能領域ごとのβ有効化フラグ。全て AppSetting(key/value の汎用KV) 経由、新規マイグレーション不要。
//
// 「FREEの制限を一時解除する」ためだけに使う。プラン(FREE/PRO/ULTRA)そのものは書き換えない
// — 実プランを書き換えるとβ中の全ユーザーへ将来のPRO/ULTRA限定機能まで無条件開放してしまうため。
// 領域を増やすときはこの配列に1件足すだけでよい。
export const BETA_AREAS = ["mobile", "analytics", "events"] as const;
export type BetaArea = (typeof BETA_AREAS)[number];

/** 領域ごとのAppSettingキーを返す。テストやDB直接操作からも参照できるようexportする。 */
export function betaSettingKey(area: BetaArea): string {
  // "mobile"領域だけは既存キー(mobileBetaEnabled)をそのまま流用する。
  // 本番でこのキーを使った運用実績・ドキュメント参照があるため、リネームで
  // 追跡漏れが起きるのを避ける。
  if (area === "mobile") return MOBILE_BETA_ENABLED_SETTING;
  return `${area}BetaEnabled`;
}

/**
 * "true"/"false" 以外(未設定・typo・null・大文字小文字違い等)は全て false に倒す。
 *
 * mobileBetaEnabled(既存キー)と同じfail-closed方針を全領域に適用する。fail-openにすると、
 * β終了のつもりでキーを消す/typoする事故が「β継続」として気づかれずに残るため。
 */
export function parseBetaEnabled(settingValue: string | null): boolean {
  return parseMobileBetaEnabled(settingValue);
}

export async function isBetaEnabled(area: BetaArea): Promise<boolean> {
  const statuses = await getBetaStatuses([area]);
  return statuses[area];
}

/** 複数領域のβ状態を1回のクエリでまとめて取得する。 */
export async function getBetaStatuses(
  areas: readonly BetaArea[] = BETA_AREAS,
): Promise<Record<BetaArea, boolean>> {
  const keys = areas.map(betaSettingKey);
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  const valueByKey = new Map(rows.map((row) => [row.key, row.value]));

  const result = {} as Record<BetaArea, boolean>;
  for (const area of areas) {
    result[area] = parseBetaEnabled(valueByKey.get(betaSettingKey(area)) ?? null);
  }
  return result;
}
