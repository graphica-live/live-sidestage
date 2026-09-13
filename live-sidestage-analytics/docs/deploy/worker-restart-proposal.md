# TikTok worker 再起動提案 — 本番 Railway 手順

コード上の worker 再起動提案（import graph ∩ 変更ファイル、CI Job Summary）は **自動で worker を再起動しない**。
本番で GitHub push だけで worker1/2/3 が意図せずデプロイ・再起動しないようにする操作は、**merge 後に人間が Railway で行う**。

> **コード完了 ≠ watchPatterns 削除完了**  
> リポジトリに提案 CLI と CI ステップが入っただけでは、本番の Watch Paths は残っている。  
> 下記を終えてから「本番完了」とみなす。

## 前提（やってはいけないこと）

- **禁止:** GitHub Source のまま **Watch Paths を空**にする（モノレポ全体の push で worker がデプロイされうる）
- **禁止:** push 再起動を避けるために worker1/2/3 を `RAILWAY_ANALYTICS_MANAGED_SERVICE_IDS`（`deploy-railway` の `serviceConnect`）に入れる  
  → main push のたびにイメージ接続＝**毎回 TikTok worker 再起動**になり、提案止まりの方針と矛盾する
- コードから Railway の `watchPatterns` / DeploymentTrigger を書き込む処理は **追加しない**

## 手順（順序を守る）

### 1. 確認（必須・worker1 / worker2 / worker3 それぞれ）

| 項目 | 確認内容 |
| --- | --- |
| Source | GitHub Repo か Docker Image か |
| Auto Deploy | オン / オフ |
| Watch Paths | 現在の一覧（本番 `watchPatterns`） |
| Managed IDs | GitHub Actions variable `RAILWAY_ANALYTICS_MANAGED_SERVICE_IDS` に **当該 worker の service id が含まれていない**こと |

worker の service id が managed 配列に入っている場合は、**watchPatterns を触るより先に**配列から外す（次回以降の `deploy-railway` でその worker に `serviceConnect` されなくなる）。

Source 種別が未確認のまま Watch Paths だけ空にしない。

### 2. GitHub auto-deploy を塞ぐ（**空 Watch Paths の前**）

採用する手段は事実に基づいて選ぶ（デフォルトで空 Watch Paths にしない）。

**推奨**

- GitHub 連携の **Auto Deploy を無効化**（repo 切り離し、または Auto Deploy off）
- または **Docker Image Source** に切り替えてもよいが、その service id を `RAILWAY_ANALYTICS_MANAGED_SERVICE_IDS` に **入れない**

**Dashboard で Auto Deploy を独立に切れない場合のみ**

- Watch Paths をリポジトリに存在しない **sentinel**（例: `.railway/never-match-tiktok-worker`）に設定し、マッチを塞ぐ
- **空配列にはしない**

### 3. Watch Paths をクリア（人手）

手順 1・2 を **3 台すべて**で確認したあと、各 worker の Watch Paths / `watchPatterns` をクリアする（**コードからは書かない**）。

### 4. 動作確認

- analytics 外のダミー push、または Watch Paths に載らない analytics ファイルだけの push で、worker が **新規デプロイされない**ことを確認する

### 5. 再起動は人間が判断

CI またはローカルで `npm run check:worker-restart-proposal`（verify ステップ）が **再起動を提案**した変更のあと、必要なら Dashboard の Restart または手動デプロイで worker1/2/3 を再起動する（TikTok 接続切断を承知する）。

## ローカル確認

```bash
cd live-sidestage-analytics
npm run check:worker-restart-proposal -- --base=origin/main --head=HEAD
```

`--changed-files=<path>` でテスト用に変更一覧を渡せる（`scripts/worker-watch-patterns/cli.test.ts` と同様）。

## 関連ドキュメント

- テスト正本: `docs/testing/worker-watchpatterns-drift-check/baseline.md`
- 計画: リポジトリ `.cursor/plans/20260913-worker-restart-proposal.md`（Batch 03）

## ロールバック

- Watch Paths を空にした場合: Dashboard で旧パターンを戻す、または auto-deploy を再度有効化する前に手順 2 を見直す
- 誤って worker を `RAILWAY_ANALYTICS_MANAGED_SERVICE_IDS` に入れた場合: 配列から ID を除去する