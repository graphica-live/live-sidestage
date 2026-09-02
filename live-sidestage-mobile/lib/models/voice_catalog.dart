/// 同梱している VOICEVOX 音声モデル（`assets/voicevox_models/*.vvm`）が持つ
/// キャラクターとスタイルの一覧。
///
/// ## なぜ静的に持つのか
///
/// 実在のボイス一覧は背景 Isolate の `TtsEngine.voices`（VOICEVOX が返す metas）に
/// しかなく、しかも **読み上げが ON で初期化が終わるまで存在しない**。設定画面は
/// 停止中に開くのが普通なので、エンジン由来の一覧を待つ作りにすると「一度読み上げを
/// 開始しないとボイスを選べない」UI になる。だから選択肢はここに持つ。
///
/// ## vvm を足す・差し替えるときはこの表も直す
///
/// 中身は vvm（実体は zip）内の `metas.json` にある。直し忘れても壊れはしない
/// （`VoicePool` が実在しない styleId を先頭のボイスへ落とす）が、増えたキャラを
/// 選べないままになる。
library;

/// キャラクターが持つ1つのスタイル（話し方）。
class VoiceStyleOption {
  const VoiceStyleOption(this.styleId, this.styleName);

  /// VOICEVOX の styleId。合成時にそのまま渡す値で、キャラクターではなく
  /// **スタイル単位**で振られている（四国めたん ノーマル = 2、あまあま = 0）。
  final int styleId;

  final String styleName;
}

/// 1キャラクターと、そのスタイル一覧。
class VoiceCharacter {
  const VoiceCharacter(this.name, this.styles);

  final String name;
  final List<VoiceStyleOption> styles;
}

class VoiceCatalog {
  const VoiceCatalog._();

  /// 既定のボイス（四国めたん ノーマル）。
  ///
  /// 実行時の既定は `VoicePool` の「一覧の先頭」だったが、その並びは VOICEVOX が
  /// 返す metas の順に依存する。設定として保存する以上、順序ではなく値で決める。
  static const int defaultStyleId = 2;

  /// `0.vvm` / `4.vvm` の metas.json の並び（speaker と style の order 順）。
  static const List<VoiceCharacter> characters = [
    VoiceCharacter('四国めたん', [
      VoiceStyleOption(2, 'ノーマル'),
      VoiceStyleOption(0, 'あまあま'),
      VoiceStyleOption(6, 'ツンツン'),
      VoiceStyleOption(4, 'セクシー'),
    ]),
    VoiceCharacter('ずんだもん', [
      VoiceStyleOption(3, 'ノーマル'),
      VoiceStyleOption(1, 'あまあま'),
      VoiceStyleOption(7, 'ツンツン'),
      VoiceStyleOption(5, 'セクシー'),
    ]),
    VoiceCharacter('春日部つむぎ', [VoiceStyleOption(8, 'ノーマル')]),
    VoiceCharacter('雨晴はう', [VoiceStyleOption(10, 'ノーマル')]),
    VoiceCharacter('玄野武宏', [VoiceStyleOption(11, 'ノーマル')]),
    VoiceCharacter('剣崎雌雄', [VoiceStyleOption(21, 'ノーマル')]),
  ];

  /// FREEプランで選べるstyleId(ずんだもん ノーマル・四国めたん ノーマル)。
  static const List<int> freeStyleIds = [2, 3];

  static bool isFreeStyle(int styleId) => freeStyleIds.contains(styleId);

  static bool isKnown(int styleId) {
    for (final character in characters) {
      for (final style in character.styles) {
        if (style.styleId == styleId) return true;
      }
    }
    return false;
  }

  /// 「四国めたん ノーマル」。知らない styleId なら既定のボイス名を返す
  /// （保存時に既定へ落としているので通常は届かない）。
  static String labelFor(int styleId) {
    for (final character in characters) {
      for (final style in character.styles) {
        if (style.styleId == styleId) return '${character.name} ${style.styleName}';
      }
    }
    return styleId == defaultStyleId ? '四国めたん ノーマル' : labelFor(defaultStyleId);
  }
}
