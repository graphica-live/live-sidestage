# 公開シェアリンクのアバターURLからリスナーのTikTokハンドルが漏れる経路を塞いだ

- date: 2026-09-07
- feature: バトル再生API(P4)
- risk: HIGH
- reviewers: deepseek-v4-flash(Code Mode 2回 / TestCase Mode 1回), fable(Code Mode / TestCase Mode。Codex・Gemini が quota 切れのためユーザー承認のうえ代理)

## change summary

再生ペイロードの公開バリアント(`buildPayload(row, "public", ...)`)で、ギフト送信者のアバターURLを
載せないようにした。`buildFromRow` 側でも公開時は `resolveAvatarUrls("gift_sender", ...)` を呼ばない
(署名の発行自体が無駄になるため)。

## reason

`resolveAvatarUrls` が返すのは Railway Bucket の署名付き GetObject URL で、オブジェクトキーは
`src/lib/avatar-key.ts` の `avatars/gift-sender/<subjectId>.webp`。`subjectId` はリスナーの
`uniqueId`(TikTokハンドル)そのもの。**`senders[].u` を null にしてハンドルを落としても、
`senders[].a` の URL パスに同じ文字列が残る**。

配信者側(`battle_host`)の `subjectId` は anchorId(TikTokの数値 userId)で、これはペイロードの
`anchors` に載せている値そのものなので、公開バリアントでも従来どおりアバターを載せる。

## 検出経緯(重要)

**テストは通っていたが偽陽性だった。** unit は全ケースでアバター Map を空で渡しており、
integration はローカルにバケット設定が無く `resolveAvatarUrls` が早期 return で空 Map を返す
(`src/lib/avatar-storage.ts` の `getMediaBucketClient()` が null)。つまり
「公開ペイロードにハンドル文字列が現れない」という negative check が、
**テスト環境の構成のおかげで通っていた**。本番(バケットあり)でだけ漏れる。

test-auto のテストケースレビュー(Fable, CRITICAL)がこの構造を指摘した。
Code Mode のコードレビューでは両者とも見落としている。

## affected baseline cases

- TC-BRA-015 を新設(公開はアバターURLも載せない。入力に**ハンドル入りURLを与える**)
- Out of Scope の「アバターURL」項を「署名・失効の機構」に限定し、
  「公開URLに subjectId が現れないこと」は対象へ戻した

## VALID / INVALID の重要判断

| finding | 判定 | 対応 |
| --- | --- | --- |
| 公開アバターURLにハンドルが載る(Fable CRITICAL) | VALID | 公開ではリスナーアバターを落とす |
| TC-BRA-026 が存在しないアサーションに帰属し偽 PASS(Fable HIGH / DeepSeek MEDIUM) | VALID | `battle-history.integration.test.ts` に `replay` の3状態を実際にアサート |
| 4ルートに実行可能なテストが1件も無い(Fable HIGH / DeepSeek MEDIUM) | VALID | 4ルートに `route.test.ts` を新設(401 / 404 / 409 / ヘッダ / URL 組み立て) |
| 公開ペイロードから `anchorId` も落とすべき(DeepSeek Code Mode HIGH) | INVALID | 添字の正本かつクライアント `assignFactionColors` のキー。TikTokの数値 userId でハンドルではない |
| `ensureShareToken` に `isReplayable` の門番を入れる(Fable Code Mode MEDIUM) | INVALID | シェアは貢献者一覧モードにも置く仕様。再生不可バトルでもリンクは成立する。挙動を TC-BRA-030 で固定した |

## verification

- `npm run typecheck` PASS
- `npm run test:unit` 1360 PASS(99ファイル)
- `npm run test:integration` PASS
- 本番相当(実バケットあり)での確認は **NOT RUN**。ローカルに `MEDIA_BUCKET_*` が無く、
  署名付きURLの実物を作れない。代わりに unit へハンドル入りURLを直接注入して固定した

## remaining risks

公開再生UI(P5)にリスナーアイコンが出せない。恒久対応は不透明IDのプロキシ
(`/api/public/avatar/<opaque>` 等)だが、P4 の範囲外として先送りした。
プロキシを入れるまで、公開バリアントでアバターURLを復活させてはいけない。
