# BattleDetailModal — 対戦相手陣営の貢献者一覧 spec

対象: `src/app/(dashboard)/analytics/BattleDetailModal.tsx`
comp: `comp.png`（同ディレクトリ, `comp.html` はインタラクション確認用の元Artifact）
承認日: 2026-09-05 / **再凍結: 2026-09-05（col-head統合score/diamond、WINバッジ、陣営カラー、上下分割線の統合を反映）**

## 視覚仕様（DESIGN.mdトークンをそのまま採用。実測hexも併記）

既存 `BattleDetailModal.tsx` の DESIGN.md準拠トークンをそのまま踏襲する。新規に導入する色はない。

| 用途 | トークン | hex |
| --- | --- | --- |
| モーダル背景 | `bg-panel` | `#1a1a1a` |
| モーダル境界 | `border-white/10` | `rgba(255,255,255,.1)` |
| 本文テキスト | `text-strong`/既定 | `#f0f0f0` |
| 補助テキスト | `text-muted` | 実測 `#9a9ea6`相当（既存`text-muted`トークンをそのまま使う） |
| もっとも薄いテキスト | `text-faint`相当 | 実測 `#6b6f76`相当 |
| アクセント（自分の勝ちスコア等） | `text-brand` | `#fe2c55` |
| 警告（partial系） | 既存`status-warning`相当 | `#eab308` |
| 成功（complete） | 既存`status-success`相当 | `#22c55e`系（実測 `#4ade80`相当） |
| セクション区切り線 | `border-border` | `#2a2a2a` |
| 行ホバー | `hover:bg-row-hover` | `rgba(255,255,255,.02)` |
| 自陣営カラー（固定） | 新規 `--fc-self` | `#fe4d4d` |
| 相手陣営カラー1（スコア1位） | 新規 `--fc-1` | `#4d9fff`（青） |
| 相手陣営カラー2（スコア2位） | 新規 `--fc-2` | `#ffa64d`（橙） |
| 相手陣営カラー3（スコア3位） | 新規 `--fc-3` | `#b98aff`（紫） |
| WINバッジ（勝利陣営マーク） | 新規 `--gold` | `#f5c451` |

- 角丸: モーダル本体 `rounded-xl`(12px)、バッジ・ボタンは `rounded-full`/`rounded-lg`(8px) — 既存コンポーネント既定のまま変更なし
- 数値（🪙合計・バトルスコア）は必ず `font-mono`
- 貢献者セクション見出し行は `text-xs text-muted`、陣営列見出し（col-title）は `text-[11px] font-semibold text-muted`
- **陣営カラーの適用範囲**: `col-title`のドット+文字色、貢献者行の展開キャレット（`contrib-caret`）、参加者セレクタ（`side-select`）のアクティブボタン枠、貢献者アバター枠（`contrib-avatar`、`color-mix`で薄める）に一貫して同じ陣営色を使う。自陣営は常に赤固定、相手陣営はバトルスコア降順で青→橙→紫を割り当てる

### 余白（実測、Artifact上のpx。実装は既存Tailwindスケールの近似値に丸めてよい）

- 貢献者セクションと上部（対戦表）の間: `margin-top:20px;padding-top:16px`（**水平の区切り線 `border-top` は削除済み** — 上下を貫通する縦分割線と並存すると視覚的に不要なノイズになるため、1vs1を含む全パターンで水平線なし）
- 陣営列間のgap: `16px`（`gap-4`）
- 陣営列見出しと貢献者リストの間: `8px`（`mb-2`）
- 貢献者行内padding: `4px`（既存 `py-1.5` 相当から詰める。行全体がボタンになるため）
- ギフト明細（展開時）の左インデント: `30px`（アバター分の桁を空けて左ボーダーで従属を示す）
- **上部対戦表〜下部貢献欄を貫通する縦分割線**: 幅1px・色`var(--border)`・カード左右中央（50%）に配置。対戦表エリアの高さ全体（VSバッジ/circle部分含む）から貢献欄の最下部まで1本で continuous。対象は1vs1（メインモーダル）・1vs2・1vs3・2vs2。**1vs1vs1vs1（個人戦、4陣営を2x2で表示するパターン）のみ対象外** — 個人戦は上部が`team-versus-quad`という別構造（2x2グリッド＋中央VS circle）で、下部の2列貢献欄と列の対応関係が無いため分割線を貫通させない

### タイポ

- 陣営列見出し: 11px / 600 / `text-muted`（陣営カラー時はそのカラー）
- 貢献者名: 12px / 500
- 🪙合計: 11.5px / `font-mono`
- バトルスコア（col-head内、🪙合計より大きく強調）: 15px / 700 / `font-mono` / 陣営カラー
- ギフト明細行: 10.5px（時刻のみ `font-mono` 10px）
- captureStatusバッジ: 10px
- WINバッジ: 10px / 700 / letter-spacing付き / 金文字+グロー（`text-shadow`/`box-shadow`。プロジェクトの「装飾少なめ」原則の例外として、ユーザーが明示的に「目立つ感じに」と要求したため採用）

## 要素・挙動インベントリ

### 対戦表（上部、versus-header）
- 自分側/相手側（複数陣営時は各陣営）をカード化（`border`+`background:panel-2`）して左右（3陣営以上は必要に応じ複数）に並べる
- **WINバッジ**: 決着がついている場合、勝利陣営のカード右上（相手側は左上）に金色の「WIN」リボンを表示。負けた陣営のスコアを暗くする表現は不採用（一度試作したが「暗くしないでほしい」というフィードバックでWINバッジ方式に変更した経緯がある）。決着未確定（`unavailable`等で勝敗不明）の場合はどちらにも付けない
- 陣営内複数人は縦積み（アバター+名前）で表示する既存`BattleTeamColumn`のまま。**本改修に伴い `opponent.count > 1` による「複数人バトル(n人)」への丸め表示は廃止**。`teams`が取得できる限りは常に陣営別（2列以上）表示に切り替える

### 貢献者セクション全体
- 見出し「貢献者」+ 補助テキスト「🪙降順」（出典: 既存の並び順仕様そのまま）
- 陣営列: **可変数**（1〜N）。`BattleListItem.teams: BattleTeam[]` の要素数ぶん生成する。**2列固定にしない**
- sm以上(≥480px相当): 全陣営列を横並びgrid表示。480px未満: タブ切替（後述の「未解決」参照）

### 陣営列（1列あたり）
- 列見出し行1段目: 陣営名 + captureStatusバッジ
  - 陣営名: `isSelf`なら「自分」固定。相手側は既存基準（ニックネーム→@handle→不明）。陣営内に複数配信者がいる場合は「代表者 他n人」（代表者=陣営内先頭のparticipant）
  - captureStatusバッジ: `complete`=バッジなし（または「完全」）/ `partial`=警告色「一部」/ `unavailable`=「未観測」。出典: 陣営を構成する各participantの`captureStatus`列（DBスキーマ既存フィールド、集約ルールは下記「未解決」参照）
- 列見出し行2段目（**新規**）: バトルスコア（陣営トータル、大きく強調・陣営カラー・`font-mono`）+ 🪙合計（小さく`text-muted`）を横並び表示。バトルスコアの出典は既存`battle-history.ts`の`resolveBattleScore`/`mergeMaxScores`（`hostScores`: anchorId→累積スコアのMap）で、**陣営トータルとしては正確**（TikTok公式の`LinkMicArmies`データがホスト/陣営単位でのみ提供されるため）。`unavailable`のときバトルスコア・🪙合計とも「—」表示、`partial`のとき🪙合計の右に警告マーク（`!`、hover `title`で理由表示）
  - **貢献者リストの各行には🪙（実弾）合計のみを表示し、バトルスコアは表示しない。** 個々の貢献者（視聴者単位）のバトルスコアはTikTokのデータモデル上取得不可能（`WebcastLinkMicArmies`系メッセージはホスト/陣営単位の累積値のみを持ち、視聴者ごとの内訳を持たない。ギフトごとのcritical倍率は`matchInfo.multiplierType`で個別ギフトに紐づくが、ボーナス期間倍率は個別ギフトに刻印されないため、仮に🪙×critical値だけで概算しても公式スコアとは一致しない）。列見出しのバトルスコアのみが正確な値として使える
- **参加者セレクタ**（陣営に複数人いる場合、列見出しの下に表示）: 既定=「陣営全体合算」ボタンがアクティブ。個別参加者ボタンを選ぶと、その列のcol-title・captureStatusバッジ・バトルスコア・🪙合計・貢献者リストが選択した参加者個別のものに切り替わる。1vs1vs1vs1（個人戦、4陣営）は例外で、自陣営列にはセレクタを出さず（個人戦のため合算相手がいない）、相手側列のみ4陣営中の相手3人を切り替えるセレクタを持つ（初期値=自分以外の最高スコア者）。個人戦セレクタは「合算」を持たない（1人=1陣営のため）
- 貢献者リスト: `BattleContributor[]`を🪙合計(`totalDiamonds`)降順。各行:
  - アバター（`profileImageUrl`。陣営カラーの枠線）
  - ニックネーム（`nickname`）
  - 🪙合計（`totalDiamonds`、**ギフト件数`(n)`表記は表示しない**）
  - **行全体がクリック/タップ可能**（下記インタラクション参照）
- `partial`のとき列下部に注記1行（例:「観測開始が遅れたため一部期間のみ集計（19:02〜）」）。出典: participantの`captureStartedLateMs`/`captureEndedEarlyMs`等から文言生成（生成ロジックは実装側で決定）
- `unavailable`のとき貢献者リストの代わりに空状態メッセージ「相手の配信データは観測できませんでした」

### 貢献者行のクリック展開（インタラクション）
- 貢献者行（ボタン）をクリック/タップ → その場（インライン、アコーディオン）でその人のギフト明細を時系列（古→新）展開
- 展開行1件ごと: 時刻（`HH:mm:ss`、`font-mono`）+ ギフト名 + 🪙額(×倍率表記、`repeatCount`>1のとき)
- 出典: `BattleHistoryGiftEvent`（`occurredAt`, `sourceGiftId`→ギフト名, `totalDiamonds`, `repeatCount`）。**現状 `queryBattleContributors` は個別ギフトイベントをcontributor単位にグルーピングして返していない**→実装側でAPIレスポンス拡張が必要
- **展開は行ごとに独立**（同時に複数行を展開可能。既存アコーディオンパターンのような排他制御はしない）
- 矢印アイコン（`▸`/`▾`相当）がaria-expanded状態に応じて回転する

### score-row（旧: モーダル上部の自分/相手2値スコア表示）
- **廃止・列見出しへ統合済み**。当初案では対戦表直下に「自分🪙86,900 / 相手🪙21,200」という2値専用行を置く案だったが、陣営数が可変（3陣営以上で「相手」が1つに定まらない）という問題があったため、各陣営列見出し内（col-head-stats）にバトルスコア+🪙合計をまとめる方式に統合した。この統合により旧spec「未解決3」（3陣営以上でのscore-row表示未定義）は解消済み

## 状態

- **loading**: 既存の「読み込み中...」表示を維持（陣営列が出そろう前）
- **error**: 既存の「貢献者一覧を取得できなかった。」を維持
- **貢献者0件（陣営単位）**: 既存の「このバトルへの貢献者なし」相当を陣営列単位で出す（未定義だった場合はこの文言を流用）
- **バトル区間確定不可（`status: "unknown"`）**: 既存の「バトル区間を確定できないため集計できません」を維持
- **陣営が1つのみ（solo/opponent不明）**: `teams`がnullのケース。既存の単独貢献者リスト表示（陣営分割なし）にフォールバック
- **決着未確定（勝敗不明）**: WINバッジをどちらのカードにも付けない

## 未解決（ユーザー確認が必要）

1. **captureStatusの陣営単位への集約ルール**: 陣営内に複数配信者（例: 2vs2の相手側2人）がいて、それぞれのcaptureStatusが異なる場合（片方complete・片方partial等）にどちらを陣営の代表状態とするか未定義。「最も悪い状態を採用（unavailable > partial > complete）」を実装側の既定案として提案するが、承認が必要
2. **3陣営以上でのモバイル（480px未満）表示**: Artifactで検証したのは2陣営（1vs1系）のタブ切替のみ。3陣営以上（1vs2/2vs2/1vs1vs1vs1等）でのモバイル表示パターンは comp に無い。現状のArtifactでは4陣営を2列×2行gridのまま縮小表示しているが、480px未満での挙動（タブ化するか、2x2のまま維持するか）は未検証・未確定
3. ~~3陣営以上のscore-row表示~~ → 列見出しへの統合により解消済み（上記参照）
4. **ライブ中（未確定バトル）の相手陣営データ取得可否**: `computeBattleSnapshot`は確定時にのみ動くため、ライブ中は相手陣営のリアルタイム集計手段が無い。ライブ中は相手陣営を常に`unavailable`扱いにする想定だが未承認
5. **展開したギフト明細の件数上限・スクロール**: 大量投げ（数百件）のリスナーの場合の表示上限（全件 or 直近n件+「もっと見る」）は comp に無い
6. **参加者セレクタの選択状態の保持**: モーダルを閉じて開き直した時、前回選択していた個別参加者を覚えておくか、常に「陣営全体合算」にリセットするかは comp に無い（Artifactは開くたびに既定＝合算からスタートする想定で作られている）

## 実装側の主要変更点（参考、visual-qa対象外だが構造対応表作成時に必要）

- `src/lib/battle-history.ts`: `queryBattleContributors`を`participants: { where: { roomId } }`（自room限定）から、確定バトルの全participantsをteamIndexでグルーピングして返す形へ拡張。個別ギフトイベント（時系列明細）もcontributor単位で保持して返す。陣営トータルのバトルスコアは既存`resolveBattleScore`/`mergeMaxScores`（`hostScores`）をそのまま流用可能（新規ロジック不要、正確な値）
- `src/app/(dashboard)/analytics/battle-types.tsx`: `BattleListItem`に`teams`を追加、`BattleContributorsData`を陣営別（`teams: { index, isSelf, captureStatus, battleScore, observedGiftTotal, contributors }[]`のような形）に拡張
- `src/app/(dashboard)/analytics/BattleDetailModal.tsx`: 陣営列grid・展開アコーディオン・参加者セレクタ・WINバッジ・陣営カラー割り当て（スコア降順で`--fc-1`〜`--fc-3`を動的に割り当てる）・上下貫通の縦分割線（1vs1vs1vs1除く）を実装
