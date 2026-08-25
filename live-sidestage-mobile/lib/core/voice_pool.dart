import 'dart:convert';
import 'dart:math';

class VoiceStyle {
  final String characterName;
  final int styleId;
  final String styleName;

  VoiceStyle({
    required this.characterName,
    required this.styleId,
    required this.styleName,
  });

  static List<VoiceStyle> listFromMetasJson(String metasJson) {
    final decoded = jsonDecode(metasJson) as List<dynamic>;
    final result = <VoiceStyle>[];
    for (final speaker in decoded) {
      final name = speaker['name'] as String;
      final styles = speaker['styles'] as List<dynamic>;
      for (final style in styles) {
        if (style['type'] != null && style['type'] != 'talk') continue;
        result.add(VoiceStyle(
          characterName: name,
          styleId: style['id'] as int,
          styleName: style['name'] as String,
        ));
      }
    }
    return result;
  }
}

/// コメント投稿者(uniqueId)ごとにボイスを割り当てる。
/// ランダム割り当てはアプリのセッション中のみ保持し、永続化しない。
class VoicePool {
  VoicePool(this.styles) : _fixedStyleId = _firstStyleId(styles);

  final List<VoiceStyle> styles;
  final Map<String, int> _userVoiceCache = {};
  final Random _random = Random();

  bool randomEnabled = true;

  static int _firstStyleId(List<VoiceStyle> styles) =>
      styles.isNotEmpty ? styles.first.styleId : 0;

  int _fixedStyleId;

  int get fixedStyleId => _fixedStyleId;

  /// 設定から来た値をそのまま信用しない。**このモデルに無い styleId を保持すると
  /// 合成のたびに `createAudioQuery` が失敗し、読み上げが丸ごと無音になる。**
  /// 設定側の静的なボイス一覧(`VoiceCatalog`)と同梱 vvm がズレたときの逃げ道で、
  /// 知らない値なら先頭のボイスへ落とす。
  set fixedStyleId(int value) {
    _fixedStyleId =
        styles.any((s) => s.styleId == value) ? value : _firstStyleId(styles);
  }

  int effectiveStyleId(String uniqueId) {
    if (!randomEnabled) return fixedStyleId;

    final cached = _userVoiceCache[uniqueId];
    if (cached != null) return cached;

    if (styles.isEmpty) return fixedStyleId;
    final chosen = styles[_random.nextInt(styles.length)].styleId;
    _userVoiceCache[uniqueId] = chosen;
    return chosen;
  }

  String? characterNameForStyleId(int styleId) {
    for (final s in styles) {
      if (s.styleId == styleId) return s.characterName;
    }
    return null;
  }

  void resetRandomAssignments() {
    _userVoiceCache.clear();
  }
}
