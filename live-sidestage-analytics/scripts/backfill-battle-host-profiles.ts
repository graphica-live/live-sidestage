// hostProfiles列追加(バトル履歴の対戦相手nickName/アイコン恒久化)に伴うバックフィル。
//
// 既存のTiktokBattle行はhostProfilesが空({})のまま保存されている。raw列に残っている
// linkMicBattle/linkMicArmiesの生payload(raw.battle / raw.armies)から、tiktok-battle.tsの
// collectHosts()と同じロジックで再解釈し、hostProfilesを埋める。
//
// **avatarUrlは当時の署名付きURLなのでほぼ失効済み。** nickName/displayIdのテキスト情報
// だけが実質的に回収できる対象。
//
// raw列は1件64KBで切り詰められる(tiktok-listener.tsのtoStorableRaw/MAX_RAW_BYTES)。
// 切り詰められた行(`{truncated: true, ...}`)はJSON.parse不能なので、collectHosts()が
// 空のhostProfilesを返すだけで安全にスキップされる(エラーにはしない)。
//
// 冪等: hostProfilesが既に空でない行はスキップする。何度実行しても安全。
import { prisma } from "../src/lib/prisma";
import { collectHosts, mergeHostProfiles, type HostProfiles } from "../src/lib/tiktok-battle";

const TAG = "[backfill-battle-host-profiles]";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isEmptyProfiles(value: unknown): boolean {
  const record = asRecord(value);
  return record === null || Object.keys(record).length === 0;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const battles = await prisma.tiktokBattle.findMany({
    select: { id: true, battleId: true, hostProfiles: true, raw: true },
  });

  const targets = battles.filter((b) => isEmptyProfiles(b.hostProfiles));
  console.log(`${TAG} 対象候補: ${targets.length}件(全${battles.length}件中、hostProfiles空)`);

  let updated = 0;
  let skippedNoData = 0;

  for (const battle of targets) {
    const raw = asRecord(battle.raw);
    const battleRaw = raw ? asRecord(raw.battle) : null;
    const armiesRaw = raw ? asRecord(raw.armies) : null;

    let merged: HostProfiles = {};
    if (battleRaw) merged = mergeHostProfiles(merged, collectHosts(battleRaw).hostProfiles);
    if (armiesRaw) merged = mergeHostProfiles(merged, collectHosts(armiesRaw).hostProfiles);

    if (Object.keys(merged).length === 0) {
      skippedNoData++;
      continue;
    }

    if (!dryRun) {
      await prisma.tiktokBattle.update({ where: { id: battle.id }, data: { hostProfiles: merged } });
    }
    updated++;
  }

  console.log(
    `${TAG} ${dryRun ? "[ドライラン] " : ""}更新: ${updated}件 / データ無しでスキップ: ${skippedNoData}件`
  );
}

main()
  .catch((err) => {
    console.error(`${TAG} 失敗`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
