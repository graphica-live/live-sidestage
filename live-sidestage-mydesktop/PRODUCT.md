# Product

<!-- impeccable:product-schema 1 -->

## Platform

desktop (Windows / Electron)

## Users

ユーザーは配信者本人ただ一人。TikEffect(live-sidestage-desktop)を配信に使っている個人配信者が、配信中に自分の手元だけで見るための道具として使う。視聴者・スタッフ・複数配信者での共有は想定しない。現状は開発者自身が使う個人向け初版の段階で、一般配布の実績は無い。

## Product Purpose

配信中にTikEffectのエフェクト動画が「これから配信画面に出る」ことを、実際に出るより先に配信者へ知らせる。最初の機能「エフェクト予告」は、指定したscreen(1〜10)で動画の再生が始まった瞬間に、その動画の指定秒数後のフレームを静止画として手元の画面へ表示する。変身エフェクトのようにポーズが決まる演出で、配信者が本番フレームが配信に出る前にポーズを準備できるようにすることが目的。

## Positioning

TikEffect(live-sidestage-desktop)の派生であり、**TikEffect専属の軽量な観測者アプリ**。TikEffect本体には混ぜたくない、配信者個人専用の機能ページを左サイドバーへ足していく器として作った。TikEffectとは完全に別プロセス・別データで、SQLite・TikTok Live接続・動画保存ロジックを一切持たない。LIVE Sidestage Analytics(Webバックエンド)とも、mobile(LIVE Sidestage Android)とも連携しない。TikEffect本体が「配信に出る演出」を担うのに対し、本アプリは「配信に出ない、配信者本人だけが見る面」を担う。

## Operating Context

配信中、配信者のPCではTikEffectとOBSが常時起動している。本アプリはその横に小さなウィンドウ(既定480x320、最小320x220)として常駐し、`http://localhost:38100`のTikEffectへ`socket.io-client`で接続して`effects:video-playing`イベントを購読する。操作は「監視するscreen」と「オフセット秒数」を選ぶだけで、あとは受信のたびに自動でフレームが差し替わる。ウィンドウ位置・サイズと設定は`%LOCALAPPDATA%\MyDesktop\settings.json`へ永続化され、次回起動時に復元される(可視ディスプレイ外に出ていた場合は既定位置へ戻す)。単一インスタンスロックがあり、二重起動すると既存ウィンドウが前面に出る。

## Capabilities and Constraints

- **TikEffectが起動していないと何も表示されない。** 接続はTikEffectへの片方向購読のみで、自前のデータ源を持たない。未接続時は「未接続」バッジと「TikEffectとの接続待ち…」のバナーを出す。配信中はTikEffectが必ず起動している前提なので実用上の制約にはならないと判断している。
- 接続先ポートは`38100`固定。TikEffect側が環境変数でポートを変更できない実装(`live-sidestage-desktop/backend/index.js`の`FIXED_PORT`)のため、本アプリ側にも設定項目を持たない。
- 購読するイベントは`effects:video-playing`のみ。payloadは`{ playbackId, eventId, screen, videoUrl }`。このイベントはmydesktopのためにTikEffect側へ追加した新規イベントで、TikEffect既存動作(OBSオーバーレイ・管理UI・LIVE Studio連携)には影響しない純粋な追加。TikEffect側で発火箇所やpayload形式を変えたら本アプリの`main.js`も合わせて確認が要る。
- 表示は**TikEffectが配信するのと同じ動画ファイル**を`<video>`で読み込み、指定秒数へseekして止めたフレーム。サムネイルを別途生成・保存する仕組みは持たない。
- 動画URLはTikEffectのoriginへ解決できるものだけを受け付ける(`resolveSameOriginUrl`)。CSPも`media-src http://localhost:38100`に限定してある。
- 読み込みは20秒でタイムアウトし、失敗時はエラーメッセージを出す。新しいイベントが来ると進行中の読み込みは破棄される(世代は`currentJob`参照の同一性で判定)。
- **オフセットが短すぎると(概ね1秒未満)動画の読み込みが間に合わない場合がある。** 予告としての先行時間は動画のロード時間に食われるという性質上の限界で、UI上に注意文として出している。
- オフセット秒数はscreenごとに個別保存する。設定は`watchedScreen` / `screenOffsets`のみで、それ以外のカスタマイズ項目は持たない。
- 現状ページは「エフェクト予告」の1つだけ。`renderer/app.js`のページ切り替えロジックはv1時点で未実装(ページが1つのためスタブ)。
- native moduleはゼロ。依存は`electron` / `electron-builder` / `socket.io-client`のみで、better-sqlite3等は使わない。rendererは自前Expressサーバーを持たず`loadFile()`でローカルHTMLを直接読む。
- rendererは`nodeIntegration:false` / `contextIsolation:true`で、`preload.js`が`window.mydesktop`へフィールド単位のAPIだけを公開する(全体上書き系のAPIは作らない方針)。
- 配布はWindowsのみ(electron-builder NSIS、`npm run build:windows`)。macOS / Linuxのターゲットは未設定。
- **自動テストは無い。** 個人向け初版として意図的に見送っており、検証は手動が中心。ページが増えて複雑化した時点でランナー導入を検討する。
- `%LOCALAPPDATA%\MyDesktop`はTikEffectの`%LOCALAPPDATA%\TikEffect`とは別ディレクトリで、初回起動時に自動作成される。

## Brand Commitments

製品名は「MyDesktop」(ディレクトリ名・npmパッケージ名は`live-sidestage-mydesktop`、appIdは`com.livesidestage.mydesktop`)。LIVE Sidestageファミリーの一員でありながらTikEffectとは別アプリであることを名前とインストール先の両方で明確に保つ。TikEffect本体のブランド・UI・データへ混入しないことを維持する。UIは日本語。

## Evidence on Hand

**実機での検証ログ・計測データは記録として残っていない。** 本プロジェクトは2026-08-28のコミット1本(`c20ae84`)で新規作成されたのみで、`.claude/plans/`の計画ファイルもリポジトリ内には存在しない。自動テストランナーが未導入のため、テスト結果としての裏づけも無い。動作確認は開発者の手動操作で行われたと考えられるが、その手順・結果を示す資料はリポジトリ上に無く、本ファイルでは実績として主張しない。

マーケティング素材・スクリーンショット・ユーザーレビュー・配布実績はいずれも無し。個人利用の段階であり、今後の作業でこれらを捏造しない。

**未確認**: 実際の配信中(TikEffect + OBS稼働下)でのエンドツーエンド動作。オフセット秒数と実際の読み込み所要時間の関係(どこまで短いオフセットが実用に耐えるか)。長時間常駐時のメモリ・再接続の挙動。TikEffectを落として上げ直したときの再接続復帰。ビルド済みNSISインストーラーでの動作。

## Product Principles

- **TikEffect本体に触らない。** DB・業務ロジック・コードのimport・SQLiteファイル共有をしない。TikEffect側への変更は`effects:video-playing`のような純粋な追加に留め、既存動作を壊さない。
- **配信に出ないものだけを扱う。** 本アプリの画面は配信者本人だけが見る面であり、視聴者向けの出力は持たない。
- **軽量さを保つ。** native module・自前サーバー・永続ストアを増やさない。TikEffectの重い部分は取り込まない。
- **配信中に迷わせない。** 設定は最小限にとどめ、接続状態は常に一目で分かるようにする。
- 個人向け初版として、過剰な作り込みより「今日の配信で使える」ことを優先する。

## Accessibility & Inclusion

ユーザーが配信者本人1名の個人ツールであるため、スクリーンリーダー等の個別要件は現時点で確認されていない。UIは日本語のみでi18n対応は範囲外。配信中に横目で見る用途を想定し、接続状態はバッジの文言(接続中／再接続中／未接続)で示しており、色だけに依存しない。

<!-- TODO: 要確認 -->
<!--
以下はリポジトリ内の資料からは確定できなかった。誤りがあれば修正が必要。
1. Evidence on Hand: 実機での動作確認が実際に行われたか、行われたなら手順と結果。
   plansファイルが手元に無いため「記録が無い」としか書けていない。
2. 「配信者個人専用」の解釈: 開発者自身の私用ツールか、TikEffectユーザー全般への
   将来的な配布を想定しているか。本ファイルは前者(現状は開発者の私用)として書いた。
3. ロードマップ: 「機能ページを足していく器」とあるが、次に追加予定の具体的な
   ページは資料上に無いため記載していない。
4. Windows以外(macOS/Linux)の対応予定の有無。現状はターゲット未設定とだけ書いた。
-->
