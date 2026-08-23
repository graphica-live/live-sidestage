// TiktokRoom.hostUserId を埋めて、バトル payload の anchorIdStr と一致するかを実データで確かめる。
//
// なぜ要るか: バトルスコアの帰属は「api-live/user/room/ の data.user.id」と
// 「linkMicBattle の anchorIdStr」が同じ空間であることが前提になっている。
// 実測2件では文字列の数値 userId が返ることまでは確認したが、**バトル payload 側の値と
// 突き合わせるまでは前提が正しいと言えない。**
//
// tiktok_battles は room ごとの行なので、「その room の hostUserId が、その room の行の
// hostUserIds に含まれているか」を見れば、実配信のバトルを待たずに検証できる。
//
// event-worker の補完ジョブは有効な lease の room しか対象にしないので、過去のバトルを持つ
// room は埋まらない。このスクリプトは**バトル観測のある room 全部**を対象にする。
//
// 使い方:
//   npx dotenv -e .env.local.test -- tsx scripts/verify-host-user-ids.ts        # ローカル
//   DATABASE_URL=... npx tsx scripts/verify-host-user-ids.ts                    # 本番(読み取り+補完)
//   ... scripts/verify-host-user-ids.ts --dry-run                               # 補完せず現状だけ見る

import { prisma } from "@/lib/prisma";
import { backfillHostUserIds } from "@/lib/tiktok-host-id";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  // バトルを観測したことがある room。ここが検証できる母集団。
  const rooms = await prisma.$queryRaw<
    { id: string; tiktokId: string; hostUserId: string | null; battles: number }[]
  >`
    SELECT r.id, r."tiktokId", r."hostUserId", COUNT(b.id)::int AS battles
    FROM public."TiktokRoom" r
    JOIN public.tiktok_battles b ON b."roomId" = r.id
    GROUP BY r.id, r."tiktokId", r."hostUserId"
    ORDER BY COUNT(b.id) DESC
  `;

  console.log(`バトル観測のある room: ${rooms.length}件`);
  const missing = rooms.filter((r) => r.hostUserId === null);
  console.log(`  うち hostUserId 未取得: ${missing.length}件`);

  if (missing.length > 0 && !dryRun) {
    console.log("補完する(TikTok へ問い合わせるので時間がかかる)...");
    // 上限を外して全件回す。1周のバッチ間ディレイは既定のまま効く。
    const result = await backfillHostUserIds(
      missing.map((r) => r.tiktokId),
      { maxPerRun: missing.length }
    );
    console.log(
      `  補完 ${result.filled}件 / 失敗 ${result.failed}件${result.aborted ? " (連続失敗で打ち切り)" : ""}`
    );
  }

  // 補完後の状態で照合する。
  const checked = await prisma.$queryRaw<
    { tiktokId: string; hostUserId: string; hostUserIds: string[]; battleId: string }[]
  >`
    SELECT r."tiktokId", r."hostUserId", b."hostUserIds", b."battleId"
    FROM public."TiktokRoom" r
    JOIN public.tiktok_battles b ON b."roomId" = r.id
    WHERE r."hostUserId" IS NOT NULL
    ORDER BY r."tiktokId", b."startedAt" DESC
  `;

  let matched = 0;
  const mismatches: string[] = [];
  for (const row of checked) {
    if (row.hostUserIds.includes(row.hostUserId)) matched++;
    else {
      mismatches.push(
        `  @${row.tiktokId} hostUserId=${row.hostUserId} battle=${row.battleId} ` +
          `anchors=[${row.hostUserIds.join(", ")}]`
      );
    }
  }

  console.log(`\n照合できた行: ${checked.length}件`);
  console.log(`  一致: ${matched}件 / 不一致: ${mismatches.length}件`);

  if (mismatches.length > 0) {
    console.log("\n不一致(先頭20件):");
    console.log(mismatches.slice(0, 20).join("\n"));
    console.log(
      "\n**data.user.id と anchorIdStr が同じ空間でない可能性がある。表示に進む前に原因を確かめること。**"
    );
  } else if (checked.length === 0) {
    console.log("\n照合できる行がない(hostUserId が1件も埋まっていない)。");
  } else {
    console.log("\nすべて一致した。data.user.id は anchorIdStr と同じ空間とみてよい。");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
