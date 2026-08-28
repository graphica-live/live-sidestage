# TikTok LIVE 日本語ギフト名 取得方法 比較検証レポート

- 検証日: 2026-08-28
- 検証対象配信者(uniqueId): `yu_ki_nojo`
- 検証環境: Windows 11 / Node.js v24.14.0 / Python 3.14.5 / .NET 8
- 配置場所: リポジトリルート直下 `gift-name-verification/`(既存の LIVE Sidestage 本体は無変更)

比較表の生データは以下に格納:
- [gift-comparison.csv](gift-comparison.csv) — 全684 giftId の統合比較表
- [gift-comparison.json](gift-comparison.json) — 同内容の詳細JSON
- [gift-name-differences.json](gift-name-differences.json) — 名称が食い違う giftId のみ抽出
- [raw/](raw/) — 各取得方法の生レスポンス一式

---

## 1. 使用ライブラリ・バージョン

| # | 手法 | ライブラリ | バージョン | 備考 |
|---|------|-----------|-----------|------|
| 1 | Node GiftList | `tiktok-live-connector` (zerodytrash) | **2.1.1-beta1** | LIVE Sidestage 本体([tiktok-gift-catalog.ts](../live-sidestage-analytics/src/lib/tiktok-gift-catalog.ts))が実運用で使っているバージョンに合わせた |
| 2 | Node GiftEvent | 同上 | 同上 | |
| 3 | Python GiftList | `TikTokLive` (isaackogan) | **7.0.0** | 検証時点の最新 |
| 4 | Python GiftEvent | 同上 | 同上 | |
| 5 | C# GiftList/Event | `TikTokLiveSharp` (frankvHoof93) | **0.1.4** (NuGet最新) | 後述の通り実用に耐えなかった |
| 6 | Webcast API 直接 | なし(Node標準 `fetch`) | — | connector 2.1.1-beta1 の内部実装を実読して再現 |

**追加検証: `tiktok-live-connector` 2.4.4(最新)** — 当初これを最優先で使う想定だったが、`fetchAvailableGifts()` が仕様変更されており **無料枠では動作しない** ことが判明した([raw/node-v2.4.4-probe/result.json](raw/node-v2.4.4-probe/result.json)):

```
SignatureMissingTokensError: [fetchWebcastSignatureFromEulerRoute] Failed to sign a request:
This endpoint requires a Business plan. Purchase one at https://www.eulerstream.com/pricing.
```

room_id の取得(`fetchRoomId`)自体は成功するが、gift/list 取得が signRequest 必須 + room_id 必須 + Euler Business プラン(有料)必須に変更されていた。そのため本検証・比較表は全て **2.1.1-beta1** で行った。LIVE Sidestage 本体もこのバージョンに固定されているため、実運用上の影響はない。

---

## 2. 各方法での取得数

| 手法 | 条件 | 件数 | 備考 |
|------|------|------|------|
| Node GiftList | room_id無し(グローバルカタログ) | 684件(ユニークgiftId 680種) | `id=105810/12853/12852/7934` の4件がリスト内に2重出現(TikTok側の仕様、名前は同一で実害なし) |
| Node GiftList | room_id付き(room-scoped) | 680件 | グローバルカタログとほぼ同数だが、**配信者固有ギフト(community_gift)を含む一方、一部の通常ギフトが含まれない**(入れ替わりがある。詳細は7節) |
| Python GiftList | room_id無し | 684件 | Nodeと完全一致 |
| C# GiftList | — | **0件(全パターン失敗)** | 詳細は7節参照 |
| Direct API(Webcast直叩き) | room_id無し | 684件 | Node/Pythonと完全一致 |

---

## 3. 日本語名件数

`webcast_language=ja-JP` を指定した場合:

- 684件中 **663件(96.9%)** が日本語名になる(Node/Python/Direct APIで一致)
- 残り **21件** は `webcast_language=ja-JP` でも英語のまま。中身を確認したところ、いずれも**英語が正式名称のブランド/イベント系ギフト**で、ローカライズされないのが正しい挙動と判断できる:

  ```
  TikTok Universe / TikTok Universe+ / TikTok Stars / TikTok
  LIVE Ranking Party / LIVE Ranking Headband / LIVE Ranking Ticket(×2)
  Squirrel / Manifesting(×2) / Legendary Aegis / Warm Cocoa
  Corgi's Drone Show / Henry / Red Devil Corgi / travel with me
  GG / coldy / Music on Stage
  ```

  → 「日本語化されていない = 取得ロジックの不備」と単純に判定してはいけない好例。

---

## 4. 方法間の名称相違 giftId 数

全684 giftId 中、**ライブラリ間(Node/Python/Direct API)での名前の食い違いは0件**。同一条件(同一locale)であればどの実装でも完全に一致する。

一方、**GiftList(カタログ)と GiftEvent(実LIVE受信)を比較すると、1件だけ食い違いが見つかった**(詳細は7節)。`gift-name-differences.json` にはこの1件のみが記録されている。

これとは別の切り口として、**「同じ英語名・同じ値段なのに giftId が複数存在する」重複が684件中21組ある**(こちらは giftId が異なるので `gift-comparison.json` の DIFF フラグには乗らない)。詳細と一覧は7節「発見4」および[duplicate-gift-groups.json](duplicate-gift-groups.json)を参照。

---

## 5. locale パラメータ変更による名称変化

Node/Python/Direct APIの3系統で同一パターンを検証。結果は完全に一致した。

| パラメータ | 値 | 効果 |
|-----------|-----|------|
| `webcast_language` | `ja-JP` | ✅ **唯一有効**。684件中663件が日本語化 |
| `webcast_language` | `ja` | ❌ 無効(英語のまま、684件) |
| `webcast_language` | `ja_JP`(アンダースコア) | ❌ 無効。さらに **684→623件に減少**(無効なlocale文字列としてサーバー側で一部フィルタされる副作用あり) |
| `webcast_language` | `en` / `en-US` | 英語のまま(既定と同じ) |
| `app_language` | `ja-JP` | ❌ 無効 |
| `browser_language` | `ja-JP` | ❌ 無効 |
| `Accept-Language` ヘッダー | `ja-JP` | ❌ 無効 |
| Cookie(`tt-target-idc`) 有無 | 既定値 vs 明示指定 | 差異なし(結果に影響しない) |

→ 2026-08-27時点の過去検証(`webcast_language=ja-JP` のみが有効という結論)を、今回Node/Python/Direct APIのマルチライブラリ・マルチ言語検証で再確認できた。

---

## 6. region パラメータ変更による名称変化

| パラメータ | 値 | 効果 |
|-----------|-----|------|
| `region` | `JP` 単体 | ❌ 無効(英語のまま) |
| `region=JP` + `priority_region=JP` + `webcast_language=ja-JP` 併用 | — | `webcast_language=ja-JP` 単体と同じ663件が日本語化。region追加による変化なし |

→ region系パラメータはgift/listの言語には一切影響しない。

---

## 7. GiftList と GiftEvent の名称差、および配信者固有ギフトの挙動

実LIVE(`yu_ki_nojo`)に接続し、Node/Python/C#それぞれでGiftEventを観測した(Node/Pythonは15分間、C#も15分間)。

| giftId | Node GiftList | Node Event | Python GiftList | Python Event | C# Event | Direct API | coin |
|--------|--------------|-----------|-----------------|--------------|----------|-----------|------|
| 7934 | Heart Me | Heart Me | Heart Me | Heart Me | (観測0件) | Heart Me | 1 |
| 13651 | **Go Popular** | **Popular Vote** | **Go Popular** | **Popular Vote** | (観測0件) | Go Popular | 1 |
| 24964 | (通常カタログに無し) | リトルゆきのじょ | (通常カタログに無し) | リトルゆきのじょ | (観測0件) | (通常カタログに無し) | 1 |

**発見1: giftId=13651 はカタログ表示名とLIVE配信中の表示名が別物**
グローバルカタログでは `"Go Popular"` という名前で登録されているが、実際にLIVE配信で送られてきた際のイベント名は `"Popular Vote"` になる。これはNode/Python両方で複数回再現しており、ライブラリ側のバグではなく **TikTok側がカタログ名とイベント名を別管理している** 実例と判断する。この1件が今回の比較表で唯一の「DIFF」フラグ対象。

**発見2: 配信者固有(community_gift)ギフトは最初から日本語名で、`webcast_language` と無関係**
`giftId=24964`(「リトルゆきのじょ」)は `room_id` 無しのグローバルカタログ(684件)には一切登場しない。しかし `room_id` 付きで `gift/list` を叩く([node/room-scoped-gift-list.js](node/room-scoped-gift-list.js))と、`tracker_params.gift_subtype: "community_gift"` かつ `lock_info.lock: true` な配信者固有ギフトとして出現し、**`webcast_language` パラメータの値に関わらず最初から日本語名**で返ってくる。LIVEイベントでも同じ日本語名で届き、Node/Pythonの `enableExtendedGiftInfo` / `fetch_gift_info=True` 経由の事前取得でも正しく取得できることを確認した([raw/node-extended-gift-info-live.json](raw/node-extended-gift-info-live.json), [raw/python-gift-info-property-check.json](raw/python-gift-info-property-check.json))。

これは既存メモリに記録されていた「配信者ごとのサブスクギフトは日本語名で送られてくる」(例:「わやハグ」)という知見を、別配信者・別ギフトで再現・確証したものであり、CLAUDE.mdの記述「日本語は表示専用、一致キーは常に英語」が **community_gift には当てはまらない例外** であることを実測で裏付けた。

room_id付き取得ではこの他に `Giraffe`(11491)/`Diamond Gun`(134381)/`Zeus`(134396) の3件も通常カタログに存在しないギフトとして観測されたが、こちらは英語名のまま(community_gift扱いではない別カテゴリのギフトと見られる)。

**発見3: TikTokLiveSharp(C#) はgift情報関連の機能が実用に耐えない**
- **GiftList取得**: `enableExtendedGiftInfo: true` で接続後、`AvailableGifts` を最大10秒ポーリングしたが、`default-en-US` / `lang-ja-JP` / `lang-ja` / `clientParams(webcast_language=ja-JP)` の**全4パターンで空のまま**([raw/csharp-giftlist-summary.json](raw/csharp-giftlist-summary.json))。
- **GiftEvent購読**: `OnGiftRecieved` イベントハンドラを登録し15分間LIVE接続を維持したが(`connected. listening...` のログは出る=WebSocket接続自体は成立)、**イベントが一度も発火しなかった**(`raw/csharp-live-summary.json`)。同時間帯にNode/Pythonは同じ配信で計18件前後のギフトイベントを観測できているため、配信側の送信頻度の問題ではなく **TikTokLiveSharp 0.1.4(NuGet版)側の実装不備** と判断する。
- 加えて実装上の制約として、同一プロセス内で2つ目の `TikTokLiveClient` を生成すると `Timeout cannot be set after client has been initalised` で例外になる(HttpClientの使い回しに起因すると推測、GitHub上のmasterブランチは0.1.4とAPIが大きく異なっており正確な原因コードは特定できなかった)。この制約を回避するため、検証は「1プロセス1回のクライアント生成」に設計を変更し、外側をコマンド呼び出しループにして対応した。

**発見4: 同一ギフト(同アイコン・同エフェクト・同額)が別giftIdで重複登録されているケースが684件中21組(42+ giftId)ある。うち5組は日本語名まで別物になる**

ユーザー報告(実運用): 「モバイルのギフトパネルには "ユニコーンファンタジー" が表示されるが "幻のユニコーン" は表示されない。しかし実際に配信に入ると "幻のユニコーン" しか投げられない」という現象を、`find-duplicate-gifts.js` でカタログ全体を機械的に洗い出して裏付けた([duplicate-gift-groups.json](duplicate-gift-groups.json))。

英語名`"Unicorn Fantasy"` + `diamond_count=5000` の条件で該当するギフトが2件存在する:

| giftId | 日本語名 | icon.uri | primary_effect_id | is_displayed_on_panel | is_global_gift |
|--------|---------|----------|--------------------|-----------------------|-----------------|
| 5338 | ユニコーン ファンタジー | `483c644e...`(同一) | 9379(同一) | false | false |
| 7237 | 幻のユニコーン | `483c644e...`(同一) | 9379(同一) | false | false |

アイコン画像・エフェクトID・値段が完全に一致しており、**事実上同一のギフトが2つのgiftIdとして重複登録されている**。`is_displayed_on_panel` / `is_global_gift` はどちらも一致しない(該当グループ21件を全数確認したが、常に `false`/`false` か、値がバラバラで一貫しない)ため、**`gift/list` のレスポンスに含まれるフラグからは「どちらが実際に配信で使われる現行IDか」を判別できない**。

同種の重複は21組見つかり、うち5組は日本語名も別物になっている(単なるID重複ではなく、TikTok側で別々にローカライズ名が付けられている):

```
Viking Hammer|1500  → 18299:覇王のハンマー / 16282:雷鳴のハンマー
LIVE Ranking Party|3999 → 115548:LIVE Ranking Party / 738532:LIVEランキングのパーティー
Zeus|34000          → 8624:ゼウス / 16284:覇王ゼウス
Unicorn Fantasy|5000 → 5338:ユニコーン ファンタジー / 7237:幻のユニコーン
Hand Heart|100      → 5660:ハートポーズ / 8343:ハンドハート
```

残り16組は日本語名も同一(XXXL Flowers/Manifesting/Diamond Gun/Community Heart/Side by Side(3件)/LIVE Ranking Party系/Surprise Baby Mob/LIVE Ranking Ticket/Mishka Bear/TikTok Universe/Star Throne/Mystery Box/Magic Genie/Rose Hand/Club Victory/Club Power/Club Cheers)で、表示名としての実害は無いが、`gift/list` レスポンス自体に**廃止済み・地域限定・キャンペーン終了済みと見られる旧IDが生きたまま残り続けている**ことを示している。

**実務上の含意**: analytics本体([tiktok-gift-catalog.ts](../live-sidestage-analytics/src/lib/tiktok-gift-catalog.ts))は既にこの問題を認識しており(「670件中29の名前が複数giftIdを持つ」とCLAUDE.mdに明記)、**一致キーをgiftIdではなく名前(英語・小文字化)にする**ことでLIVEイベントとの突合を守っている。今回の実測はこの設計判断の妥当性を裏付ける一方、**giftIdをそのままカタログの主キーとして「選択肢の一覧」に使う経路(モバイルのギフトピッカー等)がもしあれば、廃止済みの旧ID側(本例では5338)が誤って選択肢に残り、実際に使われる現行ID(7237)が出てこない、という表示不具合を起こしうる**ことを示している。この経路が実際にLIVE Sidestageのどこかに存在するかは本検証の範囲外(本体コード非改変の制約)のため、別途確認が必要。

---

## 8. 日本版TikTokに最適な方法

`gift/list/` エンドポイントに **`webcast_language=ja-JP`** を付与する方法が、ライブラリ・言語を問わず唯一かつ十分な条件。661〜663件規模で日本語名が得られ、Node/Python/Direct APIの3系統で結果は完全一致する。`region`/`app_language`/`browser_language`/`Accept-Language`/Cookieはすべて無関係。

配信者固有ギフト(community_gift)まで含めて日本語名を揃えたい場合は、追加で **room_id 付きの `gift/list` 取得** を行う必要がある(7節)。

---

## 9. LIVE Sidestage で採用すべき方法

既存実装([tiktok-gift-catalog.ts](../live-sidestage-analytics/src/lib/tiktok-gift-catalog.ts))が採用している「英語版(既定)とja-JP版を2回叩いてgiftIdで突合する」設計は、今回の検証結果からも妥当と確認できた。本体のCLAUDE.mdによれば、**効果音マッチング等の一致キーは `giftId` ではなく「名前(英語・trim・小文字化)」** で、根拠として「670件中29の名前が複数giftIdを持ち、giftId自体もレスポンス内で重複する」ことが明記されている。今回の実測(発見4: 21組・42+ giftIdの重複)はこの設計判断が正しいことを裏付けた。追加の考察・改善余地:

- **room_id を渡しての追加取得**を組み合わせれば、community_gift(配信者固有ギフト)もカタログに正しく含められる。既存コードのコメントにもこの想定が書かれており、実測でも動作を確認できた。
- **giftId=13651 のようなカタログ名≠イベント名のケース**は、名前ベースの一致キーにとって死角になりうる。カタログ上は`"Go Popular"`(小文字化キー`"go popular"`)で登録されているが、LIVEイベントの`giftName`は`"Popular Vote"`(キー`"popular vote"`)で届くため、素朴な文字列一致では両者が別ギフト扱いになる。実害があるかは「このgiftIdの効果音が現在意図通り鳴っているか」を別途確認しないと判断できない。
- **重複giftId(発見4)のうち、モバイル等でギフトを選ぶ側のUIがgiftId単位で選択肢を出す設計になっている場合**、廃止済みの旧ID(本例では"ユニコーンファンタジー"=5338)が選択肢に残り、実際に配信で使われる現行ID(7237)が出てこない、という表示不具合を起こしうる。これは`tiktok-gift-catalog.ts`(カタログ取得・保存)自体の問題ではなく、それを消費する側(表示・選択UI)の設計次第で顕在化するため、該当UIの実装を個別に確認する必要がある。

## 10. フォールバック順の提案

1. **`tiktok-live-connector` 2.1.1-beta1 の `fetchAvailableGifts()`(`webcast_language=ja-JP`)** — 無料・room_id不要・現行運用実績あり。第一選択。
2. **Webcast API 直接呼び出し**(本検証の `direct-api.js` と同等のパラメータ・ヘッダーで直叩き) — 1が何らかの理由でライブラリごと壊れた場合の代替。ライブラリのバージョン依存を排除できる。
3. **Python `TikTokLive`(`fetch_gift_list()` / `fetch_gift_info=True`)** — Node実装系统が両方使えない場合の最終手段。データソースは同じWebcast APIなので結果は1・2と一致する。
4. `tiktok-live-connector` **2.4.4以降は無料枠では使用不可**(Euler Business プラン必須)なので、更新時は要注意。バージョン固定を外す場合は必ず有償プランの要否を再確認すること。
5. **C# `TikTokLiveSharp` 0.1.4はgift-list取得・イベント購読の両方が実測で機能しなかったため非推奨。** どうしてもC#実装が必要な場合は、本検証で使わなかった `TikTokLiveSharp` の別バージョンか、他のC#実装ライブラリを別途評価すること。

---

## 11. エラー・制約のまとめ(削除せず記録)

| 手法 | 症状 | 原因 | 対応 |
|------|------|------|------|
| Node `tiktok-live-connector` 2.4.4 | `SignatureMissingTokensError`(Business plan要求) | `fetchAvailableGifts()` がroom_id必須+署名必須+有料化 | 2.1.1-beta1に固定して検証続行 |
| C# GiftList(4パターン全て) | `AvailableGifts empty after connect (waited 10s)` | 0.1.4のNuGet版の内部実装不備(GitHub masterと乖離、原因コード未特定) | gift-list取得は不可として記録。フォールバック順から除外 |
| C# GiftEvent購読 | 15分間 `OnGiftRecieved` が0件 | 同上と推測(接続は成立するがイベント配送に不備) | LIVEイベント経由の取得も不可として記録 |
| C# 実装制約 | 2個目の `TikTokLiveClient` 生成で `Timeout cannot be set after client has been initalised` | HttpClient使い回しの疑い(未確定) | 1プロセス1クライアントに設計変更して回避 |
| Python `live_listener.py` | 15分タイムアウト後 `client.disconnect()` で `asyncio.exceptions.CancelledError`(exit code 1) | `wait_for` タイムアウト直後のキャンセル処理と競合 | データ収集(`python-gift-events.jsonl`)自体は正常完了しており実害なし |

---

## 付録: 生成物一覧

```
gift-name-verification/
├── REPORT.md                          (本ファイル)
├── gift-comparison.csv                (全684 giftId 統合比較表)
├── gift-comparison.json               (同内容の詳細JSON)
├── gift-name-differences.json         (名称相違1件のみ)
├── merge.js                           (比較表生成スクリプト)
├── node/                              (tiktok-live-connector 2.1.1-beta1)
├── python/                            (TikTokLive 7.0.0, venv)
├── csharp/                            (TikTokLiveSharp 0.1.4, .NET 8)
└── raw/                                (各取得方法の生レスポンス一式)
```
