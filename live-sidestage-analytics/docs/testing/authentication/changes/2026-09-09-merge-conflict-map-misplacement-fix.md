---
date: 2026-09-09
feature: authentication
risk: CRITICAL
---

# マージ統合時に発覚した @@map 誤配置の修正

## 変更概要

`worktree-rename-user-to-principal`（Prisma model `User`→`Principal` rename、`@@map("User")`で物理テーブル名維持）をmainへマージする際、`prisma/schema.prisma`が**コンフリクトマーカー無しで自動マージ成立**したが、`@@map("User")`ディレクティブが`Principal`モデルから外れ、main側で同時期に新規追加された無関係な`RefreshTokenReplay`モデルの内側へ誤って取り込まれていた。

## 理由

renameブランチの`Principal`モデル末尾（`@@map("User")`直後）とmain側新規追加の`RefreshTokenReplay`モデルが隣接する行位置にあったため、git 3-way mergeが行を誤って結合した。放置していれば次のmigrationで`Principal`（旧User、認証データ本体）が新規空テーブルを指し、`RefreshTokenReplay`が既存`User`物理テーブルを指す状態になり、認証データの実質的な喪失・破損に至る重大障害だった。

## 検証

code-reviewでDeepSeek（openrouter-review.mjs、reasoning-effort high）がCRITICAL指摘。renameブランチ側とHEAD側を`git show`で実ファイル比較し、実バグと確定。Codex（terra/medium）は同じレビューでこの問題を検出せず、別の2件（誤ったuntracked判定・LOW、いずれもINVALID）のみ返した。

## 対応

`@@map("User")`を`RefreshTokenReplay`から`Principal`モデルへ移設。Prisma Client再生成・ローカルテストDBへのpush・全2431件のunit/integrationテスト再実行で回帰なしを確認。

## 影響を受けたbaselineケース

新規保証条件の追加は無し（rename前後で振る舞いが変わらないことを保証する既存の方針のまま）。今回の発見はrename作業自体でなく、**マージ手順（3-way auto-merge）固有のリスク**。教訓は `merge-automerge-prisma-map-misplacement.md`（ユーザーmemory）に記録済み。

## 副次的に見つかった rename 未適用箇所

同じマージで以下2ファイルもrename未適用のまま自動マージされていた（コンフリクトなし）。テストDBリセット後の全件テストで検出・修正:

- `src/lib/mobile-auth.test.ts` — Prismaのフェイクモックオブジェクトが`user`キーのまま（`principal`へ修正）
- テストDB自体が旧schemaのまま残留していたことによる211件の連鎖的テスト失敗（`prisma generate` + `db push --accept-data-loss` で解消）
