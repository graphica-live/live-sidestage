# 2026-09-07 バトル再生データの確定・付加(P3)

- **date**: 2026-09-07
- **feature**: battle-replay-data
- **risk**: HIGH（新テーブル + 既存テーブルへの7列追加、確定トランザクションの変更、本番データへのバックフィル経路）
- **reviewers**: Code Mode = deepseek-v4-flash + fable / TestCase Mode = deepseek-v4-flash + fable

## change summary

`BattleHistoryScorePoint` を新設し、確定時に自room窓内の `TiktokBattleArmiesSnapshot` を再生用スコア点として複製する。
あわせて「初ギフトx倍」区間を純関数 `inferOpeningMultiplier` で逆算し、`BattleHistory` の `opening*` 4列・
`replay*Count` 2列へ保存する。確定済みの過去バトルへは全置換ではなく付加専用の `attachReplayData` で後付けする。

## 設計判断（コードだけでは復元しにくいもの）

- **バックフィルを全置換から付加モードへ変えた。** `backfill-battle-history.ts --force` は現在のソース行で上書きするため、
  `absorbRooms` による旧room削除で armies が cascade 消滅したバトルを再確定すると **scorePoints が0件に退行する**。
  `attachReplayData` は participants / giftEvents / teams に触れないので、この退行経路が構造的に消える。
- **`prisma/migrations/` へファイルを残す方針へ変えた。** 本番は `db push` 運用で実行されないが、schema 差分の履歴として置く
  （当初の計画では「無意味な生成物」として作らない予定だった）。
- **逆算は取りこぼしを許容し、誤確定を出さない側に倒す。** 候補条件（区間内ギフトちょうど1件・100ダイヤ以上・
  ボーナス区間外・`multiplierType === 0`）を厳しくし、多くのバトルで `unknown` になる前提。
- **`multiplierType` の `null` と `0` を同一視しない。** P2デプロイ前の全 Gift は null で、TOP_2/TOP_3ブースター(x2)を
  除外できず ratio=2 が「初ギフト2倍」に化ける。null を含む候補は `confidence` の上限を `inferred` に落とす。
- **`openingWindowStartedAt` / `openingWindowEndedAt` は常に null。** 区間長60秒は未確定の仮定値で、
  ここから「残り何秒」を計算して画面に見せてはいけない（列だけ先に持つ）。

## 重要な reviewer 指摘

VALID（修正済み）:

- **同着の並び順で確定が永久に `unstable` になる**（Fable）。armies は1イベントで全anchor分を同一 `occurredAt` で書くため
  同着が常態。`snapshotsEqual` の「配列末尾1点」比較だと返却順の入れ替わりだけで偽の不一致になり、
  再生データが二度と付かない。anchorIdごとの最終スコア比較へ変更（TC-BRD-005）。
- **`startedAtEstimated` を見ていなかった**（Fable）。配信途中から接続した窓の先頭60秒はバトル中盤の通常ギフト区間でしかなく、
  ratio=1 が2件そろうと「倍率なしと判定できた（measured）」が恒久化する。`windowStartReliable` を追加（TC-BRD-018）。
- **lag 未満の位置に届いたギフトの反映先が確定できない**（Fable）。armies=サーバー受信時刻 / Gift=TikTok createTime で
  時刻基準が違うため、増分が t[i] か t[i+1] かを決められない。両区間を候補から外す（TC-BRD-015）。
- **`attachReplayData` の行ロック順**（Fable）。Read Committed で `commitBattleSnapshot` と競合しうるため、
  tx 冒頭で対象行をロックしてから子行を触る。
- **migration ファイルの欠落**（Fable）。
- **行が消えていると FK 違反で落ちる**（DeepSeek 再レビュー）。`locked.count === 0` で `not-found` を返す（TC-BRD-024）。
- **opening 列が非 unknown で永続化される経路にテストが無かった**（Fable / TestCase Mode）。
  `giftEvents → OpeningGift` の写像（`sourceGiftId`・`multiplierType`・自陣営フィルタ）が全て未固定だった（TC-BRD-009）。

INVALID:

- **`hostUserId` が null になると再生データを捨てる**（DeepSeek）。`hostUserId` は fill-once で null へ戻す経路が無く、
  非nullでなければ `BattleHistory` 行自体が作られない。`absorbRooms` も同じ `hostUserId` を持つroom同士しか合流しない。
  ただし防御的分岐が生きていることは TC-BRD-025 で固定した。

## verification

- `npm run typecheck` PASS
- `npm run test:unit` 1317 PASS（94ファイル）
- `battle-history-finalize.integration.test.ts` 25 PASS
- `battle-opening-multiplier.test.ts` 20 PASS（unit に含まれる）

## remaining risks

- **デプロイ順序が固定条件**（計画R6）。`db push` は web 起動時のみ実行されるので、**web を先にデプロイしてから worker**。
  逆順だと worker が新列の無いDBを読んで `P2022` を出す。`commitBattleSnapshot` は interactive transaction なので
  try/catch では握りつぶせず、窓内に終了したバトルは未確定のまま残る（後から `attachReplayData` / 通常 backfill で拾える）。
- `scripts/attach-replay-data.ts` の本番実行は未実施（ユーザーの明示指示待ち）。
- 逆算の実データ精度は検証手段が無い（TikTokが倍率の正解を配信しない）。
- `battle_history_score_points` の行数増（本番armies 37,340行相当）。db-stats の前日比検知が発火しうる。
