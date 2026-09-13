# 光彩(Kosai) — バトル貢献者シート再生CTA 採用spec

採用: 2026-09-14。ユーザー指示「詳細の貢献者上に大きい再生」「表の小さい再生は消す」「貢献者の縦幅を広げる」。
comp: comp.png（提案フォン。シートが画面の約88%）。HTML原案: comp.html。
共通トークン: ../_kosai-tokens.md。

変更履歴: 初版。カードフッターの縮小 TextButton（16dp アイコン / shrinkWrap）はユーザー明示で廃止。

## 視覚仕様（数値）

### シート外形
- 高さ: 画面高さの 88%（MediaQuery.sizeOf.height * 0.88）
- 上角丸: 20dp（既存ボトムシート / tokens §4）
- 背景: card #FFFFFF / dark #1F1B24
- 上内側余白: 16dp
- 下内側余白: 8dp
- 横パディング（CTA・見出し）: 16dp

### 再生CTA（再生可能時のみ）
- コンポーネント: KosaiPrimaryButton（.btn-primary-grad）
- ラベル: 「再生」 白 #FFFFFF 17dp w800
- アイコン: Icons.play_arrow 白 20dp（fontSize+3）
- アイコンとラベルの gap: 8dp
- 縦パディング: 18dp（ボタンの見た目高さ 約54dp。最低タップ 48dp 以上）
- 横: 親幅 - 32dp（左右16）
- 角丸: 999
- 塗り: c1 #FF7A59 → c2 #9B6BFF 90deg
- 影: c2 @0.55 blur 22 offset (0,10) spread -10
- CTA下〜見出し: 12dp
- busy: 白 CircularProgressIndicator 18dp stroke 2。opacity 0.45 で無効見た目

### 見出し
- 「このバトルの貢献者」 ink #2A2130 / 16dp / w700 / 中央
- 見出し下: 8dp

### 貢献者リスト
- CTA・見出しの残り全部を Expanded に渡す（固定 380dp を使わない）
- 行: 既存 RankingListTile（貢献タブと同一。メダル / アバター / 名前 / ハンドル / コイン）
- 行区切り: divider #F1EBEE 1dp
- 情報密度: 1行 順位・顔・表示名・ハンドル・コインの5情報。変更しない

### カード（一覧）
- フッターは日時+ステータスのみ。11dp sub #7C7286 中央
- 「再生」チップは出さない
- その他のカード数値は attle-history-kosai/spec.md のまま

## 視覚階層
1. シート先頭の再生CTA（再生可能時）
2. 見出し「このバトルの貢献者」
3. 貢献者リスト

## 要素・挙動インベントリ

1. ドラッグハンドル（OS/シート既定）
2. 再生ボタン — 出典 BattleSummary.replay.available==true。タップで etchBattleReplayShareUrl → BattleReplayWebViewScreen
3. 見出し「このバトルの貢献者」
4. 貢献者一覧 RankingListTile — GET バトル貢献者 API
5. 陣営タブ（teams が2以上のとき） — 既存
6. カード本体 — タップでこのシート。再生は持たない

画像素材: なし（Material アイコン + KosaiPrimaryButton）

### インタラクション
- カードタップ → 高さ88%のシート
- 再生タップ → share URL 取得 → WebView push。シートは残す（戻ると貢献者）
- 再生連打 → _replayBusy 中は onPressed null
- シート外タップ / 下へドラッグ → 閉じる（既存）

### 状態
- replay.available false: CTA 非表示。見出しが先頭
- replay loading: CTA busy スピナー
- replay error: SnackBar。遷移しない
- contributors loading: リスト領域中央の CircularProgressIndicator
- contributors empty: EmptyListNotice「このバトルの貢献者はいません」
- contributors error: AnalyticsErrorBanner + retry
- 多件数: リスト領域をスクロール。CTA は固定

省略の既定: ゼロ。カード再生チップのみユーザー明示で削除。

## 未解決
なし。実機スクショ照合は Compare 工程。
