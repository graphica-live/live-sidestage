import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/app_config.dart';

void main() {
  group('AppConfig.ttsVolume', () {
    test('既定値は100', () {
      expect(const AppConfig().ttsVolume, 100);
    });

    test('encode/decodeで往復する', () {
      final decoded = AppConfig.decode(const AppConfig(ttsVolume: 45).encode());
      expect(decoded.ttsVolume, 45);
    });

    test('ttsVolumeを持たない旧設定は100になる', () {
      final raw = jsonEncode({'schemaVersion': 1, 'revision': 3, 'ttsEnabled': true});
      expect(AppConfig.decode(raw).ttsVolume, 100);
    });

    test('範囲外は0-100へ丸め、非数値は100へ落とす', () {
      int volumeOf(Object? value) =>
          AppConfig.decode(jsonEncode({'ttsVolume': value})).ttsVolume;

      expect(volumeOf(-10), 0);
      expect(volumeOf(150), 100);
      expect(volumeOf('80'), 100);
    });

    test('bumpedはrevisionを進めて他の設定を保つ', () {
      const base = AppConfig(revision: 7, randomVoice: false, ttsVolume: 100);
      final next = base.bumped(ttsVolume: 30);

      expect(next.revision, 8);
      expect(next.ttsVolume, 30);
      expect(next.randomVoice, false);
      expect(next.ttsEnabled, true);
    });
  });

  group('tryDecode', () {
    test('壊れたJSONはnull', () {
      expect(AppConfig.tryDecode('{'), isNull);
      expect(AppConfig.tryDecode('[]'), isNull);
    });

    test('空・nullはnull（未設定であって読めなかったわけではない）', () {
      expect(AppConfig.tryDecode(null), isNull);
      expect(AppConfig.tryDecode(''), isNull);
    });

    test('未対応の未来バージョンはnull', () {
      final raw = jsonEncode({'schemaVersion': AppConfig.currentSchemaVersion + 1});
      expect(AppConfig.tryDecode(raw), isNull);
    });

    test('decodeは読めないときに既定値へ落とす', () {
      expect(AppConfig.decode('{').ttsVolume, 100);
      expect(AppConfig.decode('{').sound.gifts, isEmpty);
    });
  });

  group('v1からの移行', () {
    // v1: カテゴリ + トリガー + 音源ライブラリの3層。v2に対応物が無いので破棄するが、
    // TTS設定と効果音の全体スイッチ・全体音量は意味が変わっていないので引き継ぐ。
    final v1 = jsonEncode({
      'schemaVersion': 1,
      'revision': 12,
      'ttsEnabled': false,
      'randomVoice': false,
      'ttsVolume': 60,
      'sound': {
        'enabled': false,
        'masterVolume': 40,
        'categories': [
          {'id': 'cat', 'name': 'test', 'enabled': true}
        ],
        'triggers': [
          {'id': 'trg', 'name': 'x', 'categoryId': 'cat', 'soundIds': ['snd'], 'eventType': 'gift'}
        ],
        'assets': [
          {'id': 'snd', 'name': 'Drumroll', 'fileName': 'snd.mp3', 'source': 'local'}
        ],
      },
    });

    test('TTS設定を引き継ぐ', () {
      final config = AppConfig.tryDecode(v1)!;
      expect(config.ttsEnabled, false);
      expect(config.randomVoice, false);
      expect(config.ttsVolume, 60);
    });

    test('効果音の全体スイッチと全体音量を引き継ぐ', () {
      final config = AppConfig.tryDecode(v1)!;
      expect(config.sound.enabled, false);
      expect(config.sound.masterVolume, 40);
    });

    test('トリガー・カテゴリ・音源ライブラリは破棄する', () {
      expect(AppConfig.tryDecode(v1)!.sound.gifts, isEmpty);
    });

    test('revisionは引き継ぐ（背景Isolateとの順序保証が壊れないように）', () {
      expect(AppConfig.tryDecode(v1)!.revision, 12);
    });

    test('スキーマ版はv2へ上がる', () {
      expect(AppConfig.tryDecode(v1)!.schemaVersion, 2);
    });
  });

  group('GiftSound', () {
    test('giftNameはtrim+小文字化して保持する', () {
      final parsed = GiftSound.tryParse({
        'id': 'g1',
        'fileName': 'a.mp3',
        'giftName': '  Rose  ',
      })!;
      expect(parsed.giftName, 'rose');
    });

    test('giftLabelは元の表記のまま', () {
      final parsed = GiftSound.tryParse({
        'id': 'g1',
        'fileName': 'a.mp3',
        'giftName': 'Rose',
        'giftLabel': 'Rose',
      })!;
      expect(parsed.giftLabel, 'Rose');
    });

    test('fileNameが無い行は捨てる（鳴らしようがない）', () {
      expect(GiftSound.tryParse({'id': 'g1', 'giftName': 'rose'}), isNull);
      expect(GiftSound.tryParse({'id': 'g1', 'fileName': ''}), isNull);
    });

    test('idが無い行は捨てる', () {
      expect(GiftSound.tryParse({'fileName': 'a.mp3'}), isNull);
    });

    test('displayGiftNameはlabel→name→すべてのギフトの順に落ちる', () {
      expect(
        const GiftSound(id: 'g', giftName: 'rose', giftLabel: 'Rose', fileName: 'a.mp3')
            .displayGiftName,
        'Rose',
      );
      expect(
        const GiftSound(id: 'g', giftName: 'rose', fileName: 'a.mp3').displayGiftName,
        'rose',
      );
      expect(
        const GiftSound(id: 'g', giftName: '', fileName: 'a.mp3').displayGiftName,
        'すべてのギフト',
      );
    });

    test('壊れた行だけ捨てて他は残す', () {
      final config = SoundConfig.fromJson({
        'gifts': [
          {'id': 'g1', 'fileName': 'a.mp3'},
          {'id': 'broken'},
          'not a map',
          {'id': 'g2', 'fileName': 'b.mp3'},
        ],
      });
      expect(config.gifts.map((g) => g.id), ['g1', 'g2']);
    });

    test('encode/decodeで往復する', () {
      const original = AppConfig(
        sound: SoundConfig(
          masterVolume: 70,
          gifts: [
            GiftSound(
              id: 'g1',
              giftName: 'rose',
              giftLabel: 'Rose',
              fileName: 'a.mp3',
              soundName: 'Drumroll',
              source: SoundSourceKind.soundEffectLab,
              sourceUrl: 'https://soundeffect-lab.info/sound/a.mp3',
              volume: 80,
              enabled: false,
            ),
          ],
        ),
      );
      final decoded = AppConfig.decode(original.encode());
      final gift = decoded.sound.gifts.single;

      expect(decoded.sound.masterVolume, 70);
      expect(gift.id, 'g1');
      expect(gift.giftName, 'rose');
      expect(gift.giftLabel, 'Rose');
      expect(gift.fileName, 'a.mp3');
      expect(gift.soundName, 'Drumroll');
      expect(gift.source, SoundSourceKind.soundEffectLab);
      expect(gift.sourceUrl, 'https://soundeffect-lab.info/sound/a.mp3');
      expect(gift.volume, 80);
      expect(gift.enabled, false);
    });
  });
}
