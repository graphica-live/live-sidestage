# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

主要ユーザーはLIVE Sidestage Analyticsに登録しているTikTok Live配信者。配信中、画面を注視せず手元操作を最小限に、自分のライブコメントを聞き取りたい人。現状は開発者自身が実機検証(Pixel 7a)で使っている段階だが、今後LIVE Sidestage Analytics登録者全般への公開を想定している。

## Product Purpose

TikTok Liveのコメント・ギフト・フォローをリアルタイムで取得し、コメントはVOICEVOX音声合成でスマートフォン上で読み上げ、イベントに応じて効果音を鳴らす。配信者が画面を見なくても視聴者の反応を把握でき、配信中の実況やリアクションを止めずに応答できるようにすることが目的。

## Positioning

既存バックエンド「LIVE Sidestage Analytics」(Railway本番運用)の公式モバイルクライアント。「Live Sidestageへの登録＝LIVE Sidestage Analyticsの登録」という一体運用が前提。オンデバイスVOICEVOX(`voicevox_core`をdart:ffiで組み込み)による読み上げと、画面オフ/バックグラウンドでも途切れないForeground Service常駐が中核の差別化ポイント。

## Operating Context

配信者はPC側の配信ソフト(OBS等)を操作しながら、本アプリをスマートフォンでバックグラウンド動作させる想定。Googleアカウントでサインイン→初回のみTikTok ID連携(LIVE Sidestage Analyticsへの登録)→ホーム画面で開始/停止を操作、という一直線のフロー。Socket.IOでLIVE Sidestage Analyticsバックエンドとリアルタイム接続し、`chat:comment` / `chat:gift` / `chat:follow` を受信する。「開始」はTTSと効果音の両方を含む「配信に接続」の意味で、TTSと効果音はそれぞれ独立してON/OFFできる。

## Capabilities and Constraints

- 現行プラットフォームはAndroidのみ。iOS対応はロードマップ上のPhase4で未着手。
- VOICEVOXは4キャラクター(ずんだもん・四国めたん・春日部つむぎ・玄野武宏)のみオンデバイス同梱。投稿者ごとのランダムボイス割当(セッション限り、アプリ再起動でリセット)、またはランダムOFF時は代表ボイス固定。
- 認証はGoogle Sign-Inのみ(旧email/password方式は廃止済み)。
- 効果音はギフト・コメント・フォローのイベントトリガー制。desktop(TikEffect)のトリガー意味論を踏襲し、カテゴリでまとめてON/OFFできる。**音のみで動画は対象外**。
- 音源は3経路で取り込める: 端末内の音声ファイル選択、効果音ラボ検索、MyInstants検索。取り込んだファイルはアプリ専用ディレクトリに保存する(1ファイル5MB・合計200MB上限)。効果音ラボ・MyInstantsの利用は両サイトの規約に抵触しており、公開前に別途対応が必要(同じ実装を持つdesktopと共通の課題)。
- 効果音の配信はbest-effort。サーバー側のコンボ状態が失われた場合は過少に鳴る(多重再生を避ける方を優先している)。
- 設定タブは読み上げON/OFF・ランダムボイス・効果音ON/OFF・TikTok ID変更・ログアウトまで。話者選択・話速/音高・コメントフィルタは未実装。
- 連打制御(rapid fire)、ユーザーIDのファイル一括指定、強制割り込み再生はdesktopにあるが本アプリでは未実装。
- バックエンドはLIVE Sidestage Analytics(Railway本番)。Live Sidestage単独のアカウント・データ基盤は持たない。

## Brand Commitments

アプリ名は「Live Sidestage」。PC・Webサービスと共通のブランド名であり、モバイル版の内部識別子は `live_sidestage_mobile`(Androidパッケージは `com.liveanalytics.live_sidestage_mobile`)とする。LIVE Sidestage Analyticsエコシステムの一部としての位置づけを維持し、独立ブランドとして切り離さない。

## Evidence on Hand

実機検証済み(Pixel 7a、Phase1〜3完了・2026-08-17)。効果音機能とタブ構成(2026-08-21追加)は`flutter analyze`・`flutter test`・サーバー側との契約テストまで通っているが、**実機検証は未実施**。特に以下は未確認: Foreground Serviceを`mediaPlayback`単独にした状態でのDoze/画面オフ6時間超の待受、TTSと効果音の同時再生(audio focus)、ローカルanalyticsを経由したギフト/フォローのエンドツーエンド発火。

マーケティング素材・スクリーンショット・ユーザーレビュー等の実績データは無し。将来の一般公開に向けたストア掲載文言や実績は未作成として扱い、今後の作業で捏造しない。

## Product Principles

- 配信中に画面を見ずに使えることを最優先する(音声中心、操作は最小限)。
- バックグラウンド・画面オフでも読み上げが途切れないことを機能の中核とする。
- LIVE Sidestage Analyticsとの一体運用を崩さない(アカウント・登録はLIVE Sidestage Analytics側に委ねる)。
- 個人開発者による実装優先の段階から、今後の一般公開に耐える品質へ引き上げる。

## Accessibility & Inclusion

現状、視覚アクセシビリティ(スクリーンリーダー等)の個別要件は確認されていない。日本語UIのみでi18n対応は範囲外。
