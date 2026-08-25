// 固定ボイスの解決。
//
// 設定(AppConfig.fixedStyleId)は同梱 vvm の静的な一覧(VoiceCatalog)を元に保存される。
// 実際にロードされたモデルとズレたとき、そのまま使うと合成のたびに createAudioQuery が
// 失敗して読み上げが丸ごと無音になるので、VoicePool 側でも落とす。
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/voice_pool.dart';

/// 四国めたん(ノーマル 2 / あまあま 0)とずんだもん(ノーマル 3)だけのモデル。
List<VoiceStyle> _styles() => VoiceStyle.listFromMetasJson(jsonEncode([
      {
        'name': '四国めたん',
        'styles': [
          {'name': 'ノーマル', 'id': 2},
          {'name': 'あまあま', 'id': 0},
        ],
      },
      {
        'name': 'ずんだもん',
        'styles': [
          {'name': 'ノーマル', 'id': 3},
        ],
      },
    ]));

void main() {
  group('fixedStyleId', () {
    test('既定はモデルの先頭', () {
      expect(VoicePool(_styles()).fixedStyleId, 2);
    });

    test('モデルにあるstyleIdはそのまま持つ', () {
      final pool = VoicePool(_styles())..fixedStyleId = 3;
      expect(pool.fixedStyleId, 3);
    });

    test('モデルに無いstyleIdは先頭へ落とす', () {
      final pool = VoicePool(_styles())..fixedStyleId = 21;
      expect(pool.fixedStyleId, 2);
    });

    test('モデルが空でも落ちない', () {
      final pool = VoicePool([])..fixedStyleId = 7;
      expect(pool.fixedStyleId, 0);
    });
  });

  group('effectiveStyleId', () {
    test('ランダムOFFなら誰のコメントでも固定ボイス', () {
      final pool = VoicePool(_styles())
        ..randomEnabled = false
        ..fixedStyleId = 3;

      expect(pool.effectiveStyleId('user_a'), 3);
      expect(pool.effectiveStyleId('user_b'), 3);
    });

    test('ランダムONなら同じ投稿者には同じボイスを使い続ける', () {
      final pool = VoicePool(_styles())..randomEnabled = true;

      final first = pool.effectiveStyleId('user_a');
      expect(pool.effectiveStyleId('user_a'), first);
      expect(_styles().map((s) => s.styleId), contains(first));
    });

    test('モデルに無い固定ボイスを渡されてもランダムOFFで鳴らせる', () {
      final pool = VoicePool(_styles())
        ..randomEnabled = false
        ..fixedStyleId = 999;

      expect(_styles().map((s) => s.styleId), contains(pool.effectiveStyleId('user_a')));
    });
  });
}
