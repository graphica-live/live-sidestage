# 変更履歴: Web版 POST /api/verify/generate のtiktokUid追従漏れ修正

## メタデータ

- **Date**: 2026-09-11
- **Feature**: tiktok-id-change-lock (web版ハンドル変更時のtiktokUid追従)
- **Commit**: (Batch 01/02完了時に記載)

## 変更要約

Web版の `POST /api/verify/generate`（TikTok ID登録・変更API）で、ハンドル変更時に実在確認で取得済みの新しい`tiktokUid`をフィールドへ書き込んでいない実装漏れを修正。

本日mainへマージ済みのmobile版同種修正(`PATCH /api/mobile/streamer`、commit `a29d8d6c`/`f68f5c74`)と全く同じ根本原因を持つ。修正後は、ハンドル変更のたびに`Streamer.tiktokUid`が検証済みの現在値へ正しく追従し、`resolveRoomForStreamer()`が新アカウントの`TiktokRoom`へ正しく付け替わることを保証する。

**修正内容**:
1. 冪等分岐（正規化後に値が変わらない場合）: `tx.streamer.update()`の`data`へ`tiktokUid: registerTiktokUid`を追加
2. 実際のハンドル変更分岐: `tx.streamer.updateMany()`の`data`へ`tiktokUid: registerTiktokUid`を追加
3. コメント修正: 「`tiktokUid`は不変なので更新もしない」という誤った前提を削除し、`resolveRoomForStreamer()`のキー値であることを明記

## リスク分類

**全体Risk: HIGH**

理由:
- DB書込み・認証所有権判定に近い領域（`principalId`/`tiktokUid`/`tiktokHandle`の3語彙の一角）
- ただしmigration不要、既存UPDATE文への1フィールド追加のみで、`git revert`で安全に戻せる
- **CRITICALではない**（revert/通常rollbackで復旧不能でない）

web版はmobile版と異なり「`verifiedTiktokUid`がnullになりうる」という追加のfail-closedガードが構造的に不要なため、実装の複雑度はmobile版より軽い。

## 修正理由

mobile版で確認された以下のバグが**web版にも同じ根本原因・同じ実害経路で存在した**:

1. **実装漏れの場所**: 冪等分岐・実際のハンドル変更分岐の両方で`registerTiktokUid`を`tiktokUid`フィールドへ書き込んでいない
2. **実害**: `resolveRoomForStreamer()`は`Streamer.tiktokUid`をキーに現在のroomへの一致を判定し、一致していれば新しいroom解決処理をスキップする。`tiktokUid`が更新されない限り、ハンドルを何度変えても常に最初に登録したアカウントのroomへ紐付き続ける

### 誤った前提（実装コメント）

140-142行目: 「`tiktokUid`は不変なので更新もしない」

**実際の真実**:
- TikTok上の`tiktokUid`の値自体は不変（ユーザーが変えられない）
- **DBへの追従書込みを禁じる意味ではない**
- `resolveRoomForStreamer()`が正しいroomへ解決するため、検証済みの現在値を常に書く必要がある

## 影響を受けるテストケース

| テストID | 変更内容 |
| --- | --- |
| TC-LOCK-104 | assertion追加: `tiktokUid`が実質無変化（同一アカウント）ことを明記 |
| TC-LOCK-702 | 期待値反転: `tiktokUid`が登録済み値で**不変** → **mocker値(新値)へ更新**へ修正（test assertion と実装を一致） |
| **TC-LOCK-106** | **新規追加**: room再解決の実証。ハンドル変更後、Streamer.roomIdが旧roomから新roomへ付け替わることを検証 |
| **TC-LOCK-107** | **新規追加**: 大文字小文字のみ変更した場合、冪等分岐を通ってもtiktokUidがmocker値へ更新されることを検証 |

## レビュー実績

### Design Review

**完了**: 2026-09-11（計画作成と同日に先行実施）

**Reviewers**:
- DeepSeek (openrouter/deepseek/deepseek-v4-flash@high): **NO ISSUES**
- Codex-terra (HIGH risk): **MEDIUM finding x2 + LOW finding x1 — 全てVALID**

**主要な指摘（VALID）**:

1. **MEDIUM finding 1**: 冪等分岐はCAS化しないべき（design-review時点の修正予定が「冪等分岐をupdate()→updateMany(CAS)化」だったが）
   - **根拠**: この分岐は`tiktokHandleChangedAt`を更新しないため、それをwhere条件に使っても同じ値を読んだ2リクエストは両方マッチしてしまい実効的な競合検知にならない。Streamerに`updatedAt`等のversion列も無い
   - **反映**: 冪等分岐は`update()`のまま`tiktokUid: registerTiktokUid`追加のみに変更。この分岐が扱うのは「ハンドルが実質不変」なケースなので、registerTiktokUidは同一アカウントの実在確認結果であり同時リクエスト間でも同じ値→後勝ちでも実害限定的

2. **MEDIUM finding 2**: `resolveRoomForStreamer`のglobal mock を`vi.fn()`化してから`mockImplementationOnce`を使うべき
   - **根拠**: mobile版テストファイルは既に`vi.fn(async () => ...)`だったが、web版は通常の非同期関数なため`mockImplementationOnce`が使えない
   - **反映**: テストファイル冒頭のmockをvi.fn()化。TC-LOCK-106でこの仕組みを活用

3. **LOW finding**: TC-LOCK-106で作成するroom A・Bは`finally`ブロックで明示的に削除すべき
   - **根拠**: 既存`cleanup()`はStreamer/Principalのみ削除しroomを扱わないため
   - **反映**: TC-LOCK-106にfinallyブロックを追加

### Code Review

**完了**: 2026-09-11（実装後diff、HIGH risk）

**Reviewers**:
- DeepSeek (openrouter/deepseek/deepseek-v4-flash@high、`--testcase-file baseline.md`同時実施): finding 5件、うち2件VALID
- Codex-terra (HIGH risk): finding 3件（HIGH x2、MEDIUM x1）、うち1件VALID・1件は既存仕様の範囲内・1件は元コードから存在する既存パターン

**主要な指摘（VALID → 反映）**:

1. **Codex HIGH / DeepSeek MEDIUM（同一論点）**: 冪等分岐(正規化後ハンドル同一)が`checkTiktokUidMatch()`を一切通さずに`tiktokUid`を書き込んでいた
   - **根拠**: mainへマージ済みのmobile版最終実装(`f68f5c74`)は、ハンドルが生文字列レベルで変わる場合(大文字小文字のみの変更を含む)に`checkTiktokUidMatch()`を通してから`tiktokUid`を書く設計。web版は正規化後同一を「冪等リトライ＝チェック不要」として、このチェックを素通りする経路になっていた。`TIKTOK_UID_MISMATCH_CHECK_DISABLED="0"`で本チェックが将来有効化されても、この分岐だけ検知をすり抜ける論理的欠陥
   - **反映**: `checkTiktokUidMatch()`呼び出しを冪等分岐・通常分岐の両方に共通で適用されるよう、分岐判定より前へ移動

2. **DeepSeek MEDIUM**: TC-LOCK-106のroom A・B cleanupがtry/finallyで保護されておらず、assertion失敗時にroom leakする
   - **反映**: try/finallyでcleanupを保護

**検討したが不採用/対応済み**:

- **Codex HIGH**: 「`TIKTOK_UID_MISMATCH_CHECK_DISABLED`が既定無効化のままだと、任意ユーザーが公開ハンドルを指定するだけで`tiktokUid`を他人のアカウントへ書き換えられる」— mobile版(`f68f5c74`)でも同一構造が既にmainへマージ済みの既知仕様（`checkTiktokUidMatch()`自体は無効化フラグの間は常に`ok:true`を返す設計）。今回のスコープ（tiktokUid追従漏れの修正）を超えるプロダクト判断（無効化フラグ自体の運用方針）のため対応せず、Remaining Risksへ記載
- **Codex MEDIUM**: 「`resolveRoomForStreamer()`がStreamer更新トランザクションの外で実行され、失敗時に補償処理が無い」— 修正前の元コードから存在する既存パターン（mobile版も同型）で、今回の変更で新規に生まれた問題ではないため対応せず
- **DeepSeekの他findingは低優先度**: TC-LOCK-107のroomId未検証(LOW)は対応せず（TC-LOCK-106で room 再解決自体は別途カバー済み）

### Test Auto (TestCase Mode)

DeepSeek Code ModeへTestCase Mode相当(`--testcase-file baseline.md`)を同時実施済み（上記Code Reviewに統合）。

## 検証結果

### 単体テスト (route.integration.test.ts)

- TC-LOCK-104: **PASS** — tiktokUid不変assertion追加
- TC-LOCK-702（既存テスト・期待値反転）: **PASS** — tiktokUidが新値へ更新
- TC-LOCK-106（新規）: **PASS** — room再解決の実証
- TC-LOCK-107（新規）: **PASS** — 大文字小文字のみ変更でtiktokUid追従

### 全体検証コマンド

```bash
npm run typecheck              # PASS
npm run test:unit             # PASS (116 files / 1554 tests)
npm run test:integration      # PASS (101 files / 953 tests)
```

### worktree同期メモ

このworktreeは作業途中でmainの最新(mobile版修正`f68f5c74`を含む)から取り残されていたことが判明したため、
`git merge main`でmainを取り込み、baseline.mdのマージコンフリクト(TC-LOCK-702の記述、mobile側マージと同時期の編集による)を解消した。
mainマージにより`WORKER_COUNT`/`WORKER_INDEX`/`MOBILE_JWT_SECRET`/`REFRESH_TOKEN_REPLAY_ENC_KEY`を要求する
integrationテストが新たに含まれるようになったため、このworktreeローカルの`.env.local.test`(git管理外)へ追記した。

## 未解決事項・Remaining Risks

1. **過去に誤った`tiktokUid`のまま孤立した`TiktokRoom`行**: 修正前に別アカウントのgiftが誤ったroomへ流れ込んでいた可能性（mobile版修正時も同様に「対象外」）。web版で実際に影響を受けたユーザーがいるかどうかの実データ調査は本タスクのスコープ外

2. **web版とmobile版の非対称性**: web版は「常に無条件で実在確認を実行する」設計のままだが、mobile版は「ハンドルが実際に変わる時だけ実行する」（将来のリファクタリング検討課題として別途提起が必要）

3. **Batch 01の設計判定に基づく現行制約**: 
   - `TIKTOK_UID_MISMATCH_CHECK_DISABLED`による別アカウント付け替え防止は一時無効化のまま
   - `checkTiktokUidMatch()`のロジック自体は今回未変更
