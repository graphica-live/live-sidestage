---
last_updated: 2026-09-09
last_risk: HIGH
last_reviewers: [deepseek-v4-flash, fable] / [Code Mode]DeepSeek(high)+Codex-terra(medium)、2026-09-09 admin版シェア発行API追加時
---

# バトル再生API

> **2026-09 の識別子統一リファクタリングにより、以下に記録された本番実測値は無効。**
> `TikTokUser` 導入に伴い `public` / `event` の全テーブルを TRUNCATE したため、
> 監視部屋数・Gift 件数・スコア点数などの実測値は再現できない。次回の実測で置き換えること。
> 手順・判定基準・テストケースの構成自体は有効。

対象: `src/lib/battle-replay-contract.ts`, `src/lib/battle-replay.ts`
(`isReplayable` / `buildPayload` / `ensureShareToken` / `queryBattleReplay` / `queryBattleReplayByShareToken`),
`src/app/api/analytics/battles/[battleId]/replay/`, `src/app/api/admin/rooms/[roomId]/analytics/battles/[battleId]/replay/`,
`src/app/api/public/battles/[token]/replay/`, `src/app/api/analytics/battles/[battleId]/share/`,
`src/app/api/admin/rooms/[roomId]/analytics/battles/[battleId]/share/`(2026-09-09追加。admin版シェア発行API),
`src/lib/battle-history.ts` の `BattleListItem.replay`

再生に必要なデータを**確定時に残す側**は別ベースライン(`docs/testing/battle-replay-data/baseline.md`)。
ここで保証するのは**読み出したペイロードが正しい形であること**と、
**公開シェアリンクから個人を特定できる情報が出ないこと**。

実行方法の略記:

- `[unit]` = `npx vitest run src/lib/battle-replay.test.ts`
- `[itg]` = `npx dotenv -e .env.local.test -- vitest run src/lib/battle-replay.integration.test.ts`
- `[list-itg]` = `npx dotenv -e .env.local.test -- vitest run src/lib/battle-history.integration.test.ts`
- `[route]` = `npx vitest run "src/app/api/public/battles/[token]/replay/route.test.ts" "src/app/api/analytics/battles/[battleId]/replay/route.test.ts" "src/app/api/analytics/battles/[battleId]/share/route.test.ts" "src/app/api/admin/rooms/[roomId]/analytics/battles/[battleId]/replay/route.test.ts" "src/app/api/admin/rooms/[roomId]/analytics/battles/[battleId]/share/route.test.ts"`

## テストケース

| # | ケース | 対象 | 種別 | 前提 | 期待結果 | 実行方法 | 結果 | 備考 |
| - | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-BRA-001 | 確定済み・スコア点あり・窓が妥当・自陣営ありなら再生できる | `isReplayable` | 正常 | 全条件を満たす入力 | `{ available: true, reason: null }` | `[unit]` | PASS | 判定は1箇所に集約し、真偽列はDBに持たない |
| TC-BRA-002 | 未確定バトルは他の値によらず再生不可 | `isReplayable` / `BattleListItem.replay` | 異常 | `BattleHistory` 行が無い | `reason: "not_finalized"`。一覧の未確定行も同じ値 | `[unit]` / `[list-itg]` | PASS | 行の存在そのものが「確定済み」を意味する |
| TC-BRA-003 | スコア点が2点未満なら再生不可。ちょうど2点は可 | `isReplayable` | 境界 | 件数 0 / 1 / 2 | 0・1 は `no_score_points`、2 は可 | `[unit]` | PASS | |
| TC-BRA-004 | 窓が欠けている・30秒未満・30分超なら再生不可。境界ちょうどは可 | `isReplayable` | 境界/データ欠損 | 窓 null / 29,999ms / 30,000ms / 1,800,000ms / 1,800,001ms | 欠損と範囲外は `window_invalid`、境界2点は可 | `[unit]` | PASS | 時間軸が作れない窓を弾く |
| TC-BRA-005 | 参加者2人未満・自陣営なしは再生不可 | `isReplayable` | 異常 | 参加者1人 / 自陣営(teamIndex 0)なし | いずれも `participants_invalid` | `[unit]` | PASS | |
| TC-BRA-006 | スコア点・ギフトイベントは anchor 配列の添字で陣営を指す | `buildPayload` | 正常 | 2陣営のバトル | `anchors` は陣営順・位置順の平坦化。`scorePoints[].a` / `giftEvents[].a` がその添字 | `[unit]` / `[itg]` | PASS | 添字の正本が1つでないと別人のギフトを描画する |
| TC-BRA-007 | participant として存在しない anchorId のスコア点は落とす | `buildPayload` | 異常/データ欠損 | 参加者に無い anchorId のスコア点 | ペイロードに含まれない(例外を投げない) | `[unit]` | PASS | 確定側でも落とすが、participants だけ作り直された行に備える |
| TC-BRA-008 | 同じ送信者・同じギフトは辞書に1件だけ入る | `buildPayload` | 正常 | 同一送信者が同一ギフトを2回 | `senders` / `gifts` とも1件。イベントは添字で参照する | `[unit]` | PASS | 辞書化が転送量削減の根拠 |
| TC-BRA-009 | ギフト表示名は `labelJa` を優先し、無ければ確定時のスナップショット名 | `buildPayload` | 正常/データ欠損 | カタログあり / カタログ無し | あり=`labelJa` と画像URL、無し=`giftNameSnapshot` と `img: null` | `[unit]` | PASS | カタログは **giftId** で引く(名前は670件中29が複数giftIdを持つ) |
| TC-BRA-010 | 窓の外へはみ出したギフトは 0 と窓長へクランプする | `buildPayload` | 境界 | 窓開始前・窓終了後のギフト | `t` が 0 と窓長(300,000) | `[unit]` | PASS | クライアントに時刻演算をさせない |
| TC-BRA-011 | 上限(3000)超のギフトイベントは時系列の先頭から残し `truncated` を立てる。上限ちょうどは立てない | `buildPayload` | 境界 | 3005件 / 3000件 | 3005→3000件で `truncated: true`、先頭が t=0。3000→`truncated: false` | `[unit]` | PASS | バトル序盤が欠けると再生の意味が薄い |
| TC-BRA-038 | コンボの束ね鍵 `k` は anchor・送信者・giftId・`senderGroupId` が揃ったときだけ一致する | `buildPayload` | 正常/境界 | 同一 groupId で別ギフト・別送信者・`groupId: "0"` を混ぜる | 同一4つ組だけ同じ `k`。別ギフト・別送信者は別の `k`。`"0"` と null は `k: null`(単発) | `[unit]` | PASS | クライアントは `k` だけでカードを畳む。`"0"` は TikTok が「グループなし」に使う値 |
| TC-BRA-039 | 倍率刻印 `m` は確定行の値をそのまま載せ、未観測(null)と 0 を区別する | `buildPayload` | 境界/回帰 | `multiplierValue` が 2 / null / 0 のイベント | `m` が `[2, null, 0]` | `[unit]` | PASS | null は P2 デプロイ前の未観測。0(倍率なしと観測)へ丸めると逆算の前提が崩れる |
| TC-BRA-012 | truncate で落としたイベントからしか参照されない送信者・ギフトは辞書に載せない | `buildPayload` | 回帰 | 上限超のイベント列の末尾だけ別の送信者・別ギフト | `senders` / `gifts` に落とされた分が含まれない | `[unit]` | PASS | 辞書を truncate 前に作ると公開リンクに余計なリスナー情報が残る |
| TC-BRA-013 | 公開バリアントは配信者・リスナー双方の TikTokハンドルを載せない | `buildPayload` | negative/セキュリティ | 私的・公開の両方を同じ入力から生成 | 公開は `participants[].uniqueId` と `senders[].u` が全て null。ハンドル文字列がシリアライズ結果に現れない。私的は従来どおり載る | `[unit]` / `[itg]` | PASS | ハンドルはリスナー個人のプロフィールへ直リンクできる |
| TC-BRA-014 | 公開バリアントは `nickName` が無くてもハンドルへフォールバックしない | `buildPayload` | 境界/回帰 | `nickName: null`、`displayId` / `tiktokId` あり | 公開の `displayName` は "配信者"。ハンドル文字列が出ない。私的は `@displayId` | `[unit]` | PASS | `hostProfiles` に anchor が無い確定行で `nickName` は null になる |
| TC-BRA-015 | 公開バリアントはリスナーのアバターURLも載せない | `buildPayload` | negative/セキュリティ | 送信者アバターに `.../avatars/gift-sender/fan_a.webp?X-Amz-...` を渡す | 公開は `senders[].a` が null でハンドル文字列がシリアライズ結果に現れない。私的は URL が載る。配信者アバター(`anchorId` 由来)は公開でも載る | `[unit]` | PASS | 署名付きURLのオブジェクトキーがハンドルそのもの。不透明IDのプロキシを入れるまで公開では出さない |
| TC-BRA-016 | 公開ペイロードは観測メタを一切含まない | `queryBattleReplayByShareToken` | negative/セキュリティ | 実データを確定させてトークン発行 | `roomId` / `battleHistoryId` / `sourceGiftId` / `streamerId` / `captureCoverage` / `captureStatus` / `sourceUpdatedAt` がシリアライズ結果に無い。ニックネームとスコアは残る | `[itg]` | PASS | 許可リスト方式(私的から削る方式にしない) |
| TC-BRA-017 | 陣営スコアは `BattleTeam` の公式スコアを使う | `buildPayload` | 正常/回帰 | 2人陣営(個人3000+2000)に陣営スコア5000 | `teams[].officialScore` が 5000(メンバー1人分の3000にしない) | `[unit]` / `[itg]` | PASS | participant の `officialScore` はメンバー個人の値 |
| TC-BRA-018 | `BattleTeam` を引けない陣営はメンバーのスコア合計へ落とす | `buildPayload` | データ欠損 | `battleTeamId` が null / `battleTeamId` はあるが `BattleTeam` 行が無い | どちらもメンバー合計(5000)。全員 null の陣営は null | `[unit]` | PASS | `battleTeamId` は Expand 段階で nullable。合流で陣営行だけ消える経路もある |
| TC-BRA-019 | 数字以外のスコアは例外を投げずに飛ばす | `buildPayload` | 異常/回帰 | `"1,200"` / `"abc"` を含むメンバー | 例外なし。不正な行を除いた合計。全員不正なら null | `[unit]` | PASS | `BigInt()` は throw する。1行の異常データでそのバトルが恒久 500 になる |
| TC-BRA-020 | 相手陣営のギフト明細が無ければ注記フラグを立てる(再生自体は可能) | `buildPayload` | データ欠損 | 相手側 giftEvents 0件 / 1件以上 | `opponentGiftsMissing` が true / false | `[unit]` / `[itg]` | PASS | 相手room未監視のバトルが多数を占める |
| TC-BRA-021 | 両陣営のギフトを時刻順に併合し、相手側は添字1を指す | `buildPayload` | 回帰 | 両陣営に交互の時刻でイベント | `giftEvents` の `[t, a]` が `[10000,0] [20000,1] [30000,0] [40000,1]` | `[unit]` | PASS | 自陣営(添字0)だけの検証では添字の正しさを保証できない |
| TC-BRA-022 | 初ギフトx倍の帯は区間が実測できたときだけ出す | `buildPayload` | 境界/negative | `openingWindow*` が null / 実測値あり / `confidence: "unknown"` / `measured` だが倍率 null | null・unknown・倍率nullは区間なし。実測値ありのみ帯を作り `showCountdown: true` | `[unit]` | PASS | 60秒は仮定値。仮定から残り秒数を見せない |
| TC-BRA-023 | `inferred` でも区間が実測できていれば帯を作り confidence をそのまま載せる | `buildPayload` | 境界 | `confidence: "inferred"` + 実測区間 | `kind: "opening"` / `confidence: "inferred"` | `[unit]` | PASS | クライアントが赤帯とチップを出し分ける根拠 |
| TC-BRA-024 | ボーナス区間は報酬の開始・終了が揃ったものだけ帯にする | `buildPayload` | 境界/データ欠損 | `rewardStartedAt` / `rewardEndedAt` が欠けた行と揃った行 | 揃った行だけ帯になり `showCountdown: true` | `[unit]` | PASS | `rewardEndedAt` は TikTok が配信する実測値。opening と重なった区間は `segmentAt` が opening を優先する |
| TC-BRA-025 | opening とボーナスが両方あれば開始時刻の昇順で並ぶ | `buildPayload` | 回帰 | opening(0-48s) + bonus(150-180s) | `segments` の kind が `opening` → `bonus_reward` | `[unit]` | PASS | クライアントの「重なったら opening 優先」が並び順に依存する |
| TC-BRA-026 | 確定済みバトルは再生ペイロードを返し、未確定・スコア点なしは理由コードを返す | `queryBattleReplay` | 正常/異常 | 確定済み / armies 無しで確定 / 未確定の battleId | 順に ok、`no_score_points`、`not_finalized` | `[itg]` | PASS | roomId で絞るので他人のバトルは引けない |
| TC-BRA-027 | 実際に読めたスコア点が足りなければ再生不可にする | `queryBattleReplay` | 回帰/競合 | 確定後にスコア点だけ削除し件数列は残す | `no_score_points`(件数列だけを信用しない) | `[itg]` | PASS | ネストした select は1トランザクションにまとまらない |
| TC-BRA-028 | シェアトークンは同時発行しても1本に収まり、2回目以降は同じ値を返す | `ensureShareToken` | 並行/冪等 | 同一バトルへ3並列 + 追加1回 | 4回とも同じ値。48桁の16進(`crypto.randomBytes(24)`) | `[itg]` | PASS | `updateMany({ shareToken: null })` → 読み直しの compare-and-set |
| TC-BRA-029 | 確定していないバトルにはシェアトークンを発行しない | `ensureShareToken` | 異常 | 存在しない battleId | null(行を作らない) | `[itg]` | PASS | |
| TC-BRA-030 | 再生できない確定済みバトルにもトークンは発行する | `ensureShareToken` | 正常/仕様確認 | armies 無しで確定したバトル | 48桁のトークンを返す。そのトークンの再生取得は `no_score_points` | `[itg]` | PASS | シェアは貢献者一覧モードにも置くので、再生不可でもリンク自体は成立する |
| TC-BRA-031 | 公開エンドポイントは存在しないトークンと再生不可を区別しない | `api/public/battles/[token]/replay` | negative/セキュリティ | `ok: false` を返させる | 404 で本文は `{ error: "Not found" }` のみ。理由コードのキーを持たない | `[route]` | PASS | 理由を載せるとトークンの実在有無が漏れる |
| TC-BRA-032 | 公開エンドポイントは成否によらずキャッシュ・索引を禁止するヘッダを付ける | `api/public/battles/[token]/replay` | 正常/negative | 成功・404 の両方 | どちらも `Cache-Control: private, no-store` と `X-Robots-Tag: noindex` | `[route]` | PASS | トークン入りURLのJSONを共有キャッシュに載せない |
| TC-BRA-033 | 私的ルートはセッションと `Streamer.roomId` が揃わなければ 401 / 404 | `api/analytics/.../replay` / `api/admin/.../replay` | negative/認可 | セッション無し / `roomId` が null / admin セッション無し | 401(DBを引かない)、404(再生を引かない)、admin も 401 | `[route]` | PASS | 認可の実装そのものは既存パターン。ここでは順序と副作用の無さを固定する |
| TC-BRA-034 | 私的ルートは再生不可を 409 と理由コードで返す | `api/analytics/.../replay` / `api/admin/.../replay` | 異常 | `queryBattleReplay` が `ok: false` | 409 で `{ error: "Replay unavailable", available: false, reason }` | `[route]` | PASS | 所有者向けなので理由を出してよい(公開は出さない) |
| TC-BRA-035 | 私的ルートは自分の roomId で絞って引く。admin は URL の roomId を使う | `api/analytics/.../replay` / `api/admin/.../replay` | 正常/認可 | セッションのユーザー / admin | `queryBattleReplay("room1", "b1")` が呼ばれ、`Cache-Control: private, no-store` が付く | `[route]` | PASS | 他人のバトルはクエリ段階で引けない |
| TC-BRA-036 | シェア発行はセッション必須で、URLはサーバー側の正準オリジンで組む | `api/analytics/.../share` | 正常/negative | セッション無し / トークン null / 発行成功 | 401(発行しない)、404、`{ url: "<canonicalOrigin>/b/<token>" }` | `[route]` | PASS | `window.location.origin` だと admin・別ホストからの発行でずれる |
| TC-BRA-040 | admin版シェア発行は`getAdminSession()`必須で、本人用と同一レスポンス形状・冪等性を持つ | `api/admin/rooms/[roomId]/analytics/.../share` | 正常/negative/認可/回帰 | adminセッション無し / 存在しないroomId / 存在しないbattleId / 発行成功後の2回目POST | 401(発行しない)、404(roomId)、404(battleId)、`{ url: "<canonicalOrigin>/b/<token>" }`(本人用と同一形状)。2回目も同じURL(再発行しない) | `[route]` | PASS | 認可は`getAdminSession()`のみでroom所有者境界は無い(既存admin routeパターンと同じ、TC-BRA-033と同様の設計判断)。管理者が配信者の同意なしに公開URLを発行できる権限拡張を含む(プロダクトオーナー承認済み、2026-09-09) |
| TC-BRA-037 | 一覧の各行に再生可否が載る | `BattleListItem.replay` / `loadFinalizedBattles` | 正常/回帰 | 確定済み(スコア点あり/なし)・未確定の混在した一覧 | スコア点ありは `{ available: true, reason: null }`、スコア点なしは `no_score_points`、未確定は `not_finalized` | `[list-itg]` | PASS | モーダルを開く前にボタン活性が決まる。追加クエリを増やさず既存 select へ列を足すだけ |

## Quality Gate

- `npm run typecheck`(`tsc --noEmit`)
- `npm run test:unit`
- `npm run db:push:local`(integration の前提。ローカルPostgresへスキーマ反映)
- `npm run test:integration`

## Out of Scope

- 再生UI(`docs/testing/battle-replay-ui/baseline.md`)とシェアページ `/b/[token]`
  (`docs/testing/battle-replay-share/baseline.md`)。`src/middleware.ts` の除外 matcher と
  `middleware.test.ts` のケースはそちらが対象
- `getServerSession` / `getAdminSession` 自体の挙動(既存の共通実装。ルートテストではモックする)
- シェアトークンの失効。初版に入れない判断(列と `shareTokenIssuedAt` だけ持つ)
- `scorePoints` の件数上限。ギフトイベントと違い上限を設けていない。armies の頻度 × 参加者 × 30分が上限で、
  実測が必要になったら契約(`battle-replay-contract.ts`)へ定数を足す
- アバターURLの**署名・失効そのもの**(`resolveAvatarUrls` の既存機構)。
  ただし「公開ペイロードのURLに subjectId が現れないこと」は TC-BRA-015 で対象に入れている
