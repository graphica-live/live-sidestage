// バトル履歴フィルタ設定のサーバー実装(サーバー専用。prisma読み書き)。
// OBSオーバーレイ設定ではなくダッシュボード表示フィルタなため、@/lib/overlay/ とは独立。
// src/lib/overlay/settings-kinds.ts と同じ {load, patch} パターンを踏襲。

import { prisma } from "@/lib/prisma";

export type BattleFilterSettingsPayload = {
  hideLowDiamondEnabled: boolean;
  threshold: number;
};

export const BATTLE_FILTER_SETTINGS_DEFAULT: BattleFilterSettingsPayload = {
  hideLowDiamondEnabled: false,
  threshold: 100,
};

export const battleFilterSettingsServer = {
  async load(streamerId: string): Promise<BattleFilterSettingsPayload> {
    const s = await prisma.battleHistoryFilterSettings.findUnique({
      where: { streamerId },
    });
    return {
      hideLowDiamondEnabled: s?.hideLowDiamondEnabled ?? false,
      threshold: s?.threshold ?? 100,
    };
  },

  async patch(
    streamerId: string,
    body: Record<string, unknown>,
  ): Promise<
    | { ok: true; payload: BattleFilterSettingsPayload }
    | { ok: false; error: string }
  > {
    const data: Partial<{ hideLowDiamondEnabled: boolean; threshold: number }> =
      {};

    // hideLowDiamondEnabled のバリデーション
    if (body.hideLowDiamondEnabled !== undefined) {
      if (typeof body.hideLowDiamondEnabled !== "boolean") {
        return { ok: false, error: "小さいバトル非表示フラグが不正です。" };
      }
      data.hideLowDiamondEnabled = body.hideLowDiamondEnabled;
    }

    // threshold のバリデーション
    if (body.threshold !== undefined) {
      const n = body.threshold;
      if (
        typeof n !== "number" ||
        !Number.isInteger(n) ||
        n < 0 ||
        n > 2147483647
      ) {
        return {
          ok: false,
          error: "しきい値は0以上の整数で指定してください。",
        };
      }
      data.threshold = n;
    }

    // 両方 undefined なら DB 書換せず現在値を返す
    if (Object.keys(data).length === 0) {
      return { ok: true, payload: await battleFilterSettingsServer.load(streamerId) };
    }

    // upsert
    await prisma.battleHistoryFilterSettings.upsert({
      where: { streamerId },
      create: { streamerId, ...data },
      update: data,
    });

    return {
      ok: true,
      payload: await battleFilterSettingsServer.load(streamerId),
    };
  },
};
