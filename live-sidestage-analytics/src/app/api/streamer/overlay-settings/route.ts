import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  clampOverlayDisplaySpeed,
  emitOverlaySnapshot,
  ensureOverlayToken,
  jstDateKey,
  OVERLAY_DISPLAY_SPEED_MAX,
  OVERLAY_DISPLAY_SPEED_MIN,
  normalizeOverlayAlign,
  normalizeOverlayHeadingBackground,
  OVERLAY_HEADING_BACKGROUNDS,
  OverlayHeadingBackground,
  OverlaySettingsPayload,
  resolveOverlayDayKey,
  shiftDayKey,
} from "@/lib/overlay";
import { contributionSettingsServer } from "@/lib/overlay/settings-kinds";

async function loadStreamer(principalId: string) {
  return prisma.streamer.findUnique({
    where: { principalId },
    select: {
      id: true,
      overlayToken: true,
      overlayContributionSettings: true,
    },
  });
}

type ContributionSettingsShape = {
  displayReference: string;
  displayDate: string | null;
  threshold: number;
  goalCount: number;
  visibleRows: number;
  nameMaxWidth: number;
  align: string;
  headingBackground: string;
  displaySpeed: number;
};

function toResponse(streamer: {
  overlayToken: string | null;
  overlayContributionSettings: ContributionSettingsShape | null;
}): OverlaySettingsPayload {
  const settings = streamer.overlayContributionSettings;
  const displayReference = settings?.displayReference ?? "today";
  const displayDate = settings?.displayDate ?? null;
  const displayDateKey = resolveOverlayDayKey({ overlayDisplayReference: displayReference, overlayDisplayDate: displayDate });
  return {
    overlayToken: streamer.overlayToken ?? "",
    displayDate: displayDateKey,
    isToday: displayDateKey === jstDateKey(),
    threshold: settings?.threshold ?? 1000,
    goalCount: settings?.goalCount ?? 5,
    visibleRows: settings?.visibleRows ?? 5,
    nameMaxWidth: settings?.nameMaxWidth ?? 140,
    // DB の列は string なので、オーバーレイ本体(buildOverlaySnapshot)と同じ正規化を通す。
    // 生の値を返すと、設定画面のボタンがどれも選択状態にならない値が紛れうる。
    align: normalizeOverlayAlign(settings?.align ?? "left"),
    headingBackground: normalizeOverlayHeadingBackground(settings?.headingBackground ?? "clear"),
    displaySpeed: clampOverlayDisplaySpeed(settings?.displaySpeed ?? 3),
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let streamer = await loadStreamer(session.user.id);
  if (!streamer) return NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 });

  if (!streamer.overlayToken) {
    // 生成→update ではなく ensureOverlayToken を通す。初回に2タブで同時に開くと
    // 別トークンが2つ生成され、DBに残らなかった側のタブが「コピーしても何も映らない」
    // OBS URL を表示してしまう(ensure 側で updateMany + 読み直しにしてある)。
    const overlayToken = await ensureOverlayToken(streamer.id);
    streamer = { ...streamer, overlayToken };
  }

  return NextResponse.json(toResponse(streamer));
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const streamer = await loadStreamer(session.user.id);
  if (!streamer) return NextResponse.json({ error: "配信者情報が見つかりません。" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};

  if (body.nav === "prev" || body.nav === "next" || body.nav === "today") {
    if (body.nav === "today") {
      data.displayReference = "today";
      data.displayDate = null;
    } else {
      const settings = streamer.overlayContributionSettings;
      const currentDayKey = resolveOverlayDayKey({
        overlayDisplayReference: settings?.displayReference ?? "today",
        overlayDisplayDate: settings?.displayDate ?? null,
      });
      const offset = body.nav === "prev" ? -1 : 1;
      let nextDayKey = shiftDayKey(currentDayKey, offset);
      const today = jstDateKey();
      if (nextDayKey > today) nextDayKey = today;

      data.displayReference = nextDayKey === today ? "today" : "fixed";
      data.displayDate = nextDayKey === today ? null : nextDayKey;
    }
  }

  if (body.threshold !== undefined) {
    const threshold = Number(body.threshold);
    if (!Number.isInteger(threshold) || threshold < 100 || threshold % 100 !== 0) {
      return NextResponse.json({ error: "閾値は100以上100の倍数で指定してください。" }, { status: 400 });
    }
    data.threshold = threshold;
  }

  if (body.goalCount !== undefined) {
    const goalCount = Number(body.goalCount);
    if (!Number.isInteger(goalCount) || goalCount < 0) {
      return NextResponse.json({ error: "目標人数は0以上の整数で指定してください。" }, { status: 400 });
    }
    data.goalCount = goalCount;
  }

  if (body.visibleRows !== undefined) {
    const visibleRows = Number(body.visibleRows);
    if (!Number.isInteger(visibleRows) || visibleRows < 1) {
      return NextResponse.json({ error: "表示人数は1以上の整数で指定してください。" }, { status: 400 });
    }
    data.visibleRows = visibleRows;
  }

  if (body.nameMaxWidth !== undefined) {
    const nameMaxWidth = Number(body.nameMaxWidth);
    if (!Number.isInteger(nameMaxWidth) || nameMaxWidth < 40) {
      return NextResponse.json({ error: "名前の最大幅は40px以上の整数で指定してください。" }, { status: 400 });
    }
    data.nameMaxWidth = nameMaxWidth;
  }

  if (body.align !== undefined) {
    if (body.align !== "left" && body.align !== "right") {
      return NextResponse.json({ error: "整列方向はleftまたはrightで指定してください。" }, { status: 400 });
    }
    data.align = body.align;
  }

  if (body.headingBackground !== undefined) {
    if (!OVERLAY_HEADING_BACKGROUNDS.includes(body.headingBackground as OverlayHeadingBackground)) {
      return NextResponse.json(
        { error: "見出し背景はclear、crystal-blue、sakura-pinkのいずれかで指定してください。" },
        { status: 400 }
      );
    }
    data.headingBackground = body.headingBackground;
  }

  if (body.displaySpeed !== undefined) {
    const displaySpeed = Number(body.displaySpeed);
    if (
      !Number.isInteger(displaySpeed) ||
      displaySpeed < OVERLAY_DISPLAY_SPEED_MIN ||
      displaySpeed > OVERLAY_DISPLAY_SPEED_MAX
    ) {
      return NextResponse.json(
        { error: `表示速度は${OVERLAY_DISPLAY_SPEED_MIN}〜${OVERLAY_DISPLAY_SPEED_MAX}の整数で指定してください。` },
        { status: 400 }
      );
    }
    data.displaySpeed = displaySpeed;
  }

  const result = await contributionSettingsServer.patch(streamer.id, data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  emitOverlaySnapshot(streamer.id).catch((err) => console.error("[overlay] emit error:", err));

  // result.payload は contributionSettingsServer.load() の内部形（overlayToken/isTodayを持たない、
  // align等の正規化もしていない）。GETと同じ OverlaySettingsPayload をtoResponse()経由で組み直す
  // (直接返すとPATCH応答だけ overlayToken 欠落・未正規化値になる)。
  return NextResponse.json(
    toResponse({
      overlayToken: streamer.overlayToken,
      overlayContributionSettings: result.payload as ContributionSettingsShape,
    })
  );
}
