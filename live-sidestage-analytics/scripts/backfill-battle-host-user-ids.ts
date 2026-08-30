// hostUserIds/hostScores列のバグ修正(2vs2バトルでチーム番号の混入)に伴うバックフィル。
//
// 修正前: 2vs2以上のチームバトルで、armies/battleItems の値の anchorIdStr が「チーム番号("1"/"2")」
// のままだったため、実際の4人のuserIdに加えてチーム番号2つが混入(→6要素で「6人」と表示)。
// さらに hostScores も同じキーで汚染されていた。
//
// 修正: collectHosts() が teamArmies[].teamUsers[] から実userIdと個人スコアを取得するように変更。
//
// バックフィル対象: array_length(hostUserIds,1) >= 3 の行(1vs1は2要素なので対象外)
// すべて終了済みレコード前提。ただし修正デプロイ直後に進行中バトルが存在しない確認が要る。
//
// 冪等: 再計算結果を既存値と比較し、差分がなければ更新しない。
// raw列の truncated 行(JSON.parse 失敗)はスキップする(エラーにはしない)。
//
import { prisma } from "../src/lib/prisma";
import { collectHosts } from "../src/lib/tiktok-battle";

const TAG = "[backfill-battle-host-user-ids]";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mergeHostUserIds(existing: string[], next: string[]): string[] {
  const merged = [...existing];
  for (const id of next) if (!merged.includes(id)) merged.push(id);
  return merged;
}

function mergeHostScores(
  existing: Record<string, string>,
  next: Record<string, string>
): Record<string, string> {
  const merged = { ...existing };
  for (const [id, score] of Object.entries(next)) {
    const existingScore = merged[id];
    if (existingScore === undefined) {
      merged[id] = score;
    } else {
      // 大きいほうを採用(mergeMaxScores と同じ思想)
      const existingBig = BigInt(existingScore);
      const nextBig = BigInt(score);
      if (nextBig > existingBig) {
        merged[id] = score;
      }
    }
  }
  return merged;
}

function hasRelevantDiff(
  existing: { hostUserIds: string[]; hostScores: Record<string, string> },
  computed: { hostUserIds: string[]; hostScores: Record<string, string> }
): boolean {
  // 配列の内容を無順序で比較
  if (existing.hostUserIds.length !== computed.hostUserIds.length) return true;
  if (!existing.hostUserIds.every((id) => computed.hostUserIds.includes(id))) return true;

  // hostScores の差分を比較
  const existingKeys = Object.keys(existing.hostScores);
  const computedKeys = Object.keys(computed.hostScores);
  if (existingKeys.length !== computedKeys.length) return true;
  if (!existingKeys.every((k) => existing.hostScores[k] === computed.hostScores[k])) return true;

  return false;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // hostUserIds が3要素以上(2vs2以上の可能性がある行)を対象
  const battles = await prisma.tiktokBattle.findMany({
    where: {
      // Prisma では array_length() を直接条件に使えないので全件取得後にフィルタ
    },
    select: { id: true, battleId: true, hostUserIds: true, hostScores: true, raw: true },
  });

  const targets = battles.filter((b) => b.hostUserIds.length >= 3);
  console.log(`${TAG} 対象候補: ${targets.length}件(全${battles.length}件中、hostUserIds >= 3)`);

  let updated = 0;
  let unchanged = 0;
  let skippedNoData = 0;

  for (const battle of targets) {
    const raw = asRecord(battle.raw);
    if (!raw) {
      skippedNoData++;
      continue;
    }

    const battleRaw = asRecord(raw.battle);
    const armiesRaw = asRecord(raw.armies);

    if (!battleRaw && !armiesRaw) {
      skippedNoData++;
      continue;
    }

    // raw.battle (OPEN時点) と raw.armies (進行中最新) の両方を再解釈
    let recomputedUserIds: string[] = [];
    let recomputedScores: Record<string, string> = {};

    if (battleRaw) {
      const battleHosts = collectHosts(battleRaw);
      recomputedUserIds = mergeHostUserIds(recomputedUserIds, battleHosts.hostUserIds);
      recomputedScores = mergeHostScores(recomputedScores, battleHosts.hostScores);
    }

    if (armiesRaw) {
      const armiesHosts = collectHosts(armiesRaw);
      recomputedUserIds = mergeHostUserIds(recomputedUserIds, armiesHosts.hostUserIds);
      recomputedScores = mergeHostScores(recomputedScores, armiesHosts.hostScores);
    }

    // 差分がなければスキップ
    const existing = { hostUserIds: battle.hostUserIds, hostScores: battle.hostScores as Record<string, string> };
    const computed = { hostUserIds: recomputedUserIds, hostScores: recomputedScores };

    if (!hasRelevantDiff(existing, computed)) {
      unchanged++;
      continue;
    }

    if (!dryRun) {
      await prisma.tiktokBattle.update({
        where: { id: battle.id },
        data: { hostUserIds: recomputedUserIds, hostScores: recomputedScores },
      });
    }
    updated++;
  }

  console.log(
    `${TAG} ${dryRun ? "[ドライラン] " : ""}更新: ${updated}件 / 差分なし: ${unchanged}件 / データ無しでスキップ: ${skippedNoData}件`
  );
}

main()
  .catch((err) => {
    console.error(`${TAG} 失敗`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
