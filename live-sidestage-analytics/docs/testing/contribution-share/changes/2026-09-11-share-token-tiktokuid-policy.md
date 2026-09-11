---
date: 2026-09-11
feature: 貢献ランキング公開シェア機能 (/c/[token])
---

## change summary

貢献タブのシェアボタン→公開ページ`/c/[token]`実装。公開payloadに`tiktokUid`/`tiktokHandle`を含める(除外は`verified`のみ)。ギフト内訳アコーディオンも公開ページへ再現。

## risk

HIGH (design-review判定。reviewers: Codex-terra medium + DeepSeek + Gemini(agy/gemini-3.7-flash-medium) 並列3体)

## reason / important findings

design-review時点でCodex/Geminiが独立一致でHIGH finding: 公開payloadでのtiktokUid/tiktokHandle露出。既存`battle-replay.ts`の踏襲実装として一旦計画へ反映(非公開化)したが、**ユーザーが明示指示で撤回**:「tiktokハンドル勝手に非公開にするな」。所有者向けランキング(RankingRow)と同一情報(tiktokHandle=プロフィールリンク用、tiktokUid=ギフト内訳キー)を公開ページでも表示する方針へ確定。

その後のcode-review(DeepSeek、task bs8s2hpzn)でも同種のfinding(`contribution-share.ts`のtiktokUid露出、breakdown APIでの任意tiktokUidプロービング)が再度上がったが、以下の理由でINVALID/対応不要と判断:

- tiktokUid/tiktokHandle露出はユーザーが明示承認した意図的仕様(上記)。ランキング自体が既に全員のuid/handleを公開しているため、breakdown APIでの任意uidプロービングも「ランキング外の相手のgiftCount=0」以上の情報を追加露出しない(`queryGiftBreakdown`は空配列を返すのみで、有無以外の識別情報を返さない)
- `verified`フィールドのみ所有者向け表示制御として公開payloadから除外

## affected baseline cases

`docs/testing/contribution-share/baseline.md` TC-CS-003(tiktokHandle表示)、TC-CS-008b/TC-CT-019/020(ギフト内訳アコーディオン)

## reviewers / VALID・INVALIDの重要判断

- design-review: Codex-terra(medium) + DeepSeek + Gemini(agy/gemini-3.7-flash-medium)。HIGH finding(uid/handle露出)→ユーザー指示により意図的採用(公開する)へ方針確定
- code-review: DeepSeek(task bs8s2hpzn, generation_id gen-1789104944-THGfeXjWI4JQ5DZX9YjY)。4 findings中: SSR window guard→ALREADY_HANDLED(コード確認済み)、stale closure→ALREADY_HANDLED(`breakdownsRef`パターン実装済み)、tiktokUid露出/プロービング→INVALID(意図的仕様、上記理由)、heading重複→INVALID(既に`heading`変数で一元化済み)

## verification

typecheck PASS / unit 1595 PASS / integration(公開API) 30 PASS / Playwright(analytics 5画面) / 実機Pixel 7a(mobile、ネットワーク到達不可のためシェア成功パスはNOT RUN、エラーパスのみ確認)

## remaining risks

mobileの実機成功パス(共有→クリップボード→SnackBar)は開発機ファイアウォールでNOT RUN。本番/検証環境到達可能な端末での確認が推奨。
