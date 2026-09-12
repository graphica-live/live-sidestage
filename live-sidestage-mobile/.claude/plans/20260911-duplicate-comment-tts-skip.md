# お楽しみ袋・定型文読み上げ回避機能の実装

## 目的

直近10分以内に「全く同じ内容」のコメントが2回投稿されたら、2回目の投稿時点を起点にその後10分間、同一内容のコメントをVOICEVOX読み上げの対象から除外する（自動投稿/定型文の連投で読み上げが埋まるのを防ぐ）。設定画面からON/OFFできるトグルを追加する。

## Mode

Feature

## Research Strategy

`A: Planner単独`。既存クラス数個（`SpeechQueueController` / `CommentFeed` / `AppConfig` / `AppConfigStore` / `settings_tab.dart` / `background_task_handler.dart`）を実読して経路を確定できたため、外部委譲・nested agentは不要と判断。

## 現状（コメント受信→読み上げの経路）

- `lib/core/comment_feed.dart` の `CommentFeed` が socket.io `chat:comment` を受信し `Comment.tryParse` でパースして `onComment`(`Stream<Comment>`) へ流す。
- `lib/core/background_task_handler.dart`（Foreground Service の**背景 Isolate**）が `CommentFeed` と `SpeechQueueController` を1個ずつ生成し、`_speechQueue.listenTo(_commentFeed)`（206行目）で購読を張る。**読み上げの実処理は常に背景 Isolate 側で行われる。**
- `lib/core/speech_queue.dart` の `SpeechQueueController._enqueue()`（171-188行目）が実際の読み上げキュー投入口。既存のフィルタ順序:
  1. `comment.speechText.isEmpty` → 何もせず return（絵文字だけの投稿等）
  2. FREEプランのクールダウン中（`_isFreePlan && _intervalActive`）→ return
  3. どちらも通れば `_queue.add(comment)` → `_processQueue()`
- `lib/models/comment.dart` の `Comment.speechText`（107-111行目）が、角括弧の絵文字トークン・絵文字・連続空白を除去し `trim()` した「読み上げ対象文字列」。表示用の `displayText` とは別物。**この値を「内容の完全一致」判定にそのまま使うのが自然**（既に正規化済みで、絵文字の有無だけが違うコメントも同一視できる）。
- 設定は `lib/models/app_config.dart` の `AppConfig`（UI Isolate と背景 Isolate が共有する唯一の設定）に集約されている。`AppConfigStore`（`lib/core/app_config_store.dart`）が revision 方式で永続化(`FlutterForegroundTask.saveData`)し、サービス稼働中は `applyConfig` コマンドで背景 Isolate へ即時反映する。`background_task_handler.dart` の `_applyEffectiveConfig()`（509-536行目）が `_config` の値を `_speechQueue.xxx = effective.xxx` という形で `SpeechQueueController` の各setterへ流し込んでいる（`randomVoice` / `fixedStyleId` / `volume` / `speed` が既存の実例）。
- **`lib/core/battle_filter_store.dart` は対照的な「背景 Isolateに同期しない軽量設定」の実例。** コメントに「AppConfigには載せない、背景Isolateが関与しない表示専用の値だから」と明記されている。今回の機能は逆に**背景Isolate（読み上げの実処理）が直接参照する必要がある**ため、`AppConfig` 側に載せるのが正しい（`BattleFilterStore`パターンは不適合）。
- 設定画面のトグルUIパターンは `lib/screens/tabs/settings_tab.dart` の「読み上げ」セクション（90-104行目）にある `_SettingSwitchRow`（title/subtitle/value/enabled/onChanged/onLockedTap）。`store.setRandomVoice` のような `AppConfigStore` のメソッドを `onChanged` にそのまま渡す形。
- `AppConfig` は「新しいキーを足しても `currentSchemaVersion` は上げない」方針が明記されている（`fixedStyleId` 追加時のコメント568-574行目、`ttsSpeed` 追加時582-587行目）。理由: バージョンを上げると旧アプリが「未来バージョン」と誤判定して保存を完全に止め、`SoundLibrary.pruneOrphans` が音源実ファイルを誤って消す事故につながる。**今回も同じ方針を踏襲し、schemaVersionは上げない。**

## Invariants

- `Comment.speechText.isEmpty` の早期returnと、既存のFREEプラン間引き（`_isFreePlan && _intervalActive`）の挙動を壊さない。両者と新しい重複判定は独立した別のフィルタとして併存させる。
- `AppConfig.currentSchemaVersion` は上げない（新規キー追加のみ。旧バージョンアプリは無視するだけで壊れない）。
- 設定変更は既存の `bumped()` → `_mutate()` → revision同期の経路をそのまま使う（新しい永続化経路を作らない）。
- 読み上げの実処理（キュー投入判定）は常に背景 Isolate 側（`SpeechQueueController`）で完結させる。UI Isolate側で重複判定を行わない（`CommentFeed.comments`一覧表示用のリストとは別経路であることを維持）。
- 判定ロジックは日付・時刻に依存する副作用を持つため、**呼び出しは1コメントにつき1回だけ**（テスト・実装の両方で二重評価しない）。
- 判定は投稿者（`tiktokUid`）を問わず、`streamerId` 単位・`speechText` の完全一致（既存の絵文字除去・空白畳み込み・trim込み）で行う（詳細は下記「判断事項」参照）。

## 変更対象

- `lib/models/app_config.dart` — `AppConfig` に `duplicateSpeechSkipEnabled`（bool, default true）フィールドを追加。`toJson`/`tryDecode`/`copyWith`/`bumped` へ配線。
- `lib/core/app_config_store.dart` — `setDuplicateSpeechSkipEnabled(bool value)` を追加（既存の `setRandomVoice` と同型）。
- `lib/core/duplicate_comment_filter.dart`（新規） — 重複検知の純粋ロジックを独立クラス `DuplicateCommentFilter` として切り出す（`SpeechQueueController` から見た依存注入・単体テスト容易性のため。`Comment`/`VoiceCatalog` 等の既存モデルと同じ「pure Dart, widget非依存」の層に置く）。
- `lib/core/speech_queue.dart` — `SpeechQueueController` に `duplicateSkipEnabled` フィールド（デフォルトtrue、`randomVoice`と同様に初期化前の値を保持できる形）と `DuplicateCommentFilter` のインスタンスを持たせ、`_enqueue()` 内で `speechText.isEmpty` チェックの直後・FREEプランのクールダウン判定の前に重複判定を挟む。
- `lib/core/background_task_handler.dart` — `_applyEffectiveConfig()`（514-519行目付近）に `_speechQueue.duplicateSkipEnabled = effective.duplicateSpeechSkipEnabled;` を追加。
- `lib/screens/tabs/settings_tab.dart` — 「読み上げ」セクションに `_SettingSwitchRow` をもう1行追加し、`store.config.duplicateSpeechSkipEnabled` / `store.setDuplicateSpeechSkipEnabled` を配線。
- テスト: `test/app_config_test.dart`、`test/app_config_store_test.dart` の既存ケースへ新フィールドの往復確認を追加。`test/duplicate_comment_filter_test.dart`（新規）で判定アルゴリズムを単体テストする。

## 対象外

- サーバー側（`live-sidestage-analytics`）の変更は無し。コメントは既に配信されてくる前提で、判定は完全にクライアント（Flutter）側。
- FREEプランの間引き機構（`_isFreePlan`/`_intervalActive`）の変更は無し。
- ギフト読み上げ・効果音（`SoundEngine`）は対象外。あくまで `SpeechQueueController` のコメント読み上げのみ。

## 依存関係

1. `AppConfig` へのフィールド追加（Batch01）と `DuplicateCommentFilter` 純粋ロジック（Batch02）は互いに独立 → 並列実装可。
2. `SpeechQueueController` への配線（Batch03）は Batch01（`AppConfig`の型）と Batch02（`DuplicateCommentFilter`クラス）の両方に依存。
3. 設定画面UI（Batch04）は Batch01（`AppConfigStore`のsetter/フィールド）にのみ依存。Batch02/03とは独立に並列実装可。

## 実装Batch

### Batch 01: AppConfig新設定フィールド

Risk: LOW
Worker: worker-normal
Depends on: None
Parallel: Yes（Batch02, Batch04と並列可）

#### 目的

読み上げの定型文スキップ機能のON/OFFを永続化・同期できるようにする。

#### 対象

- `lib/models/app_config.dart` — `AppConfig` クラス
- `lib/core/app_config_store.dart` — `AppConfigStore` クラス
- `test/app_config_test.dart`
- `test/app_config_store_test.dart`

#### 実装内容

1. `AppConfig` に `final bool duplicateSpeechSkipEnabled;` を追加し、コンストラクタのデフォルト値を `true` にする。
2. `toJson()` に `'duplicateSpeechSkipEnabled': duplicateSpeechSkipEnabled` を追加。
3. `tryDecode()` に `duplicateSpeechSkipEnabled: json['duplicateSpeechSkipEnabled'] != false,`（既存の `ttsEnabled`/`randomVoice` と同じ「キーが無ければtrue」パターン）を追加。**`currentSchemaVersion` は上げない**（既存の `fixedStyleId`/`ttsSpeed` 追加時と同じ方針。コメントで理由を明記すること）。
4. `copyWith()` / `bumped()` の引数・本体に `duplicateSpeechSkipEnabled` を追加。
5. `AppConfigStore` に `Future<void> setDuplicateSpeechSkipEnabled(bool value) => _mutate((c) => c.duplicateSpeechSkipEnabled == value ? null : c.bumped(duplicateSpeechSkipEnabled: value));` を追加（`setRandomVoice`/`setFixedStyleId` と同型）。
6. 既存の `test/app_config_test.dart`（JSON往復・`tryDecode`の未知キー無視・旧バージョンJSONでの既定値フォールバック）と `test/app_config_store_test.dart`（`_mutate`経由のrevision増加・変化なし時にrevisionを進めないこと）のテストパターンに倣い、新フィールドの往復・デフォルト値・no-opケースを追加する。

#### Invariants / 注意事項

- schemaVersionを上げない。上げると旧バージョンアプリの設定保存が止まり、`SoundLibrary.pruneOrphans`が実ファイルを誤って消す既知の事故パターンに繋がる（`app_config.dart`のコメント参照）。
- デフォルトは `true`（機能ON）。値の妥当性は本計画の「メインエージェント判断事項」を参照（実装自体はこの前提で進めてよい）。

#### 完了条件

- `AppConfig`/`AppConfigStore`のAPIが揃い、`flutter analyze`がクリーン。
- 新規・既存テストがすべてパスする。

#### 検証方法

- `flutter test test/app_config_test.dart`
- `flutter test test/app_config_store_test.dart`
- `flutter analyze`

---

### Batch 02: 重複コメント検知ロジック（純粋クラス）

Risk: MEDIUM
Worker: worker-normal
Depends on: None
Parallel: Yes（Batch01, Batch04と並列可）

#### 目的

「直近10分以内に同一内容が2回投稿されたら、2回目を起点に10分間スキップ」という時間依存アルゴリズムを、widget/TTSエンジンに依存しない独立クラスとして実装し、単体テストで確実に検証できる形にする。

#### 対象

- `lib/core/duplicate_comment_filter.dart`（新規作成）
- `test/duplicate_comment_filter_test.dart`（新規作成）

#### 実装内容

1. `DuplicateCommentFilter` クラスを新規作成する。コンストラクタで `detectionWindow`（既定 `Duration(minutes: 10)`）と `suppressionDuration`（既定 `Duration(minutes: 10)`）を受け取れるようにする（テスト容易性・将来の調整余地のため。本番利用時は既定値のまま使う）。
2. 判定キーは `'${comment.streamerId}|${comment.speechText}'`（`Comment.speechText`は既に絵文字除去・空白畳み込み・trim済み。**`tiktokUid`は含めない** — 投稿者を問わず同一内容を検知する。判断根拠は本計画「調査結果」参照）。
3. 公開API: `bool shouldSuppress(Comment comment, {DateTime? now})`。**副作用を持つ**（呼び出しごとに内部履歴を更新する）ため、doc commentに「1コメントにつき1回だけ呼ぶこと」を明記する。
4. アルゴリズム（`now`は省略時 `DateTime.now()`）:
   - 呼び出しのたびに期限切れの内部エントリを掃除する（`_lastSeenAt`は`detectionWindow`超過分、`_suppressUntil`は期限超過分を削除。無制限にメモリが増えないようにするため）。
   - そのキーに現在有効な抑制期限（`_suppressUntil[key]`）があり `now`がその期限より前なら `true`（抑制中）を返す。
   - 抑制期限が過ぎていれば、そのキーの抑制状態と`_lastSeenAt`を両方クリアする（**過去の抑制サイクルを引きずって無限に抑制が延長されないようにするため**。抑制解除後は「1回目」から数え直す）。
   - それ以外の場合: 直前の出現時刻（`_lastSeenAt[key]`）を見る。**先に**現在時刻を`_lastSeenAt[key]`へ書き込んでから判定する。直前出現があり、かつ `now - 直前出現 <= detectionWindow` なら「2回目（以降）の投稿」と判定し、`_suppressUntil[key] = now + suppressionDuration` をセットする。このとき**今回のコメント自体は `false`（読み上げる）を返す** — 抑制されるのは「2回目の投稿の後」に来る3回目以降のコメントである（要件の「2回目の投稿時点を起点にその後10分間」の解釈。詳細は「メインエージェント判断事項」参照）。
   - 上記いずれにも該当しなければ `false` を返す。
5. `void reset()` を用意する（テスト用・将来のログアウト等での状態クリア用）。
6. `test/duplicate_comment_filter_test.dart` で以下を検証する（`now`を明示的に渡してタイマー非依存でテストする）:
   - 1回目の投稿は常に `false`。
   - 同一内容が10分以内に2回目 → 2回目自体は `false`、直後（同時刻扱いでもよい）の3回目は `true`。
   - 2回目から10分ちょうど未満は `true`、10分を過ぎたタイミングでは `false`（境界値）。
   - 抑制解除後にもう一度同じ内容が単発で来ても、次の1回だけでは抑制されない（再度「2回」揃って初めて抑制が再発火する）。
   - 内容が1文字でも違えば別キー扱いになり抑制されない。
   - `streamerId`が異なれば同一テキストでも独立に扱われる（別配信の同名コメントに影響しない）。
   - 10分より前の初回投稿は「直近10分以内」に該当せず、2回目扱いにならない（`detectionWindow`超過での非トリガーを確認）。

#### Invariants / 注意事項

- widget非依存の純粋Dartクラスとして実装する（`comment.dart`/`app_config.dart`と同じ層）。TTSエンジン・AudioPlayer等への依存を持ち込まない。
- 内部Mapが無制限に増えないよう、`shouldSuppress`呼び出し時に必ず掃除処理を通す。

#### 完了条件

- `DuplicateCommentFilter`が上記アルゴリズム通りに実装され、`flutter analyze`がクリーン。
- 単体テストがすべてパスする。

#### 検証方法

- `flutter test test/duplicate_comment_filter_test.dart`
- `flutter analyze`

---

### Batch 03: SpeechQueueControllerへの配線・背景Isolateへの反映

Risk: LOW〜MEDIUM（既存の確立された同期パターンへの追従であり新規アーキテクチャではないが、背景Isolateの読み上げ実処理に触るため注意深く行う）
Worker: worker-normal
Depends on: Batch 01, Batch 02
Parallel: No（Batch01/02完了後に着手。Batch04とは並列可）

#### 目的

`DuplicateCommentFilter`を実際の読み上げキュー投入判定に組み込み、設定画面のON/OFFが背景Isolateの実処理へ届くようにする。

#### 対象

- `lib/core/speech_queue.dart` — `SpeechQueueController`
- `lib/core/background_task_handler.dart` — `_applyEffectiveConfig()`

#### 実装内容

1. `SpeechQueueController` に `final DuplicateCommentFilter _duplicateFilter = DuplicateCommentFilter();` を追加。
2. `duplicateSkipEnabled`フィールドを追加する。**初期化前でも値を保持できるようにする** — `randomVoice`/`fixedStyleId`と同じ「`_voicePool`のようなlate生成物に依存しない単純なbool」なので、単純なpublicフィールド（既定値`true`）でよい（`voicePool`待ちのバッファリングは不要。既存の`enabled`フィールドと同じ扱い）。
3. `_enqueue(Comment comment)` 内、`if (comment.speechText.isEmpty) return;` の直後・FREEプランのクールダウン判定（`if (_isFreePlan && _intervalActive) return;`）の**前**に、次を追加する:
   ```
   if (duplicateSkipEnabled && _duplicateFilter.shouldSuppress(comment)) return;
   ```
   （**重複判定は常に評価する** — FREEプランでスキップされた投稿であっても`DuplicateCommentFilter`の内部履歴には影響を与えないよう、判定順序をこの位置に置く。判定自体はFREEプランの状態を参照しない独立した機能として実装する）
4. `background_task_handler.dart` の `_applyEffectiveConfig()`（既存の514-519行目付近、`_speechQueue.randomVoice = effective.randomVoice;` 等が並ぶブロック）に次を追加する:
   ```
   _speechQueue.duplicateSkipEnabled = effective.duplicateSpeechSkipEnabled;
   ```

#### Invariants / 注意事項

- `comment.speechText.isEmpty`の早期returnより後、FREEプランのクールダウン判定より前という順序を守ること（既存コメントにある「`_processQueue`側ではなくここで止める」という設計方針を踏襲し、空文字コメントを重複フィルタへ渡さない）。
- `_duplicateFilter.shouldSuppress()`は副作用を持つため、`_enqueue`内で1コメントにつき1回だけ呼ぶこと（先読み合成(`prefetched`)や再生ループ側では絶対に呼び出さない）。
- 既存のFREEプラン間引き・エラー処理・先読み合成の挙動を変更しない。

#### 完了条件

- `flutter analyze`がクリーン。
- 既存の`speech_queue.dart`関連の動作（もしあれば）に回帰がない。

#### 検証方法

- `flutter analyze`
- `flutter test`（プロジェクト全体。回帰の有無を確認）
- 可能であれば実機/エミュレータで、同一内容のテストコメントを短時間に複数回送って、2回目までは読み上げられ、3回目以降10分間はスキップされることを目視確認（自動テストで完全に代替できない実機確認は`test-auto`側の判断に委ねる）。

---

### Batch 04: 設定画面トグルUI

Risk: LOW
Worker: worker-normal
Depends on: Batch 01
Parallel: Yes（Batch02, Batch03と並列可）

#### 目的

ユーザーが定型文読み上げ回避機能をON/OFFできるようにする。

#### 対象

- `lib/screens/tabs/settings_tab.dart`

#### 実装内容

1. 「読み上げ」セクションの`ListPanel`（既存の`_SettingSwitchRow`（ランダムボイス）の直後、または`_VoiceRow`/音量/速さの並びの末尾）に、新しい`_SettingSwitchRow`を1行追加する。
   - `title`: 「定型文の読み上げを制限」（表記は暫定。ユーザー向け文言はUI観点で調整可）
   - `subtitle`: 「同じ内容のコメントが短時間に繰り返されたら読み上げを止めます」等、機能の説明
   - `value: store.config.duplicateSpeechSkipEnabled`
   - `enabled: canEdit`（既存の`canEdit = !busy`をそのまま使う。プラン制限は今回の要件に含まれていないため`planGate`は絡めない）
   - `onChanged: store.setDuplicateSpeechSkipEnabled`
   - `onLockedTap: null`（プランロックなしのため）
2. 他の`_SettingSwitchRow`と同じスタイル・余白・配置規則に厳密に合わせる（本機能はUI観点のデザイン契約が別途存在しないため、既存パターンの模倣で足りる。新規ビジュアルデザインの案出しは不要）。

#### Invariants / 注意事項

- 既存の「読み上げ・効果音のON/OFFは各タブの開始/停止ボタンが持つ」という設計方針（88行目コメント）とは別物であることを踏まえ、今回追加するのは「読み上げ中に何を読むか」の制御であって、機能そのものの起動/停止トグルではないことを明確にする（`_SettingSwitchRow`の文言で誤解を招かないようにする）。
- `store.config`から読む値・`store`のメソッドを渡すだけの薄いUIに留め、状態管理ロジックを`settings_tab.dart`側へ持ち込まない（既存行のパターンを踏襲）。

#### 完了条件

- `flutter analyze`がクリーン。
- 設定画面上でトグルが表示され、ON/OFFの切り替えが`AppConfigStore`へ反映される。

#### 検証方法

- `flutter analyze`
- `flutter test`（widget testが影響を受けないか確認）
- 実機/エミュレータで設定タブを開き、トグルのON/OFF・永続化（アプリ再起動後も値が保持されること）を目視確認。UI変更を伴うため、スクリーンショットをまとめて提示する（`test-auto`のUI提示手順に従う）。

## 実行順序

1. Batch 01 と Batch 02 を並列実装
2. Batch 01 完了後、Batch 04 を実装（Batch02/03と並列可）
3. Batch 01・Batch 02 完了後、Batch 03 を実装
4. 全Batch完了後、全体検証

## 全体検証

- `flutter analyze`
- `flutter test`（全体。既存テストへの回帰がないこと）
- 実機/エミュレータでの動作確認（同一コメント連投時の抑制挙動、設定トグルのON/OFFと永続化）
- UI変更（Batch04）分はスクリーンショットをまとめてユーザーへ提示する

## 未解決事項

None（実装を進める上でのブロッカーはない。下記「メインエージェント判断事項」は実装前提を明確にするための確認事項であり、記載の推奨案のまま進めてよい）

## メインエージェント判断事項

1. **デフォルトON/OFF**: `duplicateSpeechSkipEnabled`の初期値をどうするか。
   - 選択肢A（推奨・採用済み）: デフォルト`true`（ON）。既存の`ttsEnabled`/`randomVoice`/`sound.enabled`等、この設定ファイル内の他フラグも軒並みデフォルトONであり、一貫性がある。定型文連投は放置するとユーザー体験を損なうため、初期状態から保護される方が望ましい。
   - 選択肢B: デフォルト`false`（OFF）。挙動変更を伴う新機能なので、既存ユーザーに無断で読み上げが減る変化を起こさない立場。
   - 推奨: A。confidence: 中（プロダクト判断であり、ユーザーの好みで容易に反転可能。実装コストは同じ）。
2. **「2回目の投稿」自体を読み上げるか**: 要件文「2回目の投稿時点を起点にその後10分間...スキップする」の解釈に幅がある。
   - 採用した解釈（Batch02参照）: 2回目自体は読み上げ、2回目の投稿時刻を起点として以後10分間（＝3回目以降）を抑制する。
   - 別解釈: 2回目の投稿自体も抑制対象に含める。
   - 推奨: 採用した解釈（2回目は読む）。理由: 「起点に**その後**」という文言が2回目より後の期間を指しているため。confidence: 中。誤りだった場合の修正コストは小さい（Batch02の`shouldSuppress`内の1分岐を反転するだけ）。
3. **判定キーに投稿者(tiktokUid)を含めるか**: 要件は「同一コメント」の判定基準を明示していない。
   - 採用: `streamerId + speechText`のみ（投稿者を問わない）。理由: 「お楽しみ袋・定型文」という機能名から、同一文言の連投（同一人物の連投、または複製・自動投稿の可能性）全般を抑制する意図と解釈した。
   - 別解釈: `streamerId + tiktokUid + speechText`（同一人物の連投のみ抑制。他人が同じ言葉を言うのは自然な会話として許容）。
   - 推奨: 採用した解釈（投稿者を問わない）。confidence: 中。ここも`DuplicateCommentFilter._keyFor()`の1行を変えるだけで反転可能。
4. （手続き上の確認）本計画はplanner自身の調査・計画作成までであり、実装着手前の`design-review`実施は主エージェント側の責務。本機能は「新機能」ではあるが、既存の`AppConfig`/`AppConfigStore`/`SpeechQueueController`の確立済み同期パターンをそのまま踏襲する変更であり新規アーキテクチャ判断を伴わないため、design-reviewの要否は主エージェントの通常判断（TRIVIAL相当ではないため実施が妥当と考えられるが、最終判断は主エージェント）に委ねる。
