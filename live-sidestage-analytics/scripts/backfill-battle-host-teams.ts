// hostTeams列(チーム所属。2vs2/1vs3等の左右split表示に使う)の新規追加に伴うバックフィル。
//
// 既存の2vs2/1vs3バトル行は raw 列に生payloadが残っているが、hostTeams 列は空({})のまま
// 保存されている(この列を追加する前のイベントで書き込まれたため)。raw を collectHosts() で
// 再解釈し、hostTeams を後付けで埋める。
//
// バックフィル対象: array_length(hostUserIds,1) >= 3 の行(1vs1は2要素なので対象外)。
//
// 冪等: 再計算結果を既存値と比較し、差分がなければ更新しない。
// 既存値が持つanchorIdの割当(値まで)を再計算結果が1件でも再現できなければ上書きしない
// (スキップ)。raw は battle(OPEN時点)とarmies(進行中の最新1件)の2スナップショットしか
// 持たないため、既存値(listenerがバトル全期間の複数イベントをunionして積み上げた結果、
// またはこのスクリプトの前回実行結果)より情報が少ない・teamId不一致(teamId欠損時の
// 配列インデックスへのフォールバックがスナップショットによって割当元と食い違う等)が
// ありうる。「既存値の全キーについて、再計算結果が同じ値を持つか」を条件にし、
// 再実行のたびに良いデータを部分的・不整合な再計算結果で退行させない(空({})の場合も
// この条件で自動的に弾かれる)。
//
// 対象は終了済み(endedAt !== null)のバトルに限る。進行中バトルはlistenerが今も
// hostTeamsを書き続けている可能性があり、このスクリプトのfindMany読み取り後・
// update書き込み前にlistenerの新しい書き込みへ気づかず上書きしうる。読み取り時の
// updatedAtを条件にしたupdateManyでこの競合を検出し、競合時は上書きしない。
//
import { prisma } from "../src/lib/prisma";
import { collectHosts, type HostTeams } from "../src/lib/tiktok-battle";

const TAG = "[backfill-battle-host-teams]";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mergeHostTeams(existing: HostTeams, next: HostTeams): HostTeams {
  return { ...existing, ...next };
}

function hostTeamsEqual(a: HostTeams, b: HostTeams): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // hostUserIds が3要素以上(2vs2以上の可能性がある行)かつ終了済みの行を対象。
  // 進行中バトルはlistenerが今もhostTeamsを更新しうるので対象から外す(下記のCASでも保険をかける)。
  const battles = await prisma.tiktokBattle.findMany({
    where: {
      endedAt: { not: null },
      // Prisma では array_length() を直接条件に使えないので、hostUserIds長は全件取得後にフィルタ
    },
    select: { id: true, battleId: true, hostUserIds: true, hostTeams: true, raw: true, updatedAt: true },
  });

  const targets = battles.filter((b) => b.hostUserIds.length >= 3);
  console.log(`${TAG} 対象候補: ${targets.length}件(終了済み${battles.length}件中、hostUserIds >= 3)`);

  let updated = 0;
  let unchanged = 0;
  let skippedNoData = 0;
  let skippedIncompleteRecompute = 0;
  let skippedConcurrentUpdate = 0;

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
    let recomputedTeams: HostTeams = {};

    if (battleRaw) {
      recomputedTeams = mergeHostTeams(recomputedTeams, collectHosts(battleRaw).hostTeams);
    }
    if (armiesRaw) {
      recomputedTeams = mergeHostTeams(recomputedTeams, collectHosts(armiesRaw).hostTeams);
    }

    const existing = (battle.hostTeams as HostTeams | null) ?? {};

    // 既存値の全キーについて、再計算結果が同じ値を持つかを見る(キーの存在だけでは
    // 不十分。teamId不一致のまま上書きするとチーム分けが壊れる)。
    // truncated raw等で再計算が空({})になった場合もこの条件で自動的に弾かれる。
    const coversExisting = Object.entries(existing).every(([id, teamId]) => recomputedTeams[id] === teamId);
    if (!coversExisting) {
      skippedIncompleteRecompute++;
      continue;
    }

    if (hostTeamsEqual(existing, recomputedTeams)) {
      unchanged++;
      continue;
    }

    if (!dryRun) {
      // 読み取り時のupdatedAtをwhereに含めるCAS。読み取り後にlistener等が書き込んでいたら
      // count=0になり、古いraw由来の再計算結果で新しい書き込みを踏み潰さない。
      const result = await prisma.tiktokBattle.updateMany({
        where: { id: battle.id, updatedAt: battle.updatedAt },
        data: { hostTeams: recomputedTeams },
      });
      if (result.count === 0) {
        skippedConcurrentUpdate++;
        continue;
      }
    }
    updated++;
  }

  console.log(
    `${TAG} ${dryRun ? "[ドライラン] " : ""}更新: ${updated}件 / 差分なし: ${unchanged}件 / ` +
      `データ無しでスキップ: ${skippedNoData}件 / 再計算結果が既存値と不整合でスキップ: ${skippedIncompleteRecompute}件 / ` +
      `並行更新を検知してスキップ: ${skippedConcurrentUpdate}件`
  );
}

main()
  .catch((err) => {
    console.error(`${TAG} 失敗`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
