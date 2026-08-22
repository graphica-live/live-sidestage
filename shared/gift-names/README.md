# ギフト名日本語辞書（sidestage 共通資産）

TikTok LIVE のギフト名（英語）を日本語の表示名へ置き換えるための辞書。
もとは TikEffect（`live-sidestage-desktop`）の JS ソースに埋め込まれていたものを、
プロジェクトをまたいで使えるようにここへ切り出した。

**表示専用**。ギフトの一致判定（効果音のトリガ、集計キー）には使わない。
一致には TikTok が実際に送ってくる英語名を使い続ける。

## ファイル

| ファイル | 役割 |
| --- | --- |
| `gift-names-ja.json` | **正本**。英語名 → 日本語表示名。 |
| `gift-names-ja-reference.json` | **正本**。実機の TikTok 日本語クライアントから採取した日本語ギフト名のコイン昇順リスト。英語名との対応は未確定で、TikEffect の対訳エディタが候補を絞るためだけに使う。 |
| `normalize-cases.json` | 正規化の共有テストベクタ。JS と Dart のテストが両方これを読む。 |
| `sync.mjs` | 検証と配布。 |

`gift-names-ja.json` の構造:

```json
{
  "version": 1,
  "normalization": "trim -> unify apostrophes -> collapse whitespace -> lowercase",
  "entries": {
    "a shard of hope": "希望のかけら",
    "tiktok universe+": "TikTok Universe+"
  }
}
```

`entries` は正規化済みの英語名 → 表示名。日本語環境でも英語表記のままのギフト
（`GG` / `TikTok Universe+` など）も、**正式な英語表記を値として**ここに入れる。
辞書から外すと呼び出し元の表記に任せることになり、元表記を持っていない古い設定では
小文字化された英語が出てしまうため。

値が正規化キーそのもの（`"gg": "gg"` のように小文字英語）になっているものは
`sync.mjs` がエラーにする。訳も正式表記も分からないなら、行ごと消して
呼び出し元のフォールバックに任せる。

## 追加・修正のしかた

1. **実際の TikTok（日本語環境）で確認できた対訳だけ**を追加する。推測で訳さない。
2. `entries` にキーと値を足す。キーは下の正規化仕様に従った形にする（`sync.mjs` が違反を弾く）。
3. 日本語環境でも英語のままだったギフトは、その**正式表記**（`TikTok Universe+`）を値にする。
4. `node shared/gift-names/sync.mjs` を実行して配布コピーを更新する。
5. 正本と配布コピーを同じコミットに含める。

TikEffect の対訳エディタ（`/db/gift-ja-editor.html` → `POST /api/gift-name-ja`）から編集した場合は、
開発リポジトリ内で動いていれば正本と配布コピーの両方が自動で更新される。
インストール版（asar 内）からは編集できない。

## 正規化仕様

辞書を引くときのキーは、次の順序で正規化する。

1. アポストロフィ類（`‘` U+2018 / `’` U+2019 / `ʼ` U+02BC / `´` U+00B4 / `` ` `` U+0060）を ASCII の `'` に統一する
2. 空白類（連続スペース、タブ、全角スペース U+3000）を半角スペース1個にまとめる
3. 前後の空白を落とす
4. 小文字化する

TikTok から届く名前は `Adam’s Dream`（カーリー）と `It's Match Time`（ASCII）が混在するので、
1 を入れないと同じギフトを引けないことがある。Unicode の NFKC 正規化は使わない
（Dart に標準の正規化 API が無く、実装が言語間でずれるため）。

この規則は次の3箇所に同じ順序で実装されている。変えるときは3つとも直すこと。

- `shared/gift-names/sync.mjs` の `normalizeGiftNameKey()`
- `live-sidestage-desktop/backend/lib/gift-name-ja.js` の `normalizeGiftNameKey()`
- `live-sidestage-mobile/lib/core/gift_name_ja.dart` の `GiftNameJa.normalizeKey()`

実装がずれると同じギフトの表示が端末とデスクトップで食い違う。それを防ぐため、
入出力の組を `normalize-cases.json` に置き、両方のテストがそれを読んで検証している。

- `live-sidestage-desktop/tests/unit/gift-name-ja.test.js`
- `live-sidestage-mobile/test/gift_name_ja_test.dart`

ケースを足すときは `normalize-cases.json` に足す（テスト側にベタ書きしない）。

## 配布コピー

各プロジェクトのビルドはリポジトリルートを参照できない（electron-builder の `files` は
アプリディレクトリ配下しか含められず、Flutter の asset も package 外を辿れない）。
そのため `sync.mjs` が正本をそのままコピーして配る。**コピーは生成物。直接編集しない。**

| 配布先 | 使う側 |
| --- | --- |
| `live-sidestage-desktop/backend/lib/gift-names/gift-names-ja.json` | TikEffect の `backend/lib/gift-name-ja.js` |
| `live-sidestage-desktop/backend/lib/gift-names/gift-names-ja-reference.json` | TikEffect の対訳エディタ |
| `live-sidestage-mobile/assets/gift_names/gift_names_ja.json` | Flutter アプリの `lib/core/gift_name_ja.dart`（`pubspec.yaml` の assets に登録済み） |

プロジェクトを増やすときは `sync.mjs` の `TARGETS` に1行足す。

## 検証

```bash
node shared/gift-names/sync.mjs --check
```

正本の整形崩れ・キーの未正規化・重複・空値・値が小文字英語のままのエントリ、
そして配布コピーの更新漏れを検出する。ルートの `.githooks/pre-commit` と
GitHub Actions（`.github/workflows/shared-gift-names.yml`）の両方から走る。
