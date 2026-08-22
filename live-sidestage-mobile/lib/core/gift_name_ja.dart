import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// TikTok LIVE のギフト名（英語）→日本語表示名の辞書。
///
/// 実体は `assets/gift_names/gift_names_ja.json`。モノレポの共通資産
/// `shared/gift-names/gift-names-ja.json` を `shared/gift-names/sync.mjs` が
/// コピーしたもので、TikEffect（デスクトップ版）と同じ内容を参照している。
/// アセットは生成物なので直接編集しない。
///
/// **表示専用**。効果音の一致判定に使う [GiftSound.giftName] は TikTok が送ってくる
/// 英語名のままにしておく（辞書が変わっても既存設定が鳴らなくならないように）。
///
/// 日本語→英語の逆引きは意図的に持たない。辞書のキーはここで正規化した形（アポストロフィ統一・
/// 空白畳み込み・小文字化）だが、鳴らす側の一致判定は `trim` + `toLowerCase` しかしないため、
/// 逆引き結果をそのまま保存すると表記の違うギフトで鳴らなくなる。日本語は候補の検索にだけ使う。
///
/// 未収録のギフトは英語名のままになる。辞書の読み込みに失敗したときも同じで、
/// 例外は投げない――表示を良くするためだけの資産なので、無ければ無いなりに動く。
class GiftNameJa {
  GiftNameJa._();

  static const String assetPath = 'assets/gift_names/gift_names_ja.json';

  static Map<String, String> _entries = const {};
  static bool _loaded = false;

  static bool get isLoaded => _loaded;

  /// 収録件数。テストと診断用。
  static int get length => _entries.length;

  /// 辞書を1度だけ読む。[main] の `runApp` 前に呼ぶ。
  ///
  /// バックグラウンド Isolate では呼ばない（画面を持たないので辞書を使わない）。
  /// 未ロードのまま [display] を呼んでも空の辞書として振る舞い、英語名を返す。
  static Future<void> ensureLoaded({AssetBundle? bundle}) async {
    if (_loaded) return;
    try {
      final raw = await (bundle ?? rootBundle).loadString(assetPath);
      final decoded = jsonDecode(raw);
      if (decoded is Map && decoded['entries'] is Map) {
        final entries = <String, String>{};
        (decoded['entries'] as Map).forEach((key, value) {
          if (key is String && value is String && key.isNotEmpty && value.isNotEmpty) {
            entries[key] = value;
          }
        });
        _entries = Map.unmodifiable(entries);
      }
    } catch (_) {
      // アセットの欠落・破損。英語名フォールバックで動かす。
      _entries = const {};
    }
    _loaded = true;
  }

  @visibleForTesting
  static void resetForTest() {
    _entries = const {};
    _loaded = false;
  }

  static final RegExp _apostrophes = RegExp(r"[‘’ʼ´`]");
  static final RegExp _whitespace = RegExp(r'[\s　]+');

  /// 辞書を引くためのキー正規化。
  ///
  /// `shared/gift-names/README.md` の「正規化仕様」と同じ規則。同じ順序の実装が
  /// `shared/gift-names/sync.mjs` と TikEffect の `backend/lib/gift-name-ja.js` にもある。
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
