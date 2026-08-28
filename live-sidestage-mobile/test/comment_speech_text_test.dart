import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/comment.dart';

Comment c(String text) => Comment(
      streamerId: 's1',
      uniqueId: 'u1',
      nickname: 'なまえ',
      profilePictureUrl: null,
      comment: text,
      receivedAt: DateTime(2026, 8, 28),
    );

void main() {
  group('speechText — TikTokの絵文字トークン', () {
    test('角括弧の塊を落とす', () {
      // そのまま読むと「かっこ びしょう かっこ」になる。
      expect(c('おはよう[微笑]').speechText, 'おはよう');
    });

    test('複数あっても全部落とす', () {
      expect(c('[微笑]やった[拍手]ね[笑]').speechText, 'やった ね');
    });

    test('トークンだけなら空になる', () {
      expect(c('[微笑][拍手]').speechText, isEmpty);
    });

    test('閉じていない角括弧は落とさない(本文の一部かもしれない)', () {
      expect(c('配列は[0]から。あ[').speechText, '配列は から。あ[');
    });
  });

  group('speechText — 素の絵文字', () {
    test('絵文字を落とす', () {
      expect(c('やったー🎉').speechText, 'やったー');
    });

    test('絵文字だけなら空になる', () {
      // VOICEVOX は読み方を作れず code=11 で失敗する。手前で捨てる。
      expect(c('🎉🎉🎉').speechText, isEmpty);
    });

    test('肌色や合字つきの絵文字も落とす', () {
      expect(c('よろしく👍🏻👨‍👩‍👧').speechText, 'よろしく');
    });

    test('記号だけのコメントも空になる', () {
      expect(c('✨✨→→').speechText, isEmpty);
    });
  });

  group('speechText — 落としてはいけないもの', () {
    test('日本語はそのまま', () {
      expect(c('こんばんは、今日もお疲れさま').speechText, 'こんばんは、今日もお疲れさま');
    });

    test('英数字と一般的な記号はそのまま', () {
      expect(c('ABC 123 !? ()「」').speechText, 'ABC 123 !? ()「」');
    });

    test('絵文字を挟んだ日本語は前後が残る', () {
      expect(c('すごい🎉ですね').speechText, 'すごい ですね');
    });

    test('連続する空白は1つにまとめ、前後は削る', () {
      expect(c('  あ   い  ').speechText, 'あ い');
    });
  });

  group('displayText は変えない', () {
    test('画面には元の本文がそのまま出る', () {
      // 読み上げないだけで、消えたようには見せない。
      final comment = c('おはよう[微笑]🎉');
      expect(comment.displayText, 'おはよう[微笑]🎉');
      expect(comment.speechText, 'おはよう');
    });
  });
}
