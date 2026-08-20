# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

主要ユーザーはLiveAnalyticsに登録しているTikTok Live配信者。配信中、画面を注視せず手元操作を最小限に、自分のライブコメントを聞き取りたい人。現状は開発者自身が実機検証(Pixel 7a)で使っている段階だが、今後LiveAnalytics登録者全般への公開を想定している。

## Product Purpose

TikTok Liveのコメントをリアルタイムで取得し、VOICEVOX音声合成でスマートフォン上で読み上げる。配信者が画面を見なくても視聴者コメントを把握でき、配信中の実況やリアクションを止めずにコメントへ反応できるようにすることが目的。

## Positioning

既存バックエンド「LiveAnalytics」(Railway本番運用)の公式モバイルクライアント。「Live Sidestageへの登録＝LiveAnalyticsの登録」という一体運用が前提。オンデバイスVOICEVOX(`voicevox_core`をdart:ffiで組み込み)による読み上げと、画面オフ/バックグラウンドでも途切れないForeground Service常駐が中核の差別化ポイント。

## Operating Context

配信者はPC側の配信ソフト(OBS等)を操作しながら、本アプリをスマートフォンでバックグラウンド動作させる想定。Googleアカウントでサインイン→初回のみTikTok ID連携(LiveAnalyticsへの登録)→ホーム画面で読み上げ開始/停止を操作、という一直線のフロー。Socket.IOでLiveAnalyticsバックエンドとリアルタイム接続する。

## Capabilities and Constraints

- 現行プラットフォームはAndroidのみ。iOS対応はロードマップ上のPhase4で未着手。
- VOICEVOXは4キャラクター(ずんだもん・四国めたん・春日部つむぎ・玄野武宏)のみオンデバイス同梱。投稿者ごとのランダムボイス割当(セッション限り、アプリ再起動でリセット)、またはランダムOFF時は代表ボイス固定。
- 認証はGoogle Sign-Inのみ(旧email/password方式は廃止済み)。
- 設定画面(話者選択・話速/音高・コメントフィルタ)は未実装。Phase4で予定。
- バックエンドはLiveAnalytics(Railway本番)。Live Sidestage単独のアカウント・データ基盤は持たない。

## Brand Commitments

アプリ名は「Live Sidestage」。PC・Webサービスと共通のブランド名であり、モバイル版の内部識別子は `live_sidestage_mobile`(Androidパッケージは `com.liveanalytics.live_sidestage_mobile`)とする。LiveAnalyticsエコシステムの一部としての位置づけを維持し、独立ブランドとして切り離さない。

## Evidence on Hand

実機検証済み(Pixel 7a、Phase1〜3完了・2026-08-17)。マーケティング素材・スクリーンショット・ユーザーレビュー等の実績データは無し。将来の一般公開に向けたストア掲載文言や実績は未作成として扱い、今後の作業で捏造しない。

## Product Principles

- 配信中に画面を見ずに使えることを最優先する(音声中心、操作は最小限)。
- バックグラウンド・画面オフでも読み上げが途切れないことを機能の中核とする。
- LiveAnalyticsとの一体運用を崩さない(アカウント・登録はLiveAnalytics側に委ねる)。
- 個人開発者による実装優先の段階から、今後の一般公開に耐える品質へ引き上げる。

## Accessibility & Inclusion

現状、視覚アクセシビリティ(スクリーンリーダー等)の個別要件は確認されていない。日本語UIのみでi18n対応は範囲外。
