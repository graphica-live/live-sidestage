// hostTiktokUid mismatch検知でmarkRoomHandleStale()により恒久凍結されたTiktokRoomを復旧する
// 手動メンテナンススクリプト。rebalance-workers.js / cleanup-nonexistent-streamers.ts と同じ
// dry-run / --apply方式。
//
// 凍結されたroomはgetMyRooms()の`handleStaleAt: null`条件を満たさなくなり、二度と
// precheckApiLive()の対象にならない(tiktok-listener.tsのコード修正だけでは自動復旧しない)。
//
// TiktokRoom.tiktokHandleは@uniqueではない(改名で空いたハンドルを第三者が取得しうるため、
// 同じtiktokHandleを持つ行が複数存在するのは正常。prisma/schema.prisma参照)。そのため
// --handle指定時は該当roomをfindManyで列挙し、1件に一意特定できた場合のみ更新へ進む。
// 2件以上ヒットした場合は一覧を表示して停止する(更新しない)。
//
// 対象未指定でのフラグ単独実行(全件一括解除)は許可しない。Step 1の一覧から対象を
// 目視確認したうえで、--room-idまたは--handleで個別指定させる安全策。
//
// このスクリプトはhostTiktokUidと現在のTikTok上のハンドルが一致するかを自動検証しない。
// 凍結原因が本物のUID不一致(改名等で第三者が旧ハンドルを取得した)だった場合、確認せず
// 解除すると別人の配信・ギフト・コメントが元のroomに混入する。--apply前に対象ハンドルが
// 本来の配信者のものであることを運用者側で確認すること。
//
// 使い方:
//   npx tsx scripts/unfreeze-frozen-rooms.ts                                   # Step 1: 一覧表示のみ
//   npx tsx scripts/unfreeze-frozen-rooms.ts --apply --room-id <id>            # Step 2: room-id指定で解除
//   npx tsx scripts/unfreeze-frozen-rooms.ts --apply --handle <tiktokHandle>   # Step 2: handle指定(1件一意特定時のみ)
//
// ローカル: 対象外(本番のhandleStaleAtを解除する用途のため)。
// 本番: DATABASE_URLを本番に向けて(または `railway run`)直接npx tsxで実行する。
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { normalizeTiktokId } from "../src/lib/tiktok-room";

const HIGHLIGHT_HANDLE = "aomine_kazuha";

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} に値がありません`);
  }
  return value;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const roomId = parseArg("--room-id");
  const handle = parseArg("--handle");

  if (roomId && handle) {
    throw new Error("--room-id と --handle は同時に指定できません");
  }

  const prisma = new PrismaClient();

  try {
    // Step 1: 常に実行(read-only)。凍結中の全roomを一覧表示する。
    const frozenRooms = await prisma.tiktokRoom.findMany({
      where: { handleStaleAt: { not: null } },
      select: {
        id: true,
        tiktokHandle: true,
        hostTiktokUid: true,
        handleStaleAt: true,
        listenerStatus: true,
        listenerMessage: true,
        streamers: { select: { tiktokHandle: true, user: { select: { email: true } } } },
      },
      orderBy: { handleStaleAt: "asc" },
    });

    console.log(`凍結中(handleStaleAt != null)のroom: ${frozenRooms.length}件`);
    for (const room of frozenRooms) {
      const mark = room.tiktokHandle === HIGHLIGHT_HANDLE ? " ★対象候補" : "";
      const owners = room.streamers.map((s) => `${s.tiktokHandle}(${s.user.email})`).join(", ") || "(所有Streamerなし)";
      console.log(
        `  roomId=${room.id} @${room.tiktokHandle} hostTiktokUid=${room.hostTiktokUid} handleStaleAt=${room.handleStaleAt?.toISOString()} listenerStatus=${room.listenerStatus}${mark}`
      );
      console.log(`    所有Streamer: ${owners}`);
    }

    if (!roomId && !handle) {
      console.log(
        "\n--room-id または --handle で対象roomを指定し、--apply を付けて再実行してください(対象未指定でのフラグ単独実行は許可していません)。"
      );
      return;
    }

    if (!apply) {
      console.log("\ndry-runです。実際に解除するには --apply を付けて実行してください。");
      console.log("--apply前に、対象roomのhostTiktokUidが現在のTikTok上のハンドルと一致することを確認してください(自動検証はしていません)。");
      return;
    }

    // Step 2: --apply かつ --room-id/--handle 明示指定時のみ実行(書き込み)。
    let targetId: string;
    if (roomId) {
      targetId = roomId;
    } else {
      const normalizedHandle = normalizeTiktokId(handle!);
      const matches = frozenRooms.filter((r) => r.tiktokHandle === normalizedHandle);
      if (matches.length === 0) {
        console.log(`\n--handle=${handle} に一致する凍結中roomがありません。何も解除しません。`);
        return;
      }
      if (matches.length > 1) {
        console.log(
          `\n--handle=${handle} に複数(${matches.length}件)の凍結中roomが一致しました。tiktokHandleは@uniqueでないため一意特定できません。--room-idで個別指定してください:`
        );
        for (const m of matches) {
          console.log(`  roomId=${m.id} hostTiktokUid=${m.hostTiktokUid} handleStaleAt=${m.handleStaleAt?.toISOString()}`);
        }
        return;
      }
      targetId = matches[0].id;
    }

    const result = await prisma.tiktokRoom.updateMany({
      where: { id: targetId, handleStaleAt: { not: null } },
      data: { handleStaleAt: null },
    });

    if (result.count === 0) {
      console.log(`\nroomId=${targetId} は既に凍結解除済み、または存在しません。更新は行われませんでした。`);
    } else {
      console.log(`\nroomId=${targetId} のhandleStaleAtを解除しました。`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
