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
}
