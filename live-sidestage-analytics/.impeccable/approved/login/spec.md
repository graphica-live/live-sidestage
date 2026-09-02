# spec: ログイン画面(/login) — B案 分割スプリット(定番SaaS方向)

採用日: 2026-09-02。comp: `comp.png`(ライト/既定) / `comp-dark.png`(ダーク)。
既存実装 `src/app/(auth)/login/page.tsx` + `GoogleLoginPanel.tsx` の構造を刷新。

## 色(実測hex)

dashboardと同一トークン系(`.impeccable/approved/dashboard/spec.md`の色テーブルを参照。同一プロジェクト内でトークンを分けない)。
左パネルのみ独自: `background: linear-gradient(155deg, accent, color-mix(in srgb, accent 60%, bg))`。ライトでは `linear-gradient(155deg, #4f46e5, #837dee)` 相当(bg=#ffffffとのmix)、ダークでは `linear-gradient(155deg, #8b85ff, #514f8a)` 相当(bg=#101216とのmix)。

## タイポグラフィ

Font-family: `Inter`。

| 要素 | サイズ | weight | 備考 |
|---|---|---|---|
| ブランド名(LIVE Sidestage) | 21.6px(1.35rem) | 800 | letter-spacing -.01em |
| ブランドサフィックス(Analytics) | 15.2px(.95rem) | 500 | 左パネルでは`on-accent`色 |
| タグライン | 13.76px(.86rem) | 400 | 左パネルでは`rgba(255,255,255,.85)` |
| ヘッドライン(集計人数訴求) | 18.4px(1.15rem) | 700 | line-height 1.5, margin `18px 0 22px` |
| ヘッドライン内数値(b) | 20.8px(1.3rem) | 700 | f-num(Inter数字, tabular-numsではなく通常) |
| 統計チップ数値(b) | 18.4px(1.15rem) | 700 | |
| 統計チップラベル | 12.16px(.76rem) | 400 | |
| 近日公開バッジ | 9.92px(.62rem) | 700 | |
| Googleボタン文字 | 14.08px(.88rem) | 600 | |
| フッター同意文 | 11.52px(.72rem) | 400 | muted, 中央揃え |

## レイアウト・スペーシング(実測px)

- 全体: `display:flex`, 左右2分割。左パネル `flex: 1 1 46%`, 右パネル `flex: 1 1 54%`
- 左パネル padding: `44px 36px`, `display:flex; flex-direction:column; justify-content:space-between`
- 右パネル: 中央寄せ(`align-items:center; justify-content:center`), padding `40px 24px`, 内側幅上限 `max-width:320px`
- 統計グリッド: 2×2, `gap:10px`
- 統計チップ: 内側padding `12px`, border-radius `10px`, 背景 `rgba(255,255,255,.12)`(左パネルは常時濃色地のためライト/ダーク共通のこの半透明値)
- 近日公開バッジ: padding `1px 6px`, border-radius `999px`, 背景 `rgba(255,255,255,.22)`
- ログインカード(右): padding `22px`, border-radius `12px`(card-radius), border 1px `border`色, 影 `0 1px 3px rgba(16,24,40,.06)`
- Googleボタン: 幅100%, padding `11px 16px`, border-radius `8px`(field-radius), border 1px `border`色, アイコン `18×18px`, アイコンとテキストのgap `10px`
- フッター注記: margin-top `14px`

## 情報密度・視覚階層

- 最も目立つ要素: 左パネルの塗り面(アクセントグラデーション、画面の約46%を占有=Color Strategy「Committed」寄り)とその上のヘッドライン数値
- 2番目: 右パネルのGoogleログインボタン(主要アクション)
- 3番目: 統計4チップ(補足情報として並列表示、単一の目立つ数値を作らない)

## 要素・挙動インベントリ

| 要素 | 役割 | データ出典 |
|---|---|---|
| ブランドロゴ(LIVE Sidestage + Analyticsサフィックス) | 画面識別 | `brandSuffix` prop |
| タグライン「TikTok Live 配信データ総合解析Platform」 | ポジショニング文言 | 静的文言(旧「TikTok Live ギフト解析」から変更) |
| ヘッドライン「◯◯人の配信者データを集計する、配信を支えるサポートプラットフォーム」 | 実績訴求 | **要API**: 登録配信者数の集計値(現状未実装、要バックエンド追加) |
| 統計チップ: 貢献リスナーデータ/ギフト履歴/バトル履歴 | 実績訴求 | **要API**: 各集計件数(現状未実装) |
| 統計チップ: 高度なAI解析(近日公開バッジ) | ロードマップ告知 | 静的文言。PRODUCT.md「ロードマップ(未実装)」節に記録済み。**実装が完了するまで「近日公開」表記を外さない** |
| Googleログインボタン | OAuth開始 | `signIn("google", { callbackUrl })`(既存`GoogleLoginPanel.tsx`のロジックをそのまま流用) |
| フッター同意文 | 法務表記 | 既存に無い新規追加文言 → 実際の利用規約/プライバシーポリシーURLの有無をユーザー確認要(未解決) |

## 状態(未定義含む)

- OAuthリダイレクト中のローディング表示: **未定義**。comp静止画のため不明。実装時に決める。
- OAuth失敗時のエラー表示: **未定義**。既存実装にも専用UIなし。
- 開発用ログインフォーム(`DEV_LOGIN_ENABLED`時のみ表示、ローカルテスト専用): 意図的にcomp対象外。本番相当の見た目のためcompには含めない。実装時は既存ロジックのまま、視覚のみ新トークンで最小限整合させる。

## 未解決

1. **ヘッドライン・3統計チップの実数値は未実装。** 「1,204人」「38,600人」「512,300件」「9,840件」はcomp用サンプル。本番投入前に集計API(配信者数・貢献リスナー数・ギフト履歴数・バトル履歴数)の追加実装が必要。未実装のまま実績として本番表示しないこと(PRODUCT.md「Evidence on Hand」に抵触)。
2. **フッター同意文「利用規約とプライバシーポリシーに同意した...」は新規追加文言。** 実際に参照する規約・ポリシーページのURLが現状不明。法務確認のうえ実URLを確定するか、掲載自体を見送るかユーザー判断が必要。
3. **「高度なAI解析」の実装スコープ未確定。** PRODUCT.mdへロードマップとして記録したのみで、機能仕様は別途検討要。
