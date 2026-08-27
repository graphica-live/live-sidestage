import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/gift_name_ja.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('normalizeKey', () {
    // 正規化は JS（TikEffect）と Dart で別々に実装されている。ずれると同じギフトの
    // 表示が端末とデスクトップで食い違うので、ケースは共有資産から読む。
    // live-sidestage-desktop 側のテストも同じファイルを読んでいる。
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

  group('日本語名を貯める前', () {
    setUp(GiftNameJa.resetForTest);

    test('英語名のまま返る（例外にしない）', () {
      expect(GiftNameJa.display('Rose'), 'Rose');
      expect(GiftNameJa.display('Rose', fallback: 'Rose'), 'Rose');
    });
  });

  group('日本語名を貯めたあと', () {
    setUp(() {
      GiftNameJa.resetForTest();
      GiftNameJa.seedForTest({
        'rose': 'バラ',
        "adam's dream": 'アダムの夢',
        'tiktok universe+': 'TikTok Universe+',
        'gg': 'GG',
      });
    });

    test('貯まっている', () {
      expect(GiftNameJa.isLoaded, isTrue);
      expect(GiftNameJa.length, 4);
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
      // サーバーは labelJa が英語と同じでも null にせず返す。ここが空だと
      // giftLabel を持たない古い設定で小文字の一致キーが露出する。
      expect(GiftNameJa.display('TikTok Universe+'), 'TikTok Universe+');
      expect(GiftNameJa.display('gg'), 'GG');
    });

    test('fallback が空の古い設定でも表記が劣化しない', () {
      // giftLabel を持たない時期に保存された設定は、一致キー（小文字）しか持たない。
      expect(GiftNameJa.display('tiktok universe+', fallback: ''), 'TikTok Universe+');
      expect(GiftNameJa.display('rose', fallback: ''), 'バラ');
    });
  });

  group('updateFromServer', () {
    setUp(GiftNameJa.resetForTest);

    test('サーバーの name を正規化してキーにする', () async {
      // サーバーの `name` は trim + 小文字化しかされていないので、カーリーアポストロフィが
      // そのまま来る。保存時に正規化しないと display 側（アポストロフィ統一あり）で
      // 永久にミスヒットする。
      await GiftNameJa.updateFromServer({'adam’s dream': 'アダムの夢'});
      expect(GiftNameJa.display("Adam's Dream"), 'アダムの夢');
      expect(GiftNameJa.display('Adam’s Dream'), 'アダムの夢');
    });

    test('空のマップでは既存を潰さない', () async {
      GiftNameJa.seedForTest({'rose': 'バラ'});
      await GiftNameJa.updateFromServer({});
      expect(GiftNameJa.display('Rose'), 'バラ');
    });

    test('日本語名が1件も無ければ既存を潰さない', () async {
      // サーバー側が日本語の取得に失敗している間（labelJa が全 null）に呼ばれるケース。
      // ここで空に置き換えると、復旧するまで全画面が英語へ戻る。
      GiftNameJa.seedForTest({'rose': 'バラ'});
      await GiftNameJa.updateFromServer({'rose': '', 'perfume': ''});
      expect(GiftNameJa.display('Rose'), 'バラ');
    });

    test('取れたぶんで丸ごと置き換える', () async {
      GiftNameJa.seedForTest({'rose': 'バラ', 'perfume': '香水'});
      await GiftNameJa.updateFromServer({'rose': 'ローズ'});
      expect(GiftNameJa.display('Rose'), 'ローズ');
      // カタログから消えたギフトは残さない（サーバーが返す集合が正）。
      expect(GiftNameJa.display('Perfume', fallback: 'Perfume'), 'Perfume');
    });
  });
}
