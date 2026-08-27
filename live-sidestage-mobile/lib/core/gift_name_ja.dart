import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';

/// TikTok LIVE のギフト名（英語）→日本語表示名。
///
/// 供給元は **TikTok 公式**。サーバー（`GET /api/mobile/gifts`）が `labelJa` として返すものを
/// 端末へ貯めて引く。以前はモノレポの手作業辞書 `shared/gift-names/` をアセットに同梱していたが、
/// TikTok が `webcast_language=ja-JP` で公式の日本語名を返すと分かったので置き換えた
/// （手作業辞書は 553 件、公式は 651 件で表記も公式のほうが正しい）。
///
/// **表示専用**。効果音の一致判定に使う `GiftSound.giftName` は TikTok が送ってくる
/// 英語名のままにしておく（供給元が変わっても既存設定が鳴らなくならないように）。
///
/// 日本語→英語の逆引きは意図的に持たない。キーはここで正規化した形（アポストロフィ統一・
/// 空白畳み込み・小文字化）だが、鳴らす側の一致判定は `trim` + `toLowerCase` しかしないため、
/// 逆引き結果をそのまま保存すると表記の違うギフトで鳴らなくなる。日本語は候補の検索にだけ使う。
///
/// 未収録のギフトは英語名のままになる。キャッシュの読み込みに失敗したときも同じで、
/// 例外は投げない――表示を良くするためだけの資産なので、無ければ無いなりに動く。
///
/// **保存先は [AppConfig] とは別キーにしてある。** あちらは revision 同期・未来バージョン
/// ガード・孤児ファイル掃除が絡む繊細な機構で、650 件のカタログを載せると更新のたびに
/// 背景 Isolate への同期が走る。こちらは表示用の使い捨てキャッシュなので独立させる。
class GiftNameJa {
  GiftNameJa._();

  /// `FlutterForegroundTask.saveData` の保存キー。Map は保存できないので JSON 文字列で入れる。
  static const String storageKey = 'giftNamesJa';

  static Map<String, String> _entries = const {};
  static bool _loaded = false;

  static bool get isLoaded => _loaded;

  /// 収録件数。テストと診断用。
  static int get length => _entries.length;

  /// 端末に貯めた日本語名を1度だけ読む。[main] の `runApp` 前に呼ぶ。
  ///
  /// バックグラウンド Isolate では呼ばない（画面を持たないので日本語名を使わない）。
  /// 未ロードのまま [display] を呼んでも空として振る舞い、英語名を返す。
  static Future<void> ensureLoaded() async {
    if (_loaded) return;
    try {
      final raw = await FlutterForegroundTask.getData<String>(key: storageKey);
      if (raw != null && raw.isNotEmpty) {
        final decoded = jsonDecode(raw);
        if (decoded is Map) {
          final entries = <String, String>{};
          decoded.forEach((key, value) {
            if (key is String && value is String && key.isNotEmpty && value.isNotEmpty) {
              entries[key] = value;
            }
          });
          _entries = Map.unmodifiable(entries);
        }
      }
    } catch (_) {
      // キャッシュの欠落・破損。英語名フォールバックで動かす。
      _entries = const {};
    }
    _loaded = true;
  }

  /// サーバーから取れた日本語名で置き換えて永続化する。
  ///
  /// [nameToLabelJa] のキーはサーバーの `name`（英語の一致キー）、値は `labelJa`。
  ///
  /// **1件も日本語名が無いときは何もしない。** サーバー側が日本語の取得に失敗している間
  /// （カタログの `labelJa` が全 null）にこれを通すと、貯めてある日本語名を空で潰してしまい、
  /// 復旧するまで全画面が英語表示に戻る。
  static Future<void> updateFromServer(Map<String, String> nameToLabelJa) async {
    final entries = <String, String>{};
    nameToLabelJa.forEach((name, ja) {
      // **保存時に正規化する。** サーバーの `name` は trim + 小文字化しかされていないが、
      // [display] は [normalizeKey]（アポストロフィ統一・空白畳み込みを含む）で引く。
      // 揃えないと `Adam’s Dream` のようなカーリーアポストロフィのギフトが永久にミスヒットする。
      final key = normalizeKey(name);
      if (key.isEmpty || ja.isEmpty) return;
      entries[key] = ja;
    });
    if (entries.isEmpty) return;

    _entries = Map.unmodifiable(entries);
    _loaded = true;
    try {
      await FlutterForegroundTask.saveData(key: storageKey, value: jsonEncode(entries));
    } catch (_) {
      // 永続化に失敗してもこのプロセスでは引ける。次回起動で取り直す。
    }
  }

  @visibleForTesting
  static void resetForTest() {
    _entries = const {};
    _loaded = false;
  }

  /// テスト用。ストレージを介さずに中身を差し込む。
  @visibleForTesting
  static void seedForTest(Map<String, String> entries) {
    _entries = Map.unmodifiable({
      for (final e in entries.entries)
        if (normalizeKey(e.key).isNotEmpty && e.value.isNotEmpty) normalizeKey(e.key): e.value,
    });
    _loaded = true;
  }

  static final RegExp _apostrophes = RegExp(r"[‘’ʼ´`]");
  static final RegExp _whitespace = RegExp(r'[\s　]+');

  /// 日本語名を引くためのキー正規化。
  ///
  /// 規則は `shared/gift-name-normalization/normalize-cases.json` の共有ベクタが固定している。
  /// 同じ順序の実装が TikEffect（`backend/lib/tiktok-gift-catalog.js`）にもある。
  /// TikTok から届く名前は `Adam’s Dream`（カーリー）と `It's Match Time`（ASCII）が
  /// 混在するので、アポストロフィを統一しないと同じギフトを引けないことがある。
  static String normalizeKey(String raw) {
    return raw
        .replaceAll(_apostrophes, "'")
        .replaceAll(_whitespace, ' ')
        .trim()
        .toLowerCase();
  }

  /// [name]（英語のギフト名）の日本語表示名。
  ///
  /// 未収録なら [fallback]、それも空なら [name] をそのまま返す。
  /// 呼び出し側は TikTok の元表記（大文字小文字を保った名前）を [fallback] に渡すこと。
  static String display(String name, {String fallback = ''}) {
    final ja = _entries[normalizeKey(name)];
    if (ja != null) return ja;
    if (fallback.isNotEmpty) return fallback;
    return name;
  }
}
