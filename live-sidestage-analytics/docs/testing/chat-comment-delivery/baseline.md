---
feature: コメント配信（TikTok chat → Worker → Web → mobile）
last_updated: 2026-09-07
last_risk: MEDIUM
last_reviewers: deepseek-v4-flash
---

# コメント配信 テストベースライン

TikTok の `chat` イベントを Worker が受け、`POST /api/internal/gift-event` で Web へ転送し、
Web の socket.io が `chat:{streamerId}` ルームへ `chat:comment` として配信するまでの経路。

転送の delivery semantics は best effort（`forwardToWeb()`）。転送スロットは worker プロセス全体の
共有枠（`FORWARD_MAX_CONCURRENCY = 4` / `FORWARD_MAX_QUEUE = 256`）で、like / gift / follow と奪い合う。
枠を溢れた分は無言で捨てられるため、**1イベントあたりのリクエスト数を増やさないことが仕様の一部**。

## テストケース

| ID | 観点 | 前提 | 操作 | 期待結果 | 実行方法 | 結果 |
| --- | --- | --- | --- | --- | --- | --- |
| TC-CCD-001 | まとめ送信（正常系） | 同一 room を 3 人の Streamer が購読、Worker プロセス（`WEB_INTERNAL_URL` あり） | `chat` を1件受信 | Web への転送は**1リクエストのみ**。body に購読者3人分の `streamerIds` と `chatCommentEvent` が入る | `npx dotenv -e .env.local.test -- vitest run src/lib/tiktok-listener.chat-forward.integration.test.ts` | PASS |
| TC-CCD-002 | 旧形式を送らない（回帰） | 同上 | `chat` を1件受信 | 転送 body に単数形 `chatEvent` は含まれず、`chatCommentEvent` に `streamerId` も入らない | 同上 | PASS |
| TC-CCD-003 | 転送失敗時の再送 | `msgId` を持つコメント。1回目の転送が `TypeError: fetch failed` で失敗 | `chat` を1件受信 | 転送は計2回で打ち切られる（1回だけ再送し、成功後は追撃しない） | 同上 | PASS |
| TC-CCD-004 | msgId 無しは再送しない（境界） | `msgId` が protobuf 既定値 `"0"`（`resolveMsgId()` が null に倒す）。転送は常に失敗 | `chat` を1件受信 | 転送は1回のみ。Web 側 dedup が msgId 基準で効かず、再送すると端末で二重に読み上げられるため | 同上 | PASS |
| TC-CCD-009 | 非2xx応答でも再送（境界） | `msgId` を持つコメント。1回目の転送が 500 を返す | `chat` を1件受信 | 転送は計2回で打ち切られる | 同上 | PASS |
| TC-CCD-010 | 内部APIのまとめ受け口（正常系） | `streamerIds` 3件 + `chatCommentEvent` | 内部 API に POST | 200。`emitChatComment` が各 streamerId 付きで3回呼ばれる | `npx vitest run src/app/api/internal/gift-event/route.chat-comment.test.ts` | PASS |
| TC-CCD-011 | 内部APIの異常系 | `streamerIds` 欠落 / 空配列 / secret 不一致 | 内部 API に POST | 順に 400 / 400 / 401。いずれも配信しない | 同上 | PASS |
| TC-CCD-012 | socket.io 未初期化（異常系） | `emitChatComment` が false を返す | 内部 API に POST | 503 を返す（Worker 側が失敗を検知できる） | 同上 | PASS |
| TC-CCD-005 | 購読者ゼロ（異常系） | `subscriberIds` が空の room | `chat` を1件受信 | 内部 API を呼ばない（`streamerIds: []` で 400 を出さない） | `npm run test:unit` / 実装上 `notifyChatComment` の早期 return | NOT RUN: 購読者ゼロの room は `startListener` の前提を外れるため integration ハーネスで再現できない。早期 return をコードで担保 |
| TC-CCD-006 | Web/Worker 同居時（回帰） | `WEB_INTERNAL_URL` 未設定（ローカル単一プロセス / dev） | `chat` を1件受信 | HTTP を経由せず `emitChatComment()` を購読者ごとに直接呼ぶ | `npm run test:unit`（`chat-feed.test.ts` が emit 側の契約を固定） | PASS |
| TC-CCD-007 | 端末への重複配信抑止（回帰） | 同一 `msgId` のコメントが Web へ2回到達 | `emitChatComment()` を2回呼ぶ | `chat:comment` の emit は1回だけ | `npm run test:unit -- chat-feed` | PASS |
| TC-CCD-008 | 旧 Worker 互換（境界） | デプロイ中に旧 Worker が単数形 `chatEvent` を送る | 内部 API に `chatEvent` のみの body を POST | 従来どおり `emitChatComment` が1回呼ばれる | `npx vitest run src/app/api/internal/gift-event/route.chat-comment.test.ts` | PASS |
| TC-CCD-013 | 枠溢れ時は再送しない（境界） | 転送キューが `FORWARD_MAX_QUEUE` を超えている | `chat` を1件受信 | 転送を試みず破棄する（再送もしない） | 実装上、再送ループは `acquireForwardSlot()` 成功後にのみ入る構造 | NOT RUN: 256件のキュー溢れを integration ハーネスで安定再現できない。構造で担保 |

## Quality Gate

`npm run typecheck` / `npm run test:unit` / `npm run test:integration`

## Out of Scope

- 同一 room に listener が二重に張られる事象（Web ログの `[chat] dedup: duplicate skipped (web process)` が
  同一 msgId × 複数 streamerId で連続記録される）。本変更とは別原因で、別途調査する
- 転送スロットの優先度分離（like が chat を押し出さないようにする）。本変更でリクエスト数を減らした効果を
  本番で計測してから判断する
