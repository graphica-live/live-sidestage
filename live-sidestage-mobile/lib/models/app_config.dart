import 'dart:convert';

/// トリガーが反応するイベントの種類。
///
/// desktop(TikEffect)はトリガー種別を持たず、「giftName が入っていれば gift」
/// 「commentMode が any/exact なら comment」「follow は予約ギフト名」という
/// 暗黙の判別をしている。こちらは明示フィールドにする。
/// 条件判定の意味論(ギフト名一致・minCoins以上・コメント一致・ユーザー絞り込み)は
/// desktop と同じに保つ。
enum SoundEventType { gift, comment, follow }

/// desktop の eventPlayMode と同じ意味。
/// - [sequential]: 登録した音源を **全て** 順に鳴らす（1つ選ぶのではない）
/// - [random]: 1つだけランダムに選ぶ
enum SoundPlayMode { sequential, random }

enum SoundCommentMode { any, exact }

enum SoundSourceKind { local, soundEffectLab, myInstants }

T _enumFromName<T extends Enum>(List<T> values, Object? name, T fallback) {
  if (name is! String) return fallback;
  for (final v in values) {
    if (v.name == name) return v;
  }
  return fallback;
}

int _clampInt(Object? value, {required int min, required int max, required int fallback}) {
  final n = value is int ? value : (value is num ? value.toInt() : null);
  if (n == null) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

String _string(Object? value, {int maxLength = 200}) {
  if (value is! String) return '';
  return value.length > maxLength ? value.substring(0, maxLength) : value;
}

List<String> _stringList(Object? value) {
  if (value is! List) return const [];
  return value.whereType<String>().where((s) => s.isNotEmpty).toList(growable: false);
}

/// 1つの音源。desktop の「イベント」から音声部分だけを取り出したもの。
class SoundAsset {
  final String id;
  final String name;

  /// アプリ専用ディレクトリ `sounds/` 配下の実ファイル名。
  final String fileName;
  final SoundSourceKind source;
  final String? sourceUrl;

  /// 0-100。desktop の mediaVolume と同じ。
  final int volume;

  const SoundAsset({
    required this.id,
    required this.name,
    required this.fileName,
    required this.source,
    this.sourceUrl,
    this.volume = 100,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'fileName': fileName,
        'source': source.name,
        'sourceUrl': sourceUrl,
        'volume': volume,
      };

  static SoundAsset? tryParse(Map<String, dynamic> json) {
    final id = json['id'];
    final fileName = json['fileName'];
    if (id is! String || id.isEmpty || fileName is! String || fileName.isEmpty) return null;
    return SoundAsset(
      id: id,
      name: _string(json['name']),
      fileName: fileName,
      source: _enumFromName(SoundSourceKind.values, json['source'], SoundSourceKind.local),
      sourceUrl: json['sourceUrl'] as String?,
      volume: _clampInt(json['volume'], min: 0, max: 100, fallback: 100),
    );
  }

  SoundAsset copyWith({String? name, int? volume}) => SoundAsset(
        id: id,
        name: name ?? this.name,
        fileName: fileName,
        source: source,
        sourceUrl: sourceUrl,
        volume: volume ?? this.volume,
      );
}

/// カテゴリ。enabled=false で配下のトリガーをまとめて止める。
/// 個々のトリガーの enabled には干渉しない（desktop と同じ）。
class SoundCategory {
  final String id;
  final String name;
  final bool enabled;

  const SoundCategory({required this.id, required this.name, this.enabled = true});

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'enabled': enabled};

  static SoundCategory? tryParse(Map<String, dynamic> json) {
    final id = json['id'];
    if (id is! String || id.isEmpty) return null;
    return SoundCategory(
      id: id,
      name: _string(json['name'], maxLength: 60),
      enabled: json['enabled'] != false,
    );
  }

  SoundCategory copyWith({String? name, bool? enabled}) =>
      SoundCategory(id: id, name: name ?? this.name, enabled: enabled ?? this.enabled);
}

class SoundTrigger {
  final String id;
  final String name;
  final String categoryId;
  final bool enabled;

  /// 鳴らす音源。desktop の eventIds。
  final List<String> soundIds;
  final SoundPlayMode playMode;
  final SoundEventType eventType;

  /// 空 = 任意のギフト。desktop と同じく trim + 小文字化して保持する。
  final String giftName;
  final int minCoins;

  /// まとめ投げを1回として扱うか。desktop の既定と同じく true。
  final bool treatGiftComboAsSingle;

  final SoundCommentMode commentMode;

  /// commentMode が exact のときの一致文字列。小文字化して保持する。
  final String commentText;

  /// 空 = 全員。desktop と同じく uniqueId で絞り込む。
  final List<String> userIds;

  const SoundTrigger({
    required this.id,
    required this.name,
    required this.categoryId,
    this.enabled = true,
    this.soundIds = const [],
    this.playMode = SoundPlayMode.sequential,
    this.eventType = SoundEventType.gift,
    this.giftName = '',
    this.minCoins = 0,
    this.treatGiftComboAsSingle = true,
    this.commentMode = SoundCommentMode.any,
    this.commentText = '',
    this.userIds = const [],
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'categoryId': categoryId,
        'enabled': enabled,
        'soundIds': soundIds,
        'playMode': playMode.name,
        'eventType': eventType.name,
        'giftName': giftName,
        'minCoins': minCoins,
        'treatGiftComboAsSingle': treatGiftComboAsSingle,
        'commentMode': commentMode.name,
        'commentText': commentText,
        'userIds': userIds,
      };

  static SoundTrigger? tryParse(Map<String, dynamic> json) {
    final id = json['id'];
    if (id is! String || id.isEmpty) return null;
    return SoundTrigger(
      id: id,
      name: _string(json['name'], maxLength: 80),
      categoryId: _string(json['categoryId'], maxLength: 80),
      enabled: json['enabled'] != false,
      soundIds: _stringList(json['soundIds']),
      playMode: _enumFromName(SoundPlayMode.values, json['playMode'], SoundPlayMode.sequential),
      eventType: _enumFromName(SoundEventType.values, json['eventType'], SoundEventType.gift),
      giftName: _string(json['giftName'], maxLength: 80).trim().toLowerCase(),
      minCoins: _clampInt(json['minCoins'], min: 0, max: 100000000, fallback: 0),
      treatGiftComboAsSingle: json['treatGiftComboAsSingle'] != false,
      commentMode: _enumFromName(SoundCommentMode.values, json['commentMode'], SoundCommentMode.any),
      commentText: _string(json['commentText'], maxLength: 160).trim().toLowerCase(),
      userIds: _stringList(json['userIds']),
    );
  }

  SoundTrigger copyWith({
    String? name,
    String? categoryId,
    bool? enabled,
    List<String>? soundIds,
    SoundPlayMode? playMode,
    SoundEventType? eventType,
    String? giftName,
    int? minCoins,
    bool? treatGiftComboAsSingle,
    SoundCommentMode? commentMode,
    String? commentText,
    List<String>? userIds,
  }) {
    return SoundTrigger(
      id: id,
      name: name ?? this.name,
      categoryId: categoryId ?? this.categoryId,
      enabled: enabled ?? this.enabled,
      soundIds: soundIds ?? this.soundIds,
      playMode: playMode ?? this.playMode,
      eventType: eventType ?? this.eventType,
      giftName: giftName ?? this.giftName,
      minCoins: minCoins ?? this.minCoins,
      treatGiftComboAsSingle: treatGiftComboAsSingle ?? this.treatGiftComboAsSingle,
      commentMode: commentMode ?? this.commentMode,
      commentText: commentText ?? this.commentText,
      userIds: userIds ?? this.userIds,
    );
  }
}

class SoundConfig {
  final bool enabled;
  final int masterVolume; // 0-100
  final List<SoundCategory> categories;
  final List<SoundTrigger> triggers;
  final List<SoundAsset> assets;

  const SoundConfig({
    this.enabled = true,
    this.masterVolume = 100,
    this.categories = const [],
    this.triggers = const [],
    this.assets = const [],
  });

  Map<String, dynamic> toJson() => {
        'enabled': enabled,
        'masterVolume': masterVolume,
        'categories': categories.map((c) => c.toJson()).toList(),
        'triggers': triggers.map((t) => t.toJson()).toList(),
        'assets': assets.map((a) => a.toJson()).toList(),
      };

  static SoundConfig fromJson(Map<String, dynamic> json) {
    return SoundConfig(
      enabled: json['enabled'] != false,
      masterVolume: _clampInt(json['masterVolume'], min: 0, max: 100, fallback: 100),
      categories: _parseList(json['categories'], SoundCategory.tryParse),
      triggers: _parseList(json['triggers'], SoundTrigger.tryParse),
      assets: _parseList(json['assets'], SoundAsset.tryParse),
    );
  }

  SoundConfig copyWith({
    bool? enabled,
    int? masterVolume,
    List<SoundCategory>? categories,
    List<SoundTrigger>? triggers,
    List<SoundAsset>? assets,
  }) {
    return SoundConfig(
      enabled: enabled ?? this.enabled,
      masterVolume: masterVolume ?? this.masterVolume,
      categories: categories ?? this.categories,
      triggers: triggers ?? this.triggers,
      assets: assets ?? this.assets,
    );
  }
}

List<T> _parseList<T>(Object? value, T? Function(Map<String, dynamic>) parse) {
  if (value is! List) return const [];
  final result = <T>[];
  for (final item in value) {
    if (item is! Map) continue;
    final parsed = parse(Map<String, dynamic>.from(item));
    if (parsed != null) result.add(parsed);
  }
  return result;
}

/// UI Isolate と Foreground Service Isolate が共有する唯一の設定。
///
/// TTS 設定もここに含める。以前 `SpeechQueueController.enabled` は
/// フィールド初期値 true のままで永続化されておらず、サービスを再起動するたび
/// ON に戻っていた。
///
/// [revision] は単調増加。背景 Isolate は自分が保持しているものより新しい
/// revision のときだけ適用する。連続編集で非同期ロードが逆順に完了しても
/// 古い設定が勝たないようにするため。
class AppConfig {
  static const int currentSchemaVersion = 1;

  final int schemaVersion;
  final int revision;
  final bool ttsEnabled;
  final bool randomVoice;
  final SoundConfig sound;

  const AppConfig({
    this.schemaVersion = currentSchemaVersion,
    this.revision = 0,
    this.ttsEnabled = true,
    this.randomVoice = true,
    this.sound = const SoundConfig(),
  });

  Map<String, dynamic> toJson() => {
        'schemaVersion': schemaVersion,
        'revision': revision,
        'ttsEnabled': ttsEnabled,
        'randomVoice': randomVoice,
        'sound': sound.toJson(),
      };

  String encode() => jsonEncode(toJson());

  /// 壊れたJSON・未知のスキーマなら既定値を返す。設定が読めないことを理由に
  /// サービスごと起動不能にしない。
  static AppConfig decode(String? raw) {
    if (raw == null || raw.isEmpty) return const AppConfig();
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return const AppConfig();
      final json = Map<String, dynamic>.from(decoded);

      final version = json['schemaVersion'];
      if (version is int && version > currentSchemaVersion) return const AppConfig();

      final soundRaw = json['sound'];
      return AppConfig(
        schemaVersion: _clampInt(version, min: 1, max: currentSchemaVersion, fallback: currentSchemaVersion),
        revision: _clampInt(json['revision'], min: 0, max: 1 << 30, fallback: 0),
        ttsEnabled: json['ttsEnabled'] != false,
        randomVoice: json['randomVoice'] != false,
        sound: soundRaw is Map ? SoundConfig.fromJson(Map<String, dynamic>.from(soundRaw)) : const SoundConfig(),
      );
    } catch (_) {
      return const AppConfig();
    }
  }

  AppConfig copyWith({
    int? revision,
    bool? ttsEnabled,
    bool? randomVoice,
    SoundConfig? sound,
  }) {
    return AppConfig(
      schemaVersion: schemaVersion,
      revision: revision ?? this.revision,
      ttsEnabled: ttsEnabled ?? this.ttsEnabled,
      randomVoice: randomVoice ?? this.randomVoice,
      sound: sound ?? this.sound,
    );
  }

  /// 編集を1つ進めた新しい設定を作る。保存前に必ず通す。
  AppConfig bumped({bool? ttsEnabled, bool? randomVoice, SoundConfig? sound}) {
    return copyWith(
      revision: revision + 1,
      ttsEnabled: ttsEnabled,
      randomVoice: randomVoice,
      sound: sound,
    );
  }
}
