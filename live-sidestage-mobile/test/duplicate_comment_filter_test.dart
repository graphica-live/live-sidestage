import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/duplicate_comment_filter.dart';
import 'package:live_sidestage_mobile/models/comment.dart';

void main() {
  group('DuplicateCommentFilter', () {
    late DuplicateCommentFilter filter;
    final now = DateTime(2024, 1, 1, 12, 0, 0);
    const streamerId = 'streamer123';

    setUp(() {
      filter = DuplicateCommentFilter();
    });

    // Comment.speechText は comment から計算されるため、
    // テスト用に単純なコメントを使う（絵文字なし）
    Comment buildSimpleComment(String streamerId, String text) {
      return Comment(
        streamerId: streamerId,
        tiktokUid: 'uid123',
        tiktokHandle: '@user',
        nickname: 'User',
        profilePictureUrl: null,
        comment: text, // speechText = comment（絵文字なし、短いコメント）
        receivedAt: now,
      );
    }

    test('1回目の投稿は常にfalse', () {
      final comment = buildSimpleComment(streamerId, 'hello');
      expect(filter.shouldSuppress(comment, now: now), false);
    });

    test('同一内容が10分以内に2回目 → 2回目自体はfalse、直後の3回目はtrue', () {
      final comment = buildSimpleComment(streamerId, 'hello');

      // 1回目
      expect(filter.shouldSuppress(comment, now: now), false);

      // 2回目（5分後）
      final now2 = now.add(const Duration(minutes: 5));
      expect(filter.shouldSuppress(comment, now: now2), false);

      // 3回目（同時刻でもよい）
      expect(filter.shouldSuppress(comment, now: now2), true);
    });

    test('2回目から10分未満はtrue、10分以上経過するとfalse（境界はちょうどで解除）', () {
      final comment = buildSimpleComment(streamerId, 'hello');

      // 1回目
      expect(filter.shouldSuppress(comment, now: now), false);

      // 2回目（5分後）
      final now2 = now.add(const Duration(minutes: 5));
      expect(filter.shouldSuppress(comment, now: now2), false);

      // 3回目（9分後、抑制中。2回目(5分)からまだ4分なので抑制継続）
      final now3 = now.add(const Duration(minutes: 9));
      expect(filter.shouldSuppress(comment, now: now3), true);

      // 4回目（2回目(5分)から10分未満＝14分59秒後。抑制継続）
      final now4 = now.add(const Duration(minutes: 14, seconds: 59));
      expect(filter.shouldSuppress(comment, now: now4), true);

      // 5回目（2回目から10分ちょうど＝15分後。実装は同時刻を期限切れ扱いにするため解除）
      final now5 = now.add(const Duration(minutes: 15));
      expect(filter.shouldSuppress(comment, now: now5), false);
    });

    test('抑制解除後にもう一度同じ内容が単発で来ても再抑制されない', () {
      final comment = buildSimpleComment(streamerId, 'hello');

      // 1回目
      expect(filter.shouldSuppress(comment, now: now), false);

      // 2回目（5分後）
      final now2 = now.add(const Duration(minutes: 5));
      expect(filter.shouldSuppress(comment, now: now2), false);

      // 抑制期間を経過した後の投稿（2回目(5分)から10分超過＝15分1秒後）。
      // この呼び出し自体が新サイクルの「1回目」として記録される。
      final now3 = now.add(const Duration(minutes: 15, seconds: 1));
      expect(filter.shouldSuppress(comment, now: now3), false);

      // すぐ2回目投稿（now3から5分後、detectionWindow内）
      final now4 = now3.add(const Duration(minutes: 5));
      expect(filter.shouldSuppress(comment, now: now4), false);

      // 3回目投稿（抑制中）
      final now5 = now4.add(const Duration(seconds: 1));
      expect(filter.shouldSuppress(comment, now: now5), true);
    });

    test('内容が1文字でも違えば別キー扱いになり抑制されない', () {
      final comment1 = buildSimpleComment(streamerId, 'hello');
      final comment2 = buildSimpleComment(streamerId, 'helloa'); // 最後に'a'追加

      // comment1: 1回目
      expect(filter.shouldSuppress(comment1, now: now), false);

      // comment2: 1回目（別キー）
      expect(filter.shouldSuppress(comment2, now: now), false);

      // comment1: 2回目（5分後、抑制開始）
      final now2 = now.add(const Duration(minutes: 5));
      expect(filter.shouldSuppress(comment1, now: now2), false);

      // comment2: 2回目（5分後、別キーなので抑制開始）
      expect(filter.shouldSuppress(comment2, now: now2), false);

      // comment1: 3回目（抑制中）
      expect(filter.shouldSuppress(comment1, now: now2), true);

      // comment2: 3回目（別キーなので抑制中）
      expect(filter.shouldSuppress(comment2, now: now2), true);
    });

    test('streamerIdが異なれば同一テキストでも独立に扱われる', () {
      final comment1 = buildSimpleComment('streamer1', 'hello');
      final comment2 = buildSimpleComment('streamer2', 'hello');

      // streamer1: 1回目
      expect(filter.shouldSuppress(comment1, now: now), false);

      // streamer2: 1回目（別配信者）
      expect(filter.shouldSuppress(comment2, now: now), false);

      // streamer1: 2回目（5分後）
      final now2 = now.add(const Duration(minutes: 5));
      expect(filter.shouldSuppress(comment1, now: now2), false);

      // streamer2: 2回目（5分後）
      expect(filter.shouldSuppress(comment2, now: now2), false);

      // streamer1: 3回目（抑制中）
      expect(filter.shouldSuppress(comment1, now: now2), true);

      // streamer2: 3回目（抑制中、独立）
      expect(filter.shouldSuppress(comment2, now: now2), true);
    });

    test('10分より前の初回投稿は「直近10分以内」に該当せず2回目扱いにならない', () {
      final comment = buildSimpleComment(streamerId, 'hello');

      // 1回目（t=0）
      expect(filter.shouldSuppress(comment, now: now), false);

      // 2回目（t=15分後、detectionWindow=10分なので外）
      final now2 = now.add(const Duration(minutes: 15));
      expect(filter.shouldSuppress(comment, now: now2), false); // 新規1回目扱い

      // 3回目（t=20分後、2回目からまだ5分）
      final now3 = now.add(const Duration(minutes: 20));
      expect(filter.shouldSuppress(comment, now: now3), false); // 新規2回目扱い

      // 4回目（t=23分後、3回目から3分、抑制中）
      final now4 = now.add(const Duration(minutes: 23));
      expect(filter.shouldSuppress(comment, now: now4), true); // この時点での新規サイクルで抑制
    });

    test('reset() で内部状態がクリアされる', () {
      final comment = buildSimpleComment(streamerId, 'hello');

      // 1回目
      expect(filter.shouldSuppress(comment, now: now), false);

      // 2回目
      final now2 = now.add(const Duration(minutes: 5));
      expect(filter.shouldSuppress(comment, now: now2), false);

      // リセット
      filter.reset();

      // 3回目（リセット後は1回目扱い）
      expect(filter.shouldSuppress(comment, now: now2), false);
    });

    test('カスタムの detectionWindow と suppressionDuration が動作する', () {
      filter = DuplicateCommentFilter(
        detectionWindow: const Duration(minutes: 5),
        suppressionDuration: const Duration(minutes: 3),
      );
      final comment = buildSimpleComment(streamerId, 'hello');

      // 1回目
      expect(filter.shouldSuppress(comment, now: now), false);

      // 2回目（3分後、detectionWindow=5分以内）
      final now2 = now.add(const Duration(minutes: 3));
      expect(filter.shouldSuppress(comment, now: now2), false);

      // 3回目（直後、抑制中）
      expect(filter.shouldSuppress(comment, now: now2), true);

      // 4回目（2回目(3分)から抑制期間3分を超過＝6分1秒後。解除）
      final now3 = now.add(const Duration(minutes: 6, seconds: 1));
      expect(filter.shouldSuppress(comment, now: now3), false);
    });

    test('複数の異なるコメントが独立に追跡される', () {
      final comment1 = buildSimpleComment(streamerId, 'hello');
      final comment2 = buildSimpleComment(streamerId, 'world');
      final comment3 = buildSimpleComment(streamerId, 'test');

      // 各コメント1回目
      expect(filter.shouldSuppress(comment1, now: now), false);
      expect(filter.shouldSuppress(comment2, now: now), false);
      expect(filter.shouldSuppress(comment3, now: now), false);

      // 各コメント2回目（5分後）
      final now2 = now.add(const Duration(minutes: 5));
      expect(filter.shouldSuppress(comment1, now: now2), false);
      expect(filter.shouldSuppress(comment2, now: now2), false);
      expect(filter.shouldSuppress(comment3, now: now2), false);

      // 各コメント3回目（5分後、全て抑制中）
      expect(filter.shouldSuppress(comment1, now: now2), true);
      expect(filter.shouldSuppress(comment2, now: now2), true);
      expect(filter.shouldSuppress(comment3, now: now2), true);
    });

    test('古いエントリは cleanup で削除される（メモリリーク対策）', () {
      final comment1 = buildSimpleComment(streamerId, 'old');
      final comment2 = buildSimpleComment(streamerId, 'new');

      // comment1: 1回目（t=0）
      expect(filter.shouldSuppress(comment1, now: now), false);

      // comment2: 1回目（t=15分後）
      final now2 = now.add(const Duration(minutes: 15));
      expect(filter.shouldSuppress(comment2, now: now2), false);

      // 古いcomment1（t=0）はdetectionWindow(10分)を超えたので cleanup で削除される
      // comment2は新規なので lastSeenAt には登録されているが、
      // comment1 の古いエントリは削除される
      // （実装内部で削除されているため、外側からは検証しにくいため、
      // 再度 comment1 を投稿すると新規1回目扱いになることで確認）

      // comment1: 2回目扱いのはず（1回目のエントリが削除されたため）
      final now3 = now.add(const Duration(minutes: 16));
      expect(filter.shouldSuppress(comment1, now: now3), false); // 新規1回目
    });
  });
}
