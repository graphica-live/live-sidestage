# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

TikTok Live配信者。現状は開発者自身とその周辺の配信者での運用・検証が中心だが、将来的には不特定多数の配信者へ配布・販売する製品として設計している。日本語配信者を主対象とする。

## Product Purpose

TikTok Live配信中に届くギフト・コメント・視聴イベントをリアルタイムに検知し、OBS等の配信ソフトへブラウザソースとして読み込む「ウィジェット」(オーバーレイ演出)として視覚化する。配信者はデスクトップアプリ(Electron製の管理画面)からウィジェットの表示・見た目・トリガー条件を設定する。目的は配信画面の演出強化と視聴者エンゲージメントの向上(ギフトへの視覚的リアクション、目標達成演出、コメント表示など)。

## Positioning

TikFinity等の既存の類似ツールに対し、ローカル完結型で動作しウィジェットの見た目・トリガー条件を配信者自身が細かくカスタマイズできる自由度の高さが差別化点。日本語配信者向けのローカライズ(ギフト名の日本語対応など)にも力を入れている。

## Operating Context

- Electronデスクトップアプリ(Windows)としてローカルで起動。内部でExpressバックエンド(`backend/index.js`)+ socket.ioがリアルタイム通信を担う
- 配信者はローカル管理画面(`backend/public/db/*.html`、通称「Control」)でウィジェットの表示/非表示・テーマ・トリガー条件を設定する
- 設定したウィジェット(`backend/public/widgets/*.html`)のURLをOBS等の配信ソフトのブラウザソースとして読み込み、配信画面に重ねて表示する
- TikTok Live接続に`tiktok-live-connector`を使用し、レート制限のある外部API(EulerStream)に依存する箇所がある
- ローカルDBに`better-sqlite3`を使用し、ギフト履歴・コメント・各種設定を保存する

## Capabilities and Constraints

- Windows専用ビルド。`better-sqlite3`等のネイティブモジュールのため、ビルド前にnode/electronプロセスの停止とrebuildが必要
- EulerStream APIにレート制限があり、失敗時のユーザー向けメッセージ表現に配慮が必要な既知の制約がある
- ギフト名の日本語ローカライズは自動取得手段が確立しておらず、手動整備が必要
- ウィジェット種別は多数存在し(top-gift, gift-jar, coin-list, tap-list, push-pull, song-battle, goal-gifts, trigger-pending, trigger-gifts, trigger-x5, timer, tap-goal, shogo-title, like-contributionほか)、それぞれ独立したHTML+CSS+JSとして実装されている
- ウィジェットは配信者がテーマ(フォント・配色プリセット)をカスタマイズできる仕組み(`admin-theme-presets.css`)を持つ

## Brand Commitments

- 製品名「TikEffect」
- UIは日本語が基本言語

## Evidence on Hand

- 実装済みのウィジェット群・管理画面(Control)がコードベース上に存在し、これが現時点での最も確かな製品状態のエビデンスである
- 公開の販売実績・ユーザー数・顧客の声などは未確認。将来的な配布・販売は視野に入れているが、確定した計画やチャネルはまだない

## Product Principles

1. ローカル完結を保つ — 配信者のPC内で完結する設計を維持し、不要なクラウド依存を増やさない
2. カスタマイズ自由度を最大化する — ウィジェットの色・フォント・トリガー条件を配信者が自分で作り込めるようにする
3. 日本語配信者向けの品質を優先する — 表記・ローカライズの精度を保つ
4. 配信画面での視認性とパフォーマンスを損なわない軽量な演出を優先する
5. 将来の配布・販売を見据え、初見の配信者でも迷わない設定導線を意識する
