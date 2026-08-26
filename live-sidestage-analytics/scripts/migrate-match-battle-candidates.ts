// 勝利条件(1本勝負/2本先取)対応で追加した EventMatchBattleCandidate へ、既存 EventMatch の
// 検知結果(ミラー列)を複製するバックフィルスクリプト。
//
// **`EventMatchBattleCandidate` は新規テーブルなので、`prisma db push` はこのスクリプトを
// 待たずに普通に実行できる**(migrate-match-session.ts のような「既存データがある非NULL列の
// 追加」問題は起きない)。このスクリプトは db push 後、ロジック変更(detectMatches /
// resolveMatchResults の書き換え)をデプロイする前に実行する2段階デプロイの中間ステップ
// (詳細は src/event/CLAUDE.md「マイグレーション・デプロイ」)。
//
// 変換規則(意味変換つき。既存の単一検知を「唯一のゲーム」として複製するだけでなく、
// 状態ごとに扱いを分ける):
//   - status=VOID または MANUAL_DECISIONS(MANUAL/DRAW/BYE): 候補行を作らない
//     (resolveMatchSeries の対象外になるため不要)
//   - rules.reviewReason が AMBIGUOUS/PARTIAL/TEAM_BATTLE/END_UNKNOWN だった:
//     候補行は作るが selected=false・organizerSelected=false で作る
//     (次回の集計周回で正しく再評価させる。自動的に selected=true にしない)
//   - status=FINISHED かつ winnerDecidedBy=AGGREGATE(自動確定): 候補行を1件、
//     selected=true で作る
//   - それ以外(SCHEDULED/LIVE/DETECTED/NO_SHOW): 候補行を作らない
//     (検知データが無いか、まだ検知の途中のため次の周回で自然に埋まる)
//
// 冪等: 対象マッチに既に候補行があればスキップする。何度実行しても安全。
import { prisma } from "../src/lib/prisma";
import { isPlainObject } from "../src/event/match-status";

const TAG = "[migrate-match-battle-candidates]";
const MIGRATION_LOCK_KEY = 728_311_005n;

const MANUAL_DECISIONS = new Set(["MANUAL", "DRAW", "BYE"]);
const KNOWN_REVIEW_REASONS = new Set(["AMBIGUOUS", "PARTIAL", "TEAM_BATTLE", "END_UNKNOWN"]);

function reviewReasonOf(rules: unknown): string | null {
  if (!isPlainObject(rules)) return null;
  return typeof rules.reviewReason === "string" ? rules.reviewReason : null;
}

async function main() {
  await prisma.$transaction(
    async (tx) => {
      // web が複数同時に起動しても二重にバックフィルしないようにロックする。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY}::bigint)`;

      const matches = await tx.eventMatch.findMany({
        where: { detectedBattleId: { not: null } },
        select: {
          id: true,
          status: true,
          winnerDecidedBy: true,
          detectedBattleId: true,
          detectedStartAt: true,
          detectedEndAt: true,
          detectionConfidence: true,
          detectedEndSource: true,
          rules: true,
        },
      });

      if (matches.length === 0) {
        console.log(`${TAG} 対象がありません。`);
        return;
      }

      const existingMatchIds = new Set(
        (
          await tx.eventMatchBattleCandidate.findMany({
            where: { matchId: { in: matches.map((m) => m.id) } },
            select: { matchId: true },
            distinct: ["matchId"],
          })
        ).map((c) => c.matchId)
      );

      let created = 0;
      let skippedExisting = 0;
      let skippedNoCandidate = 0;
      let skippedIncomplete = 0;

      for (const m of matches) {
        if (existingMatchIds.has(m.id)) {
          skippedExisting++;
          continue;
        }

        if (m.status === "VOID" || (m.winnerDecidedBy && MANUAL_DECISIONS.has(m.winnerDecidedBy))) {
          skippedNoCandidate++;
          continue;
        }

        const reason = reviewReasonOf(m.rules);
        const hasKnownReviewReason = reason !== null && KNOWN_REVIEW_REASONS.has(reason);
        const isAutoFinished = m.status === "FINISHED" && m.winnerDecidedBy === "AGGREGATE";

        if (!hasKnownReviewReason && !isAutoFinished) {
          skippedNoCandidate++;
          continue;
        }

        if (!m.detectedBattleId || !m.detectedStartAt) {
          skippedIncomplete++;
          continue;
        }

        await tx.eventMatchBattleCandidate.create({
          data: {
            matchId: m.id,
            battleId: m.detectedBattleId,
            startedAt: m.detectedStartAt,
            endedAt: m.detectedEndAt,
            endedAtSource: m.detectedEndSource,
            confidence: m.detectionConfidence ?? "exact",
            selected: isAutoFinished,
            organizerSelected: false,
          },
        });
        created++;
      }

      console.log(
        `${TAG} 作成: ${created}件 / 既存スキップ: ${skippedExisting}件 / ` +
          `対象外スキップ: ${skippedNoCandidate}件 / データ不足スキップ: ${skippedIncomplete}件`
      );
    },
    { timeout: 120_000, maxWait: 30_000 }
  );

  console.log(`${TAG} 完了しました。`);
}

main()
  .catch((err) => {
    console.error(`${TAG} 失敗しました:`, err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
