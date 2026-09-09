---
project: live-sidestage-analytics
feature: battle-share
last_updated: 2026-09-10
last_risk: LOW
last_reviewers: DeepSeek
---

# テストベースライン: battle-share

`BattleDetailModal.tsx` の `ShareButton`。バトル履歴一覧・バトル再生画面の両方から共有リンクを発行してクリップボードへコピーする。ボタンは矢印アイコンのみ(文字ラベル無し)で表示する。

## テストケース

| ID | 目的 | 対象 | 観点 | 前提・入力 | 期待結果 | 実行方法 | 結果 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TC-BSH-001 | 共有ボタンが文字ラベル無しのアイコンのみで表示される(idle/copied共通) | `ShareButton`(idle・copied状態) | UI | バトル履歴詳細モーダルを開く(`view="list"`または`view="replay"`) | ボタン内にテキストが表示されず、矢印アイコン(SVG)のみが見える。クリックしてcopied状態になってもアイコンの見た目は変わらない(テキストが出現しない) | Playwright実機確認 | PASS | screenshot 提示済 |
| TC-BSH-002 | アイコンのみでもスクリーンリーダー・ホバー時に用途が分かる | `ShareButton` | 正常 | idle状態でボタンを検査 | `aria-label="共有リンクをコピー"` と `title="共有リンクをコピー"` が設定されている | Playwright実機確認(`getByRole('button', {name: '共有リンクをコピー'})`が取得できる) | PASS | |
| TC-BSH-003 | クリックでコピー成功後、ラベルが状態に応じて変わる | `ShareButton`(copied状態) | 正常 | クリックし共有APIが成功、`navigator.clipboard`が使える | `aria-label`/`title`が`"コピーした"`に変わる。2秒後にidleへ戻る | Playwright実機確認 | PASS | |
| TC-BSH-004 | clipboard API 非対応環境ではURLを手動コピーできる | `ShareButton`(manual状態) | 異常 | `navigator.clipboard`が存在しない | アイコンボタンの下に読み取り専用の共有URL入力欄が表示される(アイコン変更の影響を受けない) | 既存ロジックのコードレビューで確認(手動コピー分岐は今回改修対象外) | PASS | |
| TC-BSH-005 | 共有API失敗時のエラー表示は維持される | `ShareButton`(error状態) | 異常 | 共有APIが失敗(非200)またはfetch例外 | アイコンボタンの下に「共有リンクを発行できなかった。」が表示される(アイコン変更の影響を受けない) | 既存ロジックのコードレビューで確認(エラー分岐は今回改修対象外) | PASS | |

## Quality Gate

- `npm run typecheck`
- `npm run test:unit`

## Out of Scope

- 共有リンク発行API(`/api/analytics/battles/:id/share`)自体の挙動 — 今回はボタンの見た目のみ変更
