# 光彩(Kosai) — ホーム画面 採用spec

採用元: `mobile-redesign-directions.html` の `class="D"` フォンモックアップ(貢献タブ代表)。
`comp.png` はこのディレクトリに同梱(Playwrightで `.phone.D` 要素を切り出したもの)。

## カラー

| トークン | hex | 用途 |
|---|---|---|
| `--d-bg` | `#FAF7F5` | 画面背景 |
| `--d-card` | `#FFFFFF` | カード・リスト・chip背景 |
| `--d-ink` | `#2A2130` | 主要文字色 |
| `--d-sub` | `#7C7286` | 補助文字色(ラベル・注記) |
| `--d-line` | `#EFE6E9` | リスト行の区切り罫線(1px) |
| `--d-c1` | `#FF7A59` | グラデーション色1(コーラル) |
| `--d-c2` | `#9B6BFF` | グラデーション色2(バイオレット) |
| `--d-c3` | `#2FC6A0` | グラデーション色3(ミント) |

グラデーションの使い分け(すべて `#FF7A59→#9B6BFF→#2FC6A0` の3色から取る。単色再利用は不可):

- プランバッジ背景: `c1→c2`、90deg線形
- タブ見出し文字: `c1→c2`、90deg、テキストにグラデーションを直接乗せる(単色フォールバック不可。Flutterは `ShaderMask`)
- 選択中chip背景: `c1→c2`
- サマリーカードの合計値の数字: `c1→c2` グラデーション文字
- サマリーカード外枠: `c1→c2→c3`、120deg、2px。内側は白カード(padding 16px)の二重構造
- 1位メダル: `c1→c2`、135deg / 2位メダル: `c2→c3`、135deg / 3位メダル: `c3→c1`、135deg、opacity .85
- アバター枠: `c1→c2`、135deg、1.5px
- ボトムナビの選択中ドット: `c1→c2`、90deg
- コイン数値(リスト行内): `c2` 単色(グラデーションではない。太字)
- 接続中ステータスドット: `c3` 単色

## タイポグラフィ

| 要素 | フォント | サイズ/weight | 備考 |
|---|---|---|---|
| アプリ名(`@tiktokId`)・タブタイトル・プランバッジ | Zen Maru Gothic | 700 | タブタイトルは22px、グラデーション文字 |
| ステータス・chip・リスト・補助文言 | Zen Kaku Gothic New | 400〜500 | |
| サマリーカードの合計値 | Zen Kaku Gothic New | 25px / 800 / letter-spacing -.01em | グラデーション文字 |
| リスト行のコイン数値 | Zen Kaku Gothic New | 13px / 700 | 色は`c2`単色 |
| ニックネーム | Zen Kaku Gothic New | 13.5px / 400 | 1行省略(ellipsis) |

数字はすべて `tabular-nums`(桁揃え)。

## 形状・余白

- サマリーカード: 外枠20px角丸(グラデーション2px枠)、内側カード18px角丸、内側padding16px
- chip / plan-badge / medal / avatar: 999px(完全円形)
- ランキングリスト全体(`rowwrap`): 白背景・角丸18px・box-shadow `0 8px 22px -18px rgba(155,107,255,.3)`。個々の行はカード化せず、`--d-line` 1px罫線でのみ区切る
- リスト行内padding: 上下12px・左右16px、要素間gap 11px
- 影は上記の1箇所のみ。ネオン発光・強い影・ダークグラスは使わない
- アバターサイズ: 30×30px(グラデーション枠1.5px+内側は既存`UserAvatar`をそのまま使う)
- メダル/rankの幅: 26px

## 視覚階層

1. サマリーカードの合計値(グラデーション文字、最大サイズ)
2. タブタイトル(グラデーション文字)
3. ランキング行のコイン数値(単色太字)
4. その他本文・補助テキスト

## 要素・挙動インベントリ

### 要素の全列挙
- **AppBar**: TikTok ID表示(`@${session.streamer.tiktokId}`) / 右上プランバッジ(`FREE`/`PRO`/`ULTRA`、出典: `accountStatus.status.effectivePlan`)
- **ステータスバー**: 接続状態ドット + ラベルテキスト、エラー時は詳細メッセージを追加表示(出典: `SocketStatus` / `_connectionError`)
- **タブ見出し+サブタイトル**: 現在のタブ名 + 期間の説明文(貢献タブは「◯◯のギフト貢献ランキング」的な文言、既存`PeriodSelectorBar`の選択状態から導出)
- **期間セレクタ(chip横スクロール)**: 今日/7日/30日/カスタム(出典: 既存`PeriodSelectorBar`・`AnalyticsPeriodSelection`)
- **サマリーカード**: 表示中の人数 + 合計コイン数(出典: `GiftRankingResult.users.length` / `result.total.totalDiamonds`) + 出典注記「LIVE Sidestage登録後データ」
- **ランキングリスト**: 1〜3位はグラデーションメダル(丸・白文字の数字)、4位以降はプレーンな数字。各行: アバター(グラデーション枠+既存`UserAvatar`)、ニックネーム(`entry.nickname`)、コイン数(🪙+カンマ区切り、`formatDiamonds(entry.totalDiamonds)`)
- **ボトムナビ**: 6タブ(TTS/サウンド/貢献/ギフト/バトル/設定)、選択中タブは`c2`着色+小さいグラデーションドット

### インタラクション
- 期間chipタップ → 期間切替、一覧を再取得(既存`_onPeriodChanged`)
- プランバッジタップ → `SubscriptionScreen`へ遷移(既存`_PlanBadge`の挙動を維持)
- ランキング行タップ → TikTokプロフィールを開く(既存`RankingListTile.onTap` → `openTiktokProfile`)
- pull-to-refresh → 一覧再取得(既存`RefreshIndicator`)
- カスタム期間フィルタ(既存の日時範囲・リスナー名フィルタ)は未言及だが機能として維持する(compには詳細UIが描かれていないため「未定義」、既存のBottomSheet実装をそのまま流用)

### 状態
- **loading**: compに描かれていない → 未定義。既存の`CircularProgressIndicator`表示を維持しつつ、光彩の配色に合わせる(アクセントは`c2`程度)
- **empty**: compに描かれていない → 未定義。既存`EmptyListNotice`の文言・配置を維持
- **error**: compに描かれていない → 未定義。既存`AnalyticsErrorBanner`を維持
- **verified=false(ロック通知)**: compに描かれていない → 未定義。既存`VerifiedLockNotice`を維持
- **長文ニックネーム**: 1行省略(ellipsis)。comp通り
- **件数が多い場合**: comp上は6件だが、実際は`ListView`で可変件数。スクロールで対応(comp通りの構造を維持すれば自然に成立)

### 省略の既定
上記要素はすべて実装に残す。落とす場合はユーザーへ確認する。

## 未解決事項(要判断)

1. **ステータスドットの色**: 既存DESIGN.mdの「Signal-Only Color Rule」(green/orange/red/greyは状態伝達専用)と、光彩のグラデーション3色(c1/c2/c3)は別レイヤー。今回のspecでは接続中ドットに`c3`(ミント)を使うと指定したが、これは実質的に「接続済み=green相当」を`c3`で代替する形になる。**方針: 状態伝達色(接続中/接続エラー/切断)は既存のSignal-Only Color Ruleを維持し、装飾用のグラデーション(c1/c2/c3)とは独立に扱う。** ステータスドットの実装色は「接続済み」文脈で`c3`(ミント)を使うが、これはSignal-Only Color Ruleの「green」を光彩パレット内のミントで代替する解釈であり、エラー時は光彩パレットに無い赤(既存`colorScheme.error`)をそのまま使う。混在するが、状態色は常に既存ルール優先、装飾グラデーションは形状要素(バッジ・メダル・カード枠・見出し文字)にのみ使う、という切り分けで進める。
2. **ダークテーマ**: compはライトのみ。既存DESIGN.mdは「ライト/ダーク同格」が原則。ダーク版のグラデーション配色は本specに含まれない → 実装時に新規決定が必要(未定義)。当面はダークでも同一グラデーション3色を保持し、背景・カード・文字色のみダーマトークンへ切り替える方針で仮置きし、実装後にユーザーへ確認する。
3. **グラデーション文字の実装コスト**: Flutterの標準`Text`ではグラデーション文字を表現できない。`ShaderMask` + `LinearGradient`での実装が必要(タブタイトル・合計値の2箇所)。既存コードに前例なし、新規実装。
4. **サマリーカードの二重枠構造**: 単純な`border`では「グラデーション枠+白い内側カード」を表現できない。`Container`の`decoration`に`gradient`背景を敷き、内側に`padding`で白カードを重ねる構造が必要(既存`CardThemeData`の1px線枠とは別実装になる)。
