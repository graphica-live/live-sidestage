import 'dart:convert';

/// 音源をどこから取ってきたか。表示と再取得の可否判断にのみ使う。
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

/// 「このギフトが来たらこの音を鳴らす」の1件。
///
/// トリガー・イベント・カテゴリ・音源ライブラリという中間概念は持たない。
/// 音源は1件につき1ファイルを専有し、他の [GiftSound] と共有しない
/// （同じ音を2つのギフトに割り当てたければ、2回取り込んで2ファイルになる）。
/// 共有しないので、この行を消せば実ファイルも必ず消せる。
class GiftSound {
  final String id;
  final bool enabled;

  /// 一致キー。`chat:gift` の giftName と同じく trim + 小文字化して保持する。
  /// 空文字は「任意のギフト」。
  final String giftName;

  /// 画面に出す表記。TikTok が返す元の大文字小文字をそのまま持つ。
  /// 一致判定には使わない。
  final String giftLabel;

  /// アプリ専用ディレクトリ `sounds/` 配下の実ファイル名（basename）。
  final String fileName;

  /// 音源の表示名。
  final String soundName;

  final SoundSourceKind source;
  final String? sourceUrl;

  /// 0-100。再生時に [SoundConfig.masterVolume] と掛け合わせる。
  final int volume;

  const GiftSound({
    required this.id,
    required this.giftName,
    required this.fileName,
    this.giftLabel = '',
    this.soundName = '',
    this.enabled = true,
    this.source = SoundSourceKind.local,
    this.sourceUrl,
    this.volume = 100,
  });

  /// 一覧で使う表記。giftLabel が空なら giftName、それも空なら「すべてのギフト」。
  String get displayGiftName {
    if (giftLabel.isNotEmpty) return giftLabel;
    if (giftName.isNotEmpty) return giftName;
    return 'すべてのギフト';
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'enabled': enabled,
        'giftName': giftName,
        'giftLabel': giftLabel,
        'fileName': fileName,
        'soundName': soundName,
        'source': source.name,
        'sourceUrl': sourceUrl,
        'volume': volume,
      };

  static GiftSound? tryParse(Map<String, dynamic> json) {
    final id = json['id'];
    final fileName = json['fileName'];
    if (id is! String || id.isEmpty) return null;
    // 実ファイル名が無い行は鳴らしようがないので捨てる。
    if (fileName is! String || fileName.isEmpty) return null;

    return GiftSound(
      id: id,
      enabled: json['enabled'] != false,
      giftName: _string(json['giftName'], maxLength: 80).trim().toLowerCase(),
      giftLabel: _string(json['giftLabel'], maxLength: 80),
      fileName: fileName,
      soundName: _string(json['soundName'], maxLength: 120),
      source: _enumFromName(SoundSourceKind.values, json['source'], SoundSourceKind.local),
      sourceUrl: json['sourceUrl'] as String?,
      volume: _clampInt(json['volume'], min: 0, max: 100, fallback: 100),
    );
  }

  GiftSound copyWith({
    bool? enabled,
    String? giftName,
    String? giftLabel,
    String? fileName,
    String? soundName,
    SoundSourceKind? source,
    String? sourceUrl,
    int? volume,
  }) {
    return GiftSound(
      id: id,
      enabled: enabled ?? this.enabled,
      giftName: giftName ?? this.giftName,
      giftLabel: giftLabel ?? this.giftLabel,
      fileName: fileName ?? this.fileName,
      soundName: soundName ?? this.soundName,
      source: source ?? this.source,
      sourceUrl: sourceUrl ?? this.sourceUrl,
      volume: volume ?? this.volume,
    );
  }
}

class SoundConfig {
  final bool enabled;
  final int masterVolume; // 0-100

  /// 設定順。同じギフトに複数一致したときはこの順に鳴らす。
  final List<GiftSound> gifts;

  const SoundConfig({
    this.enabled = true,
    this.masterVolume = 100,
    this.gifts = const [],
  });

  Map<String, dynamic> toJson() => {
        'enabled': enabled,
        'masterVolume': masterVolume,
        'gifts': gifts.map((g) => g.toJson()).toList(),
      };

  static SoundConfig fromJson(Map<String, dynamic> json) {
    return SoundConfig(
      enabled: json['enabled'] != false,
      masterVolume: _clampInt(json['masterVolume'], min: 0, max: 100, fallback: 100),
      gifts: _parseList(json['gifts'], GiftSound.tryParse),
    );
  }

  SoundConfig copyWith({bool? enabled, int? masterVolume, List<GiftSound>? gifts}) {
    return SoundConfig(
      enabled: enabled ?? this.enabled,
      masterVolume: masterVolume ?? this.masterVolume,
      gifts: gifts ?? this.gifts,
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
  /// v1: カテゴリ + トリガー + 音源ライブラリの3層構造。
  /// v2: 「ギフト → 音」の平坦な1層だけ。
  static const int currentSchemaVersion = 2;

  final int schemaVersion;
  final int revision;
  final bool ttsEnabled;
  final bool randomVoice;

  /// 読み上げの音量。0-100。効果音の [SoundConfig.masterVolume] と同じ尺度で、
  /// 再生時の AudioPlayer 音量に掛ける（VOICEVOX の volumeScale は触らない）。
  /// 合成音声は先読みするので、合成時に掛けると変更が次の1件に効かない。
  final int ttsVolume;

  final SoundConfig sound;

  const AppConfig({
    this.schemaVersion = currentSchemaVersion,
    this.revision = 0,
    this.ttsEnabled = true,
    this.randomVoice = true,
    this.ttsVolume = 100,
    this.sound = const SoundConfig(),
  });

  Map<String, dynamic> toJson() => {
        'schemaVersion': schemaVersion,
        'revision': revision,
        'ttsEnabled': ttsEnabled,
        'randomVoice': randomVoice,
        'ttsVolume': ttsVolume,
        'sound': sound.toJson(),
      };

  String encode() => jsonEncode(toJson());

  /// 壊れたJSON・未知のスキーマなら既定値を返す。設定が読めないことを理由に
  /// サービスごと起動不能にしない。
  ///
  /// **読めたかどうかを知りたい場合は [tryDecode] を使うこと。** 読めなかったのか
  /// 「空の設定が正しく読めた」のか区別できないと、音源ファイルの掃除で
  /// ユーザーのファイルを消してしまう。
  static AppConfig decode(String? raw) => tryDecode(raw) ?? const AppConfig();

  /// 解釈できたときだけ設定を返す。壊れたJSON・未知の未来バージョンなら null。
  ///
  /// v1（トリガー構造）は解釈できたものとして扱い、TTS 設定と効果音の
  /// 全体スイッチ・全体音量だけ引き継ぐ。トリガー・カテゴリ・音源ライブラリは
  /// v2 に対応物が無いので破棄する（未リリースのため移行対象の実データは無い）。
  static AppConfig? tryDecode(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      final json = Map<String, dynamic>.from(decoded);

      // schemaVersion が無い・数値でないものは最初期(v1)とみなす。読めるものを
      // 捨てないためで、**未来のバージョンだけ**は解釈できないので拒否する。
      final rawVersion = json['schemaVersion'];
      final version = rawVersion is int && rawVersion >= 1 ? rawVersion : 1;
      if (version > currentSchemaVersion) return null;

      final soundRaw = json['sound'];
      final soundJson = soundRaw is Map ? Map<String, dynamic>.from(soundRaw) : const <String, dynamic>{};

      // v1 は gifts を持たないので、SoundConfig.fromJson が空リストを返す。
      // enabled / masterVolume は意味が変わっていないのでそのまま引き継ぐ。
      return AppConfig(
        schemaVersion: currentSchemaVersion,
        revision: _clampInt(json['revision'], min: 0, max: 1 << 30, fallback: 0),
        ttsEnabled: json['ttsEnabled'] != false,
        randomVoice: json['randomVoice'] != false,
        ttsVolume: _clampInt(json['ttsVolume'], min: 0, max: 100, fallback: 100),
        sound: SoundConfig.fromJson(soundJson),
      );
    } catch (_) {
      return null;
    }
  }

  AppConfig copyWith({
    int? revision,
    bool? ttsEnabled,
    bool? randomVoice,
    int? ttsVolume,
    SoundConfig? sound,
  }) {
    return AppConfig(
      schemaVersion: schemaVersion,
      revision: revision ?? this.revision,
      ttsEnabled: ttsEnabled ?? this.ttsEnabled,
      randomVoice: randomVoice ?? this.randomVoice,
      ttsVolume: ttsVolume ?? this.ttsVolume,
      sound: sound ?? this.sound,
    );
  }

  /// 編集を1つ進めた新しい設定を作る。保存前に必ず通す。
  AppConfig bumped({bool? ttsEnabled, bool? randomVoice, int? ttsVolume, SoundConfig? sound}) {
    return copyWith(
      revision: revision + 1,
      ttsEnabled: ttsEnabled,
      randomVoice: randomVoice,
      ttsVolume: ttsVolume,
      sound: sound,
    );
  }
}
