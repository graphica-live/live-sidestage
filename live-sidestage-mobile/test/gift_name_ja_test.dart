import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/gift_name_ja.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('normalizeKey', () {
    // 正規化は JS（TikEffect / sync.mjs）と Dart で別々に実装されている。
    // ずれると同じギフトの表示が端末とデスクトップで食い違うので、ケースは
    // 共有資産から読む。live-sidestage-desktop/tests/unit/gift-name-ja.test.js も
    // 同じファイルを読んでいる。
    final file = File('../shared/gift-names/normalize-cases.json');
    final cases = (jsonDecode(file.readAsStringSync()) as Map)['cases'] as List;

    test('共有テストベクタが読めている', () {
      expect(cases.length, greaterThan(5));
    });

    for (final entry in cases) {
      final input = (entry as Map)['input'] as String;
      final expected = entry['expected'] as String;
      test('${jsonEncode(input)} -> ${jsonEncode(expected)}', () {
        expect(GiftNameJa.normalizeKey(input), expected);
      });
    }
  });

  group('辞書を読む前', () {
    setUp(GiftNameJa.resetForTest);

    test('英語名のまま返る（例外にしない）', () {
      expect(GiftNameJa.display('Rose'), 'Rose');
      expect(GiftNameJa.display('Rose', fallback: 'Rose'), 'Rose');
    });
  });

  group('辞書を読んだあと', () {
    setUpAll(() async {
      GiftNameJa.resetForTest();
      await GiftNameJa.ensureLoaded();
    });

    test('アセットが読めている', () {
      expect(GiftNameJa.isLoaded, isTrue);
      expect(GiftNameJa.length, greaterThan(100));
    });

    test('収録済みのギフトは日本語で返る', () {
      expect(GiftNameJa.display('Rose'), 'バラ');
      expect(GiftNameJa.display('rose'), 'バラ');
    });

    test('アポストロフィの表記ゆれを吸収する', () {
      expect(GiftNameJa.display('Adam’s Dream'), 'アダムの夢');
      expect(GiftNameJa.display("Adam's Dream"), 'アダムの夢');
    });

    test('未収録なら fallback、無ければ渡された名前', () {
      expect(GiftNameJa.display('Totally Unknown Gift', fallback: 'Totally Unknown Gift'),
          'Totally Unknown Gift');
      expect(GiftNameJa.display('Totally Unknown Gift'), 'Totally Unknown Gift');
    });

    test('日本語環境でも英語のままのギフトは正式表記で返る', () {
      expect(GiftNameJa.display('TikTok Universe+'), 'TikTok Universe+');
      expect(GiftNameJa.display('gg'), 'GG');
    });

    test('fallback が空の古い設定でも表記が劣化しない', () {
      // giftLabel を持たない時期に保存された設定は、一致キー（小文字）しか持たない。
      // 辞書に正式表記が入っているので、そこから復元できる。
      expect(GiftNameJa.display('tiktok universe+', fallback: ''), 'TikTok Universe+');
      expect(GiftNameJa.display('rose', fallback: ''), 'バラ');
    });
  });
}
