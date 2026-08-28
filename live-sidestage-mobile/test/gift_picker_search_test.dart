import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/api_client.dart';
import 'package:live_sidestage_mobile/core/gift_name_ja.dart';
import 'package:live_sidestage_mobile/screens/gift_sound_edit_screen.dart';

/// ギフトピッカーの検索判定。日本語で表示している以上、日本語で引けないと探せない。
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    // 日本語名の供給元は端末に貯めたサーバー由来のキャッシュ。テストでは直接差し込む。
    GiftNameJa.resetForTest();
    GiftNameJa.seedForTest({'rose': 'バラ'});
  });

  const rose = GiftCandidate.single(name: 'rose', label: 'Rose', diamondCount: 1);
  const universe = GiftCandidate.single(name: 'tiktok universe+', label: 'TikTok Universe+', diamondCount: 44999);
  // キャッシュがまだ空でも、サーバーが返した labelJa で日本語検索できる。
  const perfume = GiftCandidate.single(
    name: 'perfume',
    label: 'Perfume',
    diamondCount: 20,
    labelJa: '香水',
  );

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

  test('日本語名が無くても英語名で引ける', () {
    expect(matchesGiftQuery(universe, 'universe'), isTrue);
    expect(matchesGiftQuery(universe, 'ユニバース'), isFalse);
  });

  test('キャッシュに無くてもサーバーが返した labelJa で引ける', () {
    expect(matchesGiftQuery(perfume, '香水'), isTrue);
    expect(matchesGiftQuery(perfume, 'perfume'), isTrue);
  });

  test('無関係な語では一致しない', () {
    expect(matchesGiftQuery(rose, 'ライオン'), isFalse);
    expect(matchesGiftQuery(rose, 'lion'), isFalse);
  });

  group('looksJapanese', () {
    test('かな・カタカナ・漢字を検出する', () {
      expect(looksJapanese('バラ'), isTrue);
      expect(looksJapanese('わやハグ'), isTrue);
      expect(looksJapanese('香水'), isTrue);
    });

    test('英数字だけなら false', () {
      expect(looksJapanese('Rose'), isFalse);
      expect(looksJapanese('TikTok Universe+'), isFalse);
      expect(looksJapanese(''), isFalse);
    });
  });

  group('isBlockedGift', () {
    test('登録済みのブロックワードを含むギフトは弾く', () {
      const gift = GiftCandidate.single(
        name: 'song gift',
        label: 'Song Gift',
        diamondCount: 199,
        labelJa: 'ちんこソング',
      );
      expect(isBlockedGift(gift), isTrue);
    });

    test('ひらがな・カタカナの違いを無視して一致する', () {
      // 'アナル' はカタカナで登録。ひらがな表記のギフト名でも弾けること。
      const hiraganaMatch = GiftCandidate.single(name: 'x', label: 'X', diamondCount: 1, labelJa: 'あなるパーティ');
      expect(isBlockedGift(hiraganaMatch), isTrue);

      // 'ちんこ' はひらがなで登録。カタカナ表記のギフト名でも弾けること。
      const katakanaMatch = GiftCandidate.single(name: 'y', label: 'Y', diamondCount: 1, labelJa: 'チンコフィーバー');
      expect(isBlockedGift(katakanaMatch), isTrue);
    });

    test('無関係なギフトは通す', () {
      expect(isBlockedGift(rose), isFalse);
      expect(isBlockedGift(perfume), isFalse);
    });

    test('ブロックリストを空にすると何も弾かない', () {
      const gift = GiftCandidate.single(name: 'x', label: 'X', diamondCount: 1, labelJa: 'ちんこ');
      expect(isBlockedGift(gift, blockedKeywords: const {}), isFalse);
    });

    test('blockedKeywords を差し替えれば任意の語で弾ける', () {
      const gift = GiftCandidate.single(name: 'lion', label: 'Lion', diamondCount: 1);
      expect(isBlockedGift(gift, blockedKeywords: const {'lion'}), isTrue);
      expect(isBlockedGift(rose, blockedKeywords: const {'lion'}), isFalse);
    });
  });
}
