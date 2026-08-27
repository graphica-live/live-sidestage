// kind → 設定の読み書き実装の対応表。**サーバー専用**(prisma を引く)。
//
// contribution専用の /api/streamer/overlay-settings とは別に、新規5kind分の設定を
// ここへ集約する。理由: contributionのOverlaySettingsPayloadはcontribution固有
// フィールドが大半で、5kindとほぼ重ならない(共通なのはappearanceの3値だけ)。
// 同じ型にまとめると網羅性チェックが効かなくなるため、`server-kinds.ts` と同じ
// 「実装忘れを型エラーにする」構造をここにも作る。

import { prisma } from "@/lib/prisma";
import { normalizeOverlayAppearance, parseAppearancePatch, OVERLAY_APPEARANCE_DEFAULT } from "./appearance";
import { normalizeGiftName } from "./timer.server";
import type { OverlayKind } from "./kinds";

export type OverlaySettingsServer<TPayload> = {
  load: (streamerId: string) => Promise<TPayload>;
  patch: (streamerId: string, body: Record<string, unknown>) => Promise<{ ok: true; payload: TPayload } | { ok: false; error: string }>;
};

function clampInt(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

// ── coin-list ──────────────────────────────────────────────────────────────
const coinListSettingsServer: OverlaySettingsServer<Record<string, unknown>> = {
  async load(streamerId) {
    const s = await prisma.overlayCoinListSettings.findUnique({ where: { streamerId } });
    return {
      ...normalizeOverlayAppearance(s ?? { ...OVERLAY_APPEARANCE_DEFAULT }),
      bgStyle: s?.bgStyle ?? "transparent",
      sortOrder: s?.sortOrder ?? "desc",
      maxEntries: s?.maxEntries ?? 20,
      rowGap: s?.rowGap ?? 8,
    };
  },
  async patch(streamerId, body) {
    const appearance = parseAppearancePatch(body);
    if (appearance === null) return { ok: false, error: "外観設定が不正です。" };

    const data: Record<string, unknown> = { ...appearance };
    if (body.bgStyle !== undefined) {
      if (body.bgStyle !== "transparent" && body.bgStyle !== "semi") return { ok: false, error: "背景スタイルが不正です。" };
      data.bgStyle = body.bgStyle;
    }
    if (body.sortOrder !== undefined) {
      if (body.sortOrder !== "asc" && body.sortOrder !== "desc") return { ok: false, error: "並び順が不正です。" };
      data.sortOrder = body.sortOrder;
    }
    if (body.maxEntries !== undefined) {
      const v = clampInt(body.maxEntries, 1, 100);
      if (v === null) return { ok: false, error: "最大表示件数は1〜100の整数で指定してください。" };
      data.maxEntries = v;
    }
    if (body.rowGap !== undefined) {
      const v = clampInt(body.rowGap, -30, 80);
      if (v === null) return { ok: false, error: "行間が不正です。" };
      data.rowGap = v;
    }

    await prisma.overlayCoinListSettings.upsert({
      where: { streamerId },
      create: { streamerId, ...data },
      update: data,
    });
    return { ok: true, payload: await coinListSettingsServer.load(streamerId) };
  },
};

// ── top-gift ───────────────────────────────────────────────────────────────
const topGiftSettingsServer: OverlaySettingsServer<Record<string, unknown>> = {
  async load(streamerId) {
    const s = await prisma.overlayTopGiftSettings.findUnique({ where: { streamerId } });
    return {
      ...normalizeOverlayAppearance(s ?? { ...OVERLAY_APPEARANCE_DEFAULT }),
      title: s?.title ?? "本日最高ギフト",
      senderDisplayMode: s?.senderDisplayMode ?? "latest",
      glowEnabled: s?.glowEnabled ?? true,
    };
  },
  async patch(streamerId, body) {
    const appearance = parseAppearancePatch(body);
    if (appearance === null) return { ok: false, error: "外観設定が不正です。" };

    const data: Record<string, unknown> = { ...appearance };
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || body.title.length === 0 || body.title.length > 60) {
        return { ok: false, error: "タイトルが不正です。" };
      }
      data.title = body.title;
    }
    if (body.senderDisplayMode !== undefined) {
      if (body.senderDisplayMode !== "latest" && body.senderDisplayMode !== "all") {
        return { ok: false, error: "送信者表示モードが不正です。" };
      }
      data.senderDisplayMode = body.senderDisplayMode;
    }
    if (body.glowEnabled !== undefined) {
      if (typeof body.glowEnabled !== "boolean") return { ok: false, error: "発光エフェクトの指定が不正です。" };
      data.glowEnabled = body.glowEnabled;
    }

    await prisma.overlayTopGiftSettings.upsert({
      where: { streamerId },
      create: { streamerId, ...data },
      update: data,
    });
    return { ok: true, payload: await topGiftSettingsServer.load(streamerId) };
  },
};

// ── tap-list ───────────────────────────────────────────────────────────────
const tapListSettingsServer: OverlaySettingsServer<Record<string, unknown>> = {
  async load(streamerId) {
    const s = await prisma.overlayTapListSettings.findUnique({ where: { streamerId } });
    return {
      ...normalizeOverlayAppearance(s ?? { ...OVERLAY_APPEARANCE_DEFAULT }),
      bgStyle: s?.bgStyle ?? "transparent",
      maxEntries: s?.maxEntries ?? 20,
      rowGap: s?.rowGap ?? 8,
    };
  },
  async patch(streamerId, body) {
    const appearance = parseAppearancePatch(body);
    if (appearance === null) return { ok: false, error: "外観設定が不正です。" };

    const data: Record<string, unknown> = { ...appearance };
    if (body.bgStyle !== undefined) {
      if (body.bgStyle !== "transparent" && body.bgStyle !== "semi") return { ok: false, error: "背景スタイルが不正です。" };
      data.bgStyle = body.bgStyle;
    }
    if (body.maxEntries !== undefined) {
      const v = clampInt(body.maxEntries, 1, 100);
      if (v === null) return { ok: false, error: "最大表示件数は1〜100の整数で指定してください。" };
      data.maxEntries = v;
    }
    if (body.rowGap !== undefined) {
      const v = clampInt(body.rowGap, -30, 80);
      if (v === null) return { ok: false, error: "行間が不正です。" };
      data.rowGap = v;
    }

    await prisma.overlayTapListSettings.upsert({
      where: { streamerId },
      create: { streamerId, ...data },
      update: data,
    });
    return { ok: true, payload: await tapListSettingsServer.load(streamerId) };
  },
};

// ── like-contribution ─────────────────────────────────────────────────────
const likeContributionSettingsServer: OverlaySettingsServer<Record<string, unknown>> = {
  async load(streamerId) {
    const s = await prisma.overlayLikeContributionSettings.findUnique({ where: { streamerId } });
    return {
      ...normalizeOverlayAppearance(s ?? { ...OVERLAY_APPEARANCE_DEFAULT }),
      title: s?.title ?? "Likeありがとう！",
      interval: s?.interval ?? 50,
      soundVolume: s?.soundVolume ?? 100,
      balloonDesignKey: s?.balloonDesignKey ?? "dark-glass",
      countFontSize: s?.countFontSize ?? 42,
      nameFontSize: s?.nameFontSize ?? 34,
    };
  },
  async patch(streamerId, body) {
    const appearance = parseAppearancePatch(body);
    if (appearance === null) return { ok: false, error: "外観設定が不正です。" };

    const data: Record<string, unknown> = { ...appearance };
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || body.title.length === 0 || body.title.length > 60) {
        return { ok: false, error: "タイトルが不正です。" };
      }
      data.title = body.title;
    }
    if (body.interval !== undefined) {
      const v = clampInt(body.interval, 1, 100_000);
      if (v === null) return { ok: false, error: "通知間隔は1以上の整数で指定してください。" };
      data.interval = v;
    }
    if (body.soundVolume !== undefined) {
      const v = clampInt(body.soundVolume, 0, 100);
      if (v === null) return { ok: false, error: "音量は0〜100の整数で指定してください。" };
      data.soundVolume = v;
    }
    if (body.balloonDesignKey !== undefined) {
      if (typeof body.balloonDesignKey !== "string" || body.balloonDesignKey.length === 0) {
        return { ok: false, error: "バルーンデザインが不正です。" };
      }
      data.balloonDesignKey = body.balloonDesignKey;
    }
    if (body.countFontSize !== undefined) {
      const v = clampInt(body.countFontSize, 8, 120);
      if (v === null) return { ok: false, error: "タップ数の文字サイズが不正です。" };
      data.countFontSize = v;
    }
    if (body.nameFontSize !== undefined) {
      const v = clampInt(body.nameFontSize, 8, 120);
      if (v === null) return { ok: false, error: "名前の文字サイズが不正です。" };
      data.nameFontSize = v;
    }

    await prisma.overlayLikeContributionSettings.upsert({
      where: { streamerId },
      create: { streamerId, ...data },
      update: data,
    });
    return { ok: true, payload: await likeContributionSettingsServer.load(streamerId) };
  },
};

// ── timer ──────────────────────────────────────────────────────────────────
const MAX_GIFT_RULES = 50;

const timerSettingsServer: OverlaySettingsServer<Record<string, unknown>> = {
  async load(streamerId) {
    const s = await prisma.overlayTimerSettings.findUnique({
      where: { streamerId },
      include: { giftRules: { orderBy: { createdAt: "asc" } } },
    });
    return {
      ...normalizeOverlayAppearance(s ?? { ...OVERLAY_APPEARANCE_DEFAULT }),
      durationMinutes: s?.durationMinutes ?? 10,
      durationSeconds: s?.durationSeconds ?? 0,
      headingText: s?.headingText ?? "カウントダウン",
      endSoundKey: s?.endSoundKey ?? null,
      endSoundVolume: s?.endSoundVolume ?? 100,
      minFloorMinutes: s?.minFloorMinutes ?? 0,
      maxCeilingMinutes: s?.maxCeilingMinutes ?? 0,
      countdownSoundEnabled: s?.countdownSoundEnabled ?? false,
      countdownSoundThresholdSeconds: s?.countdownSoundThresholdSeconds ?? 5,
      countdownSoundKey: s?.countdownSoundKey ?? null,
      countdownSoundVolume: s?.countdownSoundVolume ?? 100,
      giftRules: (s?.giftRules ?? []).map((r) => ({ giftName: r.giftName, minutesDelta: r.minutesDelta, enabled: r.enabled })),
    };
  },
  async patch(streamerId, body) {
    const appearance = parseAppearancePatch(body);
    if (appearance === null) return { ok: false, error: "外観設定が不正です。" };

    const data: Record<string, unknown> = { ...appearance };
    if (body.durationMinutes !== undefined) {
      const v = clampInt(body.durationMinutes, 0, 999);
      if (v === null) return { ok: false, error: "開始時間(分)が不正です。" };
      data.durationMinutes = v;
    }
    if (body.durationSeconds !== undefined) {
      const v = clampInt(body.durationSeconds, 0, 59);
      if (v === null) return { ok: false, error: "開始時間(秒)が不正です。" };
      data.durationSeconds = v;
    }
    if (body.headingText !== undefined) {
      if (typeof body.headingText !== "string" || body.headingText.length > 60) return { ok: false, error: "見出しが不正です。" };
      data.headingText = body.headingText;
    }
    if (body.endSoundKey !== undefined) {
      if (body.endSoundKey !== null && typeof body.endSoundKey !== "string") return { ok: false, error: "終了音が不正です。" };
      data.endSoundKey = body.endSoundKey;
    }
    if (body.endSoundVolume !== undefined) {
      const v = clampInt(body.endSoundVolume, 0, 100);
      if (v === null) return { ok: false, error: "終了音の音量が不正です。" };
      data.endSoundVolume = v;
    }
    if (body.minFloorMinutes !== undefined) {
      const v = clampInt(body.minFloorMinutes, 0, 999);
      if (v === null) return { ok: false, error: "短縮下限が不正です。" };
      data.minFloorMinutes = v;
    }
    if (body.maxCeilingMinutes !== undefined) {
      const v = clampInt(body.maxCeilingMinutes, 0, 999);
      if (v === null) return { ok: false, error: "延長上限が不正です。" };
      data.maxCeilingMinutes = v;
    }
    if (body.countdownSoundEnabled !== undefined) {
      if (typeof body.countdownSoundEnabled !== "boolean") return { ok: false, error: "カウントダウン音の指定が不正です。" };
      data.countdownSoundEnabled = body.countdownSoundEnabled;
    }
    if (body.countdownSoundThresholdSeconds !== undefined) {
      const v = clampInt(body.countdownSoundThresholdSeconds, 1, 60);
      if (v === null) return { ok: false, error: "カウントダウン開始秒数が不正です。" };
      data.countdownSoundThresholdSeconds = v;
    }
    if (body.countdownSoundKey !== undefined) {
      if (body.countdownSoundKey !== null && typeof body.countdownSoundKey !== "string") {
        return { ok: false, error: "カウントダウン音が不正です。" };
      }
      data.countdownSoundKey = body.countdownSoundKey;
    }
    if (body.countdownSoundVolume !== undefined) {
      const v = clampInt(body.countdownSoundVolume, 0, 100);
      if (v === null) return { ok: false, error: "カウントダウン音の音量が不正です。" };
      data.countdownSoundVolume = v;
    }

    await prisma.overlayTimerSettings.upsert({
      where: { streamerId },
      create: { streamerId, ...data },
      update: data,
    });

    // ギフト連動マッピングは配列で丸ごと置き換える(differential updateはしない)。
    if (body.giftRules !== undefined) {
      if (!Array.isArray(body.giftRules) || body.giftRules.length > MAX_GIFT_RULES) {
        return { ok: false, error: "ギフト連動ルールが不正です。" };
      }
      const rules: { giftName: string; minutesDelta: number; enabled: boolean }[] = [];
      for (const raw of body.giftRules) {
        if (!raw || typeof raw !== "object") return { ok: false, error: "ギフト連動ルールが不正です。" };
        const r = raw as Record<string, unknown>;
        if (typeof r.giftName !== "string" || r.giftName.trim().length === 0) {
          return { ok: false, error: "ギフト名が不正です。" };
        }
        const minutesDelta = Number(r.minutesDelta);
        if (!Number.isFinite(minutesDelta) || minutesDelta === 0) {
          return { ok: false, error: "加減算する分数が不正です。" };
        }
        rules.push({
          giftName: normalizeGiftName(r.giftName),
          minutesDelta,
          enabled: r.enabled !== false,
        });
      }
      await prisma.$transaction([
        prisma.overlayTimerGiftRule.deleteMany({ where: { streamerId } }),
        ...rules.map((r) => prisma.overlayTimerGiftRule.create({ data: { streamerId, ...r } })),
      ]);
    }

    return { ok: true, payload: await timerSettingsServer.load(streamerId) };
  },
};

export const OVERLAY_SETTINGS_SERVER: Record<Exclude<OverlayKind, "contribution">, OverlaySettingsServer<Record<string, unknown>>> = {
  "coin-list": coinListSettingsServer,
  "top-gift": topGiftSettingsServer,
  "like-contribution": likeContributionSettingsServer,
  "tap-list": tapListSettingsServer,
  timer: timerSettingsServer,
};
