import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';
import 'package:live_sidestage_mobile/core/gift_name_ja.dart';
import 'package:live_sidestage_mobile/screens/gift_sound_edit_screen.dart';

/// ギフトピッカーの検索判定。日本語で表示している以上、日本語で引けないと探せない。
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUpAll(() async {
    GiftNameJa.resetForTest();
    await GiftNameJa.ensureLoaded();
  });

  const rose = GiftCandidate(name: 'rose', label: 'Rose', diamondCount: 1);
  const universe = GiftCandidate(name: 'tiktok universe+', label: 'TikTok Universe+', diamondCount: 44999);

  test('空の検索文字列は全件一致', () {
    expect(matchesGiftQuery(rose, ''), isTrue);
    expect(matchesGiftQuery(rose, '   '), isTrue);
  });

  test('日本語の表示名で引ける', () {
    expect(matchesGiftQuery(rose, 'バラ'), isTrue);
    expect(matchesGiftQuery(rose, 'ば'), isFalse);
  });

  test('英語名（一致キー・元表記）でも従来どおり引ける', () {
    expect(matchesGiftQuery(rose, 'rose'), isTrue);
    expect(matchesGiftQuery(rose, 'Rose'), isTrue);
    expect(matchesGiftQuery(rose, 'ROS'), isTrue);
  });

  test('前後の空白は無視する', () {
    expect(matchesGiftQuery(rose, '  バラ  '), isTrue);
  });

  test('辞書に日本語訳が無くても英語名で引ける', () {
    expect(matchesGiftQuery(universe, 'universe'), isTrue);
    expect(matchesGiftQuery(universe, 'ユニバース'), isFalse);
  });

  test('無関係な語では一致しない', () {
    expect(matchesGiftQuery(rose, 'ライオン'), isFalse);
    expect(matchesGiftQuery(rose, 'lion'), isFalse);
  });
}
