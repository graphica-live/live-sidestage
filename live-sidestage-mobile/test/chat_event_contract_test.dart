import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/comment.dart';
import 'package:live_sidestage_mobile/models/follow_event.dart';
import 'package:live_sidestage_mobile/models/gift_event.dart';

/// `chat:*` の受信契約テスト。
///
/// サーバー側(live-sidestage-analytics/src/lib/chat-feed.contract.test.ts)と
/// **同じ fixture** を読む。サーバーがフィールドを増減させたのに Dart 側を
/// 直し忘れると、どちらかが落ちる。
///
/// モノレポなので相対パスで参照している。見つからない場合は skip せず失敗させる
/// （黙って通ると契約ズレの検出という目的を果たさない）。
const String fixturePath =
    '../live-sidestage-analytics/src/lib/__fixtures__/chat-events.json';

Map<String, dynamic> _load(String key) {
  final file = File(fixturePath);
  if (!file.existsSync()) {
    fail('契約fixtureが見つかりません: ${file.absolute.path}');
  }
  final root = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
  return Map<String, dynamic>.from(root[key] as Map);
}

void main() {
  test('chat:gift(コンボ)を解析できる', () {
    final json = _load('gift');
    final event = GiftEvent.tryParse(json);

    expect(event, isNotNull);
    expect(event!.streamerId, 'streamer-1');
    expect(event.uniqueId, 'viewer_a');
    expect(event.nickname, 'Viewer A');
    expect(event.profilePictureUrl, 'https://example.invalid/a.png');
    expect(event.giftName, 'rose');
    expect(event.giftId, '5655');
    expect(event.diamondCount, 1);
    expect(event.repeatCount, 5);
    expect(event.delta, 3);
    // totalCoins は累計側(diamondCount × repeatCount)。増分ではない。
    expect(event.totalCoins, 5);
    expect(event.baselineReset, isFalse);
    expect(event.isCombo, isTrue);
    expect(event.repeatEnd, isFalse);
    expect(event.comboId, 'group-1');
    expect(event.occurredAt.toUtc().toIso8601String(), '2026-08-21T12:34:56.000Z');
  });

  test('chat:gift(非コンボ)は comboId が null で baselineReset を拾える', () {
    final json = _load('giftWithoutCombo');
    final event = GiftEvent.tryParse(json);

    expect(event, isNotNull);
    expect(event!.comboId, isNull);
    expect(event.profilePictureUrl, isNull);
    expect(event.giftId, isNull);
    expect(event.baselineReset, isTrue);
    expect(event.isCombo, isFalse);
    expect(event.repeatEnd, isTrue);
    expect(event.totalCoins, 1000);
    expect(event.delta, 1);
  });

  test('chat:follow を解析できる', () {
    final json = _load('follow');
    final event = FollowEvent.tryParse(json);

    expect(event, isNotNull);
    expect(event!.streamerId, 'streamer-1');
    expect(event.uniqueId, 'viewer_c');
    expect(event.nickname, 'Viewer C');
    expect(event.profilePictureUrl, 'https://example.invalid/c.png');
    expect(event.occurredAt.toUtc().toIso8601String(), '2026-08-21T12:36:00.000Z');
  });

  test('chat:comment を解析できる(schemaVersion を持たない既存形式)', () {
    final json = _load('comment');
    expect(json.containsKey('schemaVersion'), isFalse);

    final comment = Comment.tryParse(json);
    expect(comment, isNotNull);
    expect(comment!.uniqueId, 'viewer_d');
    expect(comment.comment, 'こんばんは');
    expect(comment.profilePictureUrl, isNull);
    expect(comment.receivedAt.toUtc().toIso8601String(), '2026-08-21T12:37:00.000Z');
  });

  test('必須フィールドが欠けたペイロードは null になる(購読を殺さない)', () {
    expect(GiftEvent.tryParse({'uniqueId': 'x'}), isNull);
    expect(FollowEvent.tryParse({'streamerId': 'x'}), isNull);
    expect(Comment.tryParse({'streamerId': 123, 'uniqueId': 'x'}), isNull);
  });
}
