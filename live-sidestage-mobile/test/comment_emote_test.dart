import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/comment.dart';

Map<String, dynamic> base({Object? emotes, String comment = 'こんにちは'}) => {
      'streamerId': 's1',
      'uniqueId': 'u1',
      'nickname': 'なまえ',
      'comment': comment,
      'receivedAt': '2026-08-28T10:00:00.000Z',
      if (emotes != null) 'emotes': emotes,
    };

void main() {
  group('Comment.tryParse のエモート', () {
    test('emotes が無い旧サーバーのペイロードでも壊れない', () {
      final c = Comment.tryParse(base())!;
      expect(c.emotes, isEmpty);
      expect(c.displayText, 'こんにちは');
    });

    test('emotes を読める', () {
      final c = Comment.tryParse(base(emotes: [
        {'emoteId': 'a', 'imageUrl': 'https://cdn/a.png', 'placeInComment': 2},
      ]))!;
      expect(c.emotes.single.emoteId, 'a');
      expect(c.emotes.single.imageUrl, 'https://cdn/a.png');
      expect(c.emotes.single.placeInComment, 2);
    });

    test('壊れた要素だけ捨て、コメント自体は捨てない', () {
      final c = Comment.tryParse(base(emotes: [
        'こわれている',
        {'imageUrl': 'https://cdn/a.png'},
        {'emoteId': 'b'},
      ]))!;
      expect(c.emotes.single.emoteId, 'b');
      expect(c.comment, 'こんにちは');
    });

    test('emotes が配列でなくてもコメントは生きる', () {
      final c = Comment.tryParse(base(emotes: 'nope'))!;
      expect(c.emotes, isEmpty);
      expect(c.comment, 'こんにちは');
    });
  });

  group('displayText', () {
    test('エモートだけのコメントでも空にならない', () {
      final c = Comment.tryParse(base(comment: '', emotes: [
        {'emoteId': 'a'},
      ]))!;
      expect(c.displayText, '[エモート]');
    });

    test('複数なら件数を出す', () {
      final c = Comment.tryParse(base(comment: '', emotes: [
        {'emoteId': 'a'},
        {'emoteId': 'b'},
      ]))!;
      expect(c.displayText, '[エモート×2]');
    });

    test('本文があれば後ろに付ける', () {
      final c = Comment.tryParse(base(emotes: [
        {'emoteId': 'a'},
      ]))!;
      expect(c.displayText, 'こんにちは [エモート]');
    });

    test('読み上げに使う comment 自体には印を混ぜない', () {
      final c = Comment.tryParse(base(emotes: [
        {'emoteId': 'a'},
      ]))!;
      expect(c.comment, 'こんにちは');
    });
  });

  group('emotesToMaps', () {
    test('tryParse と対称に往復できる(バックグラウンドisolate中継)', () {
      final original = Comment.tryParse(base(emotes: [
        {'emoteId': 'a', 'imageUrl': 'https://cdn/a.png', 'placeInComment': 1},
      ]))!;

      final relayed = Comment.tryParse(base(emotes: original.emotesToMaps()))!;

      expect(relayed.emotes.single.emoteId, 'a');
      expect(relayed.emotes.single.imageUrl, 'https://cdn/a.png');
      expect(relayed.emotes.single.placeInComment, 1);
    });
  });
}
