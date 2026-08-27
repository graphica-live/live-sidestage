import 'dart:convert';

import 'voice_catalog.dart';

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
///
/// ## 音源ファイルの共有
///
/// 取り込みは1件につき1ファイルを作る（同じ音を2つのギフトに割り当てたければ、
/// 2回取り込んで2ファイルになる）。**ただし [SoundSet] の複製は `fileName` を
/// そのまま引き継ぐ**ので、1つの実ファイルを複数の [GiftSound] が参照しうる。
/// 実ファイルをコピーすると最大5セットぶんに膨らみ、[SoundLibrary] の総容量上限に
/// 当たるため、共有する側を選んでいる。
///
/// したがって **この行を消しても実ファイルを消してよいとは限らない。**
/// 削除するときは必ず [SoundConfig.referencedFileNames] で全セットを横断して
/// 参照が残っていないことを確かめる。
class GiftSound {
  /// 新しい行の id を作る。同じマイクロ秒に複数作られてもぶつからないよう連番を足す
  /// （セット複製は1回で最大N件を作る）。
  static int _sequence = 0;
  static String newId() => 'gs_${DateTime.now().microsecondsSinceEpoch}_${_sequence++}';

  final String id;
  final bool enabled;

  /// 一致キー。`chat:gift` の giftName と同じく trim + 小文字化して保持する。
  /// 空文字は「任意のギフト」。
  final String giftName;

  /// 画面に出す表記。TikTok が返す元の大文字小文字をそのまま持つ。
  /// 一致判定には使わない。
  final String giftLabel;

  /// 選んだ時点での TikTok 公式の日本語表示名。一致判定には使わない。
  ///
  /// 日本語表示の本線は [GiftNameJa]（サーバーから取って端末へ貯めるキャッシュ）で、
  /// こちらはそれが空のとき用の保険。キャッシュはアプリのデータを消すと失われるが、
  /// 設定と一緒に保存してあれば選び直さずに日本語で出せる。
  ///
  /// **新しいキーだが [AppConfig.currentSchemaVersion] は上げない**（旧アプリは無視するだけ。
  /// 上げると旧アプリが未来バージョンと判定して設定の保存を止める）。
  final String giftLabelJa;

  /// 選んだギフトの絵（TikTok の画像 CDN の https URL）。
  /// 画像を持たないギフト・自由入力・「どのギフトでも」では null。
  final String? giftImageUrl;

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
    this.giftLabelJa = '',
    this.giftImageUrl,
    this.soundName = '',
    this.enabled = true,
    this.source = SoundSourceKind.local,
    this.sourceUrl,
    this.volume = 100,
  });

  /// 一覧で使う表記。日本語 → 元表記 → 一致キー → 「すべてのギフト」の順。
  String get displayGiftName {
    if (giftLabelJa.isNotEmpty) return giftLabelJa;
    if (giftLabel.isNotEmpty) return giftLabel;
    if (giftName.isNotEmpty) return giftName;
    return 'すべてのギフト';
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'enabled': enabled,
        'giftName': giftName,
        'giftLabel': giftLabel,
        'giftLabelJa': giftLabelJa,
        'giftImageUrl': giftImageUrl,
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
      // 旧バージョンの設定はキー自体を持たない。空文字で読み、表示は giftLabel へ落ちる。
      giftLabelJa: _string(json['giftLabelJa'], maxLength: 80),
      giftImageUrl: _httpsUrl(json['giftImageUrl']),
      fileName: fileName,
      soundName: _string(json['soundName'], maxLength: 120),
      source: _enumFromName(SoundSourceKind.values, json['source'], SoundSourceKind.local),
      sourceUrl: json['sourceUrl'] as String?,
      volume: _clampInt(json['volume'], min: 0, max: 100, fallback: 100),
    );
  }

  /// `Image.network` へそのまま渡る値なので、保存済み設定から読み直すときも
  /// https だけは確かめる（旧バージョンの設定はキー自体を持たないので null）。
  static String? _httpsUrl(Object? value) {
    if (value is! String || value.isEmpty) return null;
    final uri = Uri.tryParse(value);
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) return null;
    return value;
  }

  /// 未指定と「null にする」を区別するための番兵。ギフトを選び直したとき、
  /// 画像を持たないギフトなら前のギフトの絵を消さなければならない。
  static const Object _unset = Object();

  GiftSound copyWith({
    bool? enabled,
    String? giftName,
    String? giftLabel,
    String? giftLabelJa,
    Object? giftImageUrl = _unset,
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
      giftLabelJa: giftLabelJa ?? this.giftLabelJa,
      giftImageUrl: identical(giftImageUrl, _unset)
          ? this.giftImageUrl
          : giftImageUrl as String?,
      fileName: fileName ?? this.fileName,
      soundName: soundName ?? this.soundName,
      source: source ?? this.source,
      sourceUrl: sourceUrl ?? this.sourceUrl,
      volume: volume ?? this.volume,
    );
  }

  /// 同じ内容で id だけ differing なコピーを作る。[SoundConfig.duplicateSet] 用。
  ///
  /// [copyWith] は id を変更できない（同一性を保つための意図的な制限）ので別口にする。
  /// 複製先で id を振り直さないと、まとめ投げの抑止キー `'<giftSoundId>|<comboId>'`
  /// が複製元と衝突する。**`fileName` は共有したままにする**（実ファイルはコピーしない）。
  GiftSound cloneWithNewId(String newId) {
    return GiftSound(
      id: newId,
      enabled: enabled,
      giftName: giftName,
      giftLabel: giftLabel,
      giftLabelJa: giftLabelJa,
      giftImageUrl: giftImageUrl,
      fileName: fileName,
      soundName: soundName,
      source: source,
      sourceUrl: sourceUrl,
      volume: volume,
    );
  }
}

/// ギフトサウンド設定の1セット。
///
/// 企画（通常配信 / ダンス / バトル など）ごとに「ギフト → 音」の組を持ち替えるための
/// 入れ物。**セットごとの有効/無効は持たない** — 同時に有効なセットは常に1つで、
/// どれを使うかは [SoundConfig.selectedSetId] だけが決める。
class SoundSet {
  /// 既定セットの id。**時刻から作らず固定値にする。**
  ///
  /// 旧形式（平坦な `gifts[]`）からの移行と新規インストールの既定値は、UI Isolate と
  /// 背景 Isolate が同じ JSON をそれぞれ独立に decode する。時刻由来の id では
  /// 両者で別の値になり、`selectedSetId` が食い違う。
  static const String defaultId = 'set_main';
  static const String defaultName = 'メイン';

  static const int maxNameLength = 40;

  static int _sequence = 0;
  static String newId() => 'set_${DateTime.now().microsecondsSinceEpoch}_${_sequence++}';

  /// セット名を保存できる形へ整える。空になったら既定の表記へ落とす。
  static String normalizeName(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return 'セット';
    return trimmed.length > maxNameLength ? trimmed.substring(0, maxNameLength) : trimmed;
  }

  final String id;
  final String name;

  /// 設定順。同じギフトに複数一致したときはこの順に鳴らす。
  final List<GiftSound> gifts;

  const SoundSet({
    required this.id,
    this.name = defaultName,
    this.gifts = const [],
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'gifts': gifts.map((g) => g.toJson()).toList(),
      };

  /// id を持たないセットは参照しようがないので捨てる。
  /// 中身が空でも残す（ギフトを1件も登録していないセットは正常な状態）。
  static SoundSet? tryParse(Map<String, dynamic> json) {
    final id = json['id'];
    if (id is! String || id.isEmpty) return null;
    return SoundSet(
      id: id,
      name: normalizeName(_string(json['name'], maxLength: maxNameLength)),
      gifts: _parseList(json['gifts'], GiftSound.tryParse),
    );
  }

  SoundSet copyWith({String? name, List<GiftSound>? gifts}) {
    return SoundSet(
      id: id,
      name: name ?? this.name,
      gifts: gifts ?? this.gifts,
    );
  }
}

/// 効果音の設定全体。
///
/// [enabled] は「効果音を開始しているか」で、`serviceRunning` と組にして
/// 運用中かどうかを表す（`started = enabled && serviceRunning`）。専用の
/// `isRunning` フィールドは持たない。
///
/// [masterVolume] は**セットをまたいだ共通設定**。セット固有の音量は
/// [GiftSound.volume] 側にある。
///
/// ## 不変条件
///
/// 生成経路（コンストラクタ・[fromJson]・CRUD メソッド）すべてが [_normalized] を
/// 通るので、次は常に成り立つ:
///
/// - [sets] は 1〜[maxSets] 件（空にならない）
/// - セット id は重複しない
/// - [selectedSetId] は必ず [sets] のどれかを指す
class SoundConfig {
  static const int maxSets = 5;

  /// 正規化済みの値だけを受け取る内部用。外からは [SoundConfig.new] を使う。
  const SoundConfig._({
    required this.enabled,
    required this.masterVolume,
    required this.selectedSetId,
    required this.sets,
  });

  /// 既定値。**セットは必ず1件あるので、ここも空にしない。**
  static const SoundConfig initial = SoundConfig._(
    enabled: true,
    masterVolume: 100,
    selectedSetId: SoundSet.defaultId,
    sets: [SoundSet(id: SoundSet.defaultId)],
  );

  factory SoundConfig({
    bool enabled = true,
    int masterVolume = 100,
    String? selectedSetId,
    List<SoundSet>? sets,
  }) {
    return _normalized(
      enabled: enabled,
      masterVolume: masterVolume,
      selectedSetId: selectedSetId,
      sets: sets,
    );
  }

  final bool enabled;
  final int masterVolume; // 0-100
  final String selectedSetId;
  final List<SoundSet> sets;

  static SoundConfig _normalized({
    required bool enabled,
    required int masterVolume,
    required String? selectedSetId,
    required List<SoundSet>? sets,
  }) {
    // **重複除去が先、件数の切り詰めが後。** 逆順にすると `[A, A, B, C, D, E]` が
    // 4件になり、上限に収まるはずのセットを余計に落とす。
    final unique = <SoundSet>[];
    final seen = <String>{};
    for (final set in sets ?? const <SoundSet>[]) {
      if (set.id.isEmpty || !seen.add(set.id)) continue;
      unique.add(set);
      if (unique.length >= maxSets) break;
    }

    final normalized = unique.isEmpty
        ? const <SoundSet>[SoundSet(id: SoundSet.defaultId)]
        : List<SoundSet>.unmodifiable(unique);

    return SoundConfig._(
      enabled: enabled,
      masterVolume: masterVolume.clamp(0, 100),
      // 指す先が無ければ先頭へ。ここで必ず解決するので、参照側は存在を確認しなくてよい。
      selectedSetId: normalized.any((s) => s.id == selectedSetId)
          ? selectedSetId!
          : normalized.first.id,
      sets: normalized,
    );
  }

  // ── 参照 ────────────────────────────────────────────────────────────────────

  /// 現在選択中のセット。不変条件より必ず存在する。
  SoundSet get selectedSet =>
      sets.firstWhere((s) => s.id == selectedSetId, orElse: () => sets.first);

  /// 鳴らす対象。[SoundEngine] はこれだけを見る。
  List<GiftSound> get selectedGifts => selectedSet.gifts;

  /// **全セットを横断した**参照中のファイル名。
  ///
  /// 音源ファイルを消してよいかの判定と、孤児ファイルの掃除で使う。選択中セットだけを
  /// 見ると、裏のセットが使っているファイルを消してしまう。
  Set<String> get referencedFileNames => {
        for (final set in sets)
          for (final gift in set.gifts) gift.fileName,
      };

  bool get canAddSet => sets.length < maxSets;

  /// 最後の1セットは消せない（空のセット状態を作らない）。
  bool get canRemoveSet => sets.length > 1;

  // ── セット操作 ──────────────────────────────────────────────────────────────
  //
  // 上限・最後の1件・選択の付け替えは**すべてここで再確認する**。UI 側の出し分けだけに
  // 頼ると、連打や画面の取り違えで不変条件が破れる。保存は直列化されているので、
  // ここで弾けば最終的な状態は必ず正しい。

  SoundConfig addSet(String name, {String? id}) {
    if (!canAddSet) return this;
    final setId = id ?? SoundSet.newId();
    // 既存 id とぶつかると正規化が新しい方を落とし、「追加したのに増えていない」
    // 状態になる。ここで弾いて何もしなかったことを明確にする。
    if (sets.any((s) => s.id == setId)) return this;

    return copyWith(
      sets: [...sets, SoundSet(id: setId, name: SoundSet.normalizeName(name))],
      selectedSetId: setId,
    );
  }

  SoundConfig renameSet(String setId, String name) {
    if (!sets.any((s) => s.id == setId)) return this;
    final normalized = SoundSet.normalizeName(name);
    return copyWith(
      sets: [for (final s in sets) s.id == setId ? s.copyWith(name: normalized) : s],
    );
  }

  /// [setId] のセットを複製して直後へ挿し、複製先を選択する。
  ///
  /// ギフト行は id を振り直すが、**`fileName` は共有する**（実ファイルはコピーしない）。
  SoundConfig duplicateSet(String setId, String name, {String? id}) {
    if (!canAddSet) return this;
    final index = sets.indexWhere((s) => s.id == setId);
    if (index < 0) return this;

    final copyId = id ?? SoundSet.newId();
    if (sets.any((s) => s.id == copyId)) return this;

    final copy = SoundSet(
      id: copyId,
      name: SoundSet.normalizeName(name),
      gifts: [for (final g in sets[index].gifts) g.cloneWithNewId(GiftSound.newId())],
    );
    return copyWith(
      sets: [...sets.take(index + 1), copy, ...sets.skip(index + 1)],
      selectedSetId: copy.id,
    );
  }

  SoundConfig removeSet(String setId) {
    if (!canRemoveSet) return this;
    final index = sets.indexWhere((s) => s.id == setId);
    if (index < 0) return this;

    final next = [...sets]..removeAt(index);
    // 選択中を消したら同じ位置のセットへ移す（末尾を消したなら手前）。
    // 先頭へ飛ばすと、隣を消しただけで見ている場所が変わって混乱する。
    final selected = setId == selectedSetId
        ? next[index < next.length ? index : next.length - 1].id
        : selectedSetId;
    return copyWith(sets: next, selectedSetId: selected);
  }

  /// [oldIndex] のセットを取り除いてから [newIndex] へ挿し直す
  /// （`ReorderableListView` の `onReorderItem` と同じ index の意味）。
  SoundConfig reorderSets(int oldIndex, int newIndex) {
    if (oldIndex < 0 || oldIndex >= sets.length) return this;
    final next = [...sets];
    final moved = next.removeAt(oldIndex);
    next.insert(newIndex.clamp(0, next.length), moved);
    return copyWith(sets: next);
  }

  SoundConfig selectSet(String setId) =>
      sets.any((s) => s.id == setId) ? copyWith(selectedSetId: setId) : this;

  /// [setId] のセットのギフト一覧を差し替える。
  ///
  /// **対象を id で明示的に受ける。**「現在選択中のセットを更新する」API にしてはいけない
  /// — 編集画面を開いている間に選択が変わると、別のセットへ保存してしまう。
  ///
  /// セットが既に消えていれば [StateError]。黙って別のセットへ書き足さない。
  SoundConfig updateSet(
    String setId,
    List<GiftSound> Function(List<GiftSound> gifts) transform,
  ) {
    final index = sets.indexWhere((s) => s.id == setId);
    if (index < 0) {
      throw StateError('セットが見つかりません: $setId');
    }
    final next = [...sets];
    next[index] = next[index].copyWith(gifts: transform(next[index].gifts));
    return copyWith(sets: next);
  }

  // ── 永続化 ──────────────────────────────────────────────────────────────────

  Map<String, dynamic> toJson() => {
        'enabled': enabled,
        'masterVolume': masterVolume,
        'selectedSetId': selectedSetId,
        'sets': sets.map((s) => s.toJson()).toList(),
      };

  static SoundConfig fromJson(Map<String, dynamic> json) {
    final enabled = json['enabled'] != false;
    final masterVolume = _clampInt(json['masterVolume'], min: 0, max: 100, fallback: 100);

    final rawSets = json['sets'];
    if (rawSets is List) {
      return SoundConfig(
        enabled: enabled,
        masterVolume: masterVolume,
        selectedSetId: _string(json['selectedSetId'], maxLength: 80),
        sets: _parseList(rawSets, SoundSet.tryParse),
      );
    }

    // v2 以前: 平坦な `gifts[]` を「メイン」1セットへ包む。ギフト・音・個別音量は
    // すべて GiftSound の中にあるので、リストを移すだけで失われない。
    // v1 は `gifts` も持たないので、空の「メイン」1件になる（従来と同じ結果）。
    return SoundConfig(
      enabled: enabled,
      masterVolume: masterVolume,
      selectedSetId: SoundSet.defaultId,
      sets: [
        SoundSet(
          id: SoundSet.defaultId,
          gifts: _parseList(json['gifts'], GiftSound.tryParse),
        ),
      ],
    );
  }

  SoundConfig copyWith({
    bool? enabled,
    int? masterVolume,
    String? selectedSetId,
    List<SoundSet>? sets,
  }) {
    return SoundConfig(
      enabled: enabled ?? this.enabled,
      masterVolume: masterVolume ?? this.masterVolume,
      selectedSetId: selectedSetId ?? this.selectedSetId,
      sets: sets ?? this.sets,
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
  /// v3: v2 のギフト一覧を [SoundSet] へ入れ子にし、最大5セットを持てるようにした。
  static const int currentSchemaVersion = 3;

  final int schemaVersion;
  final int revision;
  final bool ttsEnabled;
  final bool randomVoice;

  /// [randomVoice] が false のときに使うボイス（VOICEVOX の styleId）。
  ///
  /// **新しいキーを足しても [currentSchemaVersion] は上げない。** 旧バージョンの
  /// アプリはこのキーを無視して既定値になるだけで壊れないが、バージョンを上げると
  /// 旧アプリ側が [isFutureVersion] と判定して**設定の保存を完全に止める**
  /// （そのぶん `ConfigTooNewBanner` が出て開始もできなくなる）。互換のつもりで
  /// 上げると、かえってダウングレード時の被害を自分で作ることになる。
  final int fixedStyleId;

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
    this.fixedStyleId = VoiceCatalog.defaultStyleId,
    this.ttsVolume = 100,
    this.sound = SoundConfig.initial,
  });

  Map<String, dynamic> toJson() => {
        'schemaVersion': schemaVersion,
        'revision': revision,
        'ttsEnabled': ttsEnabled,
        'randomVoice': randomVoice,
        'fixedStyleId': fixedStyleId,
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
  ///
  /// v2（平坦な `gifts[]`）は [SoundConfig.fromJson] が「メイン」1セットへ包む。
  ///
  /// **null が返る理由は2つあり、区別が要る。** 壊れたJSONは上書きで復旧させたいが、
  /// 未来バージョンは上書きしてはいけない。判定は [isFutureVersion]。
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

      // v1 は gifts も sets も持たないので、SoundConfig.fromJson が空の「メイン」
      // 1セットを返す。enabled / masterVolume は意味が変わっていないのでそのまま引き継ぐ。
      return AppConfig(
        schemaVersion: currentSchemaVersion,
        revision: _clampInt(json['revision'], min: 0, max: 1 << 30, fallback: 0),
        ttsEnabled: json['ttsEnabled'] != false,
        randomVoice: json['randomVoice'] != false,
        // 同梱していないボイスは選べない。キーが無い旧設定も、vvm を減らして
        // 実在しなくなった styleId も、ここで既定へ落とす。
        fixedStyleId: _knownStyleId(json['fixedStyleId']),
        ttsVolume: _clampInt(json['ttsVolume'], min: 0, max: 100, fallback: 100),
        sound: SoundConfig.fromJson(soundJson),
      );
    } catch (_) {
      return null;
    }
  }

  /// 保存済み設定が**このアプリより新しいスキーマ**で書かれているか。
  ///
  /// [tryDecode] が null を返す理由は「壊れている」と「未来のバージョン」の2つある。
  /// 前者は既定値で上書きして復旧させたいが、**後者は絶対に上書きしてはいけない。**
  ///
  /// 新しいアプリで作った設定を古い形式で潰すと、次のサービス起動で
  /// [SoundLibrary.pruneOrphans] が「参照されていない」と判断して実ファイルまで消す。
  /// バージョンを上げるだけではこれを防げない（背景 Isolate は掃除をスキップするが、
  /// UI 側が既定値を保存し直してしまう）ので、保存そのものを止める必要がある。
  static bool isFutureVersion(String? raw) {
    if (raw == null || raw.isEmpty) return false;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return false;
      final version = decoded['schemaVersion'];
      return version is int && version > currentSchemaVersion;
    } catch (_) {
      // 壊れたJSONは「未来のバージョン」ではない。上書きでの復旧を許す。
      return false;
    }
  }

  AppConfig copyWith({
    int? revision,
    bool? ttsEnabled,
    bool? randomVoice,
    int? fixedStyleId,
    int? ttsVolume,
    SoundConfig? sound,
  }) {
    return AppConfig(
      schemaVersion: schemaVersion,
      revision: revision ?? this.revision,
      ttsEnabled: ttsEnabled ?? this.ttsEnabled,
      randomVoice: randomVoice ?? this.randomVoice,
      fixedStyleId: fixedStyleId ?? this.fixedStyleId,
      ttsVolume: ttsVolume ?? this.ttsVolume,
      sound: sound ?? this.sound,
    );
  }

  /// 編集を1つ進めた新しい設定を作る。保存前に必ず通す。
  AppConfig bumped({
    bool? ttsEnabled,
    bool? randomVoice,
    int? fixedStyleId,
    int? ttsVolume,
    SoundConfig? sound,
  }) {
    return copyWith(
      revision: revision + 1,
      ttsEnabled: ttsEnabled,
      randomVoice: randomVoice,
      fixedStyleId: fixedStyleId,
      ttsVolume: ttsVolume,
      sound: sound,
    );
  }
}

/// 同梱している vvm に無い styleId は既定のボイスへ落とす。
int _knownStyleId(Object? value) {
  final id = value is int ? value : null;
  if (id == null || !VoiceCatalog.isKnown(id)) return VoiceCatalog.defaultStyleId;
  return id;
}
