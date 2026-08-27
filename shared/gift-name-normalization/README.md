# ギフト名キーの正規化（共通テストベクタ）

TikTok のギフト名を照合・辞書引きするときのキー正規化を、JS と Dart で同じ規則に保つための
共有テストベクタ。**データはこの1ファイル（`normalize-cases.json`）だけで、コードは共有しない。**

## 正規化仕様

1. アポストロフィ類（`‘` U+2018 / `’` U+2019 / `ʼ` U+02BC / `´` U+00B4 / `` ` `` U+0060）を ASCII の `'` に統一する
2. 空白類（連続スペース、タブ、全角スペース U+3000）を半角スペース1個にまとめる
3. 前後の空白を落とす
4. 小文字化する

TikTok から届く名前は `Adam’s Dream`（カーリー）と `It's Match Time`（ASCII）が混在するので、
1 を入れないと同じギフトを引けないことがある。Unicode の NFKC 正規化は使わない
（Dart に標準の正規化 API が無く、実装が言語間でずれるため）。

## 実装と、それを固定しているテスト

| 実装 | テスト |
| --- | --- |
| `live-sidestage-desktop/backend/lib/tiktok-gift-catalog.js` の `normalizeGiftNameKey()` | `live-sidestage-desktop/tests/unit/tiktok-gift-catalog.test.js` |
| `live-sidestage-mobile/lib/core/gift_name_ja.dart` の `GiftNameJa.normalizeKey()` | `live-sidestage-mobile/test/gift_name_ja_test.dart` |

両方のテストがこの JSON を読む。ケースを足すときはテスト側にベタ書きせず、ここへ足す。
実装がずれると、同じギフトの表示が端末とデスクトップで食い違う。

## 経緯

ここにはもともと `shared/gift-names/` という手作業のギフト名日本語辞書（553エントリ）があり、
`sync.mjs` が desktop と mobile へ配布していた。2026-08-27 に **TikTok の `gift/list/` が
`webcast_language=ja-JP` で公式の日本語名を返す**ことが分かったため、辞書は廃止した。

- desktop は `backend/lib/tiktok-gift-catalog.js` が英語版と日本語版を突き合わせて SQLite へ貯める
- mobile は analytics の `GET /api/mobile/gifts` が返す `labelJa` を端末へ貯める

正規化だけが残ったのは、**表示名を引くキーと、効果音トリガの一致キーの両方で今も要る**ため。
