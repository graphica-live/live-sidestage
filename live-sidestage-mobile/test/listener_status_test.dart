// listener 状態は push(socket) と poll(HTTP) の2経路から届く。
// **どちらが新しいかを (roomId, revision) だけで決める** — 壁時計を混ぜない。
// ここが崩れると「Workerが落ちたのに配信中のまま」が永久に残る。
import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/listener_status.dart';

ListenerStatus status({
  String roomId = 'room_a',
  String revision = '100',
  bool live = false,
  bool stale = false,
  String activity = 'offline',
  String health = 'ok',
  String? message,
}) {
  return ListenerStatus(
    roomId: roomId,
    revision: revision,
    live: live,
    stale: stale,
    activity: activity,
    health: health,
    message: message,
  );
}

void main() {
  group('isSupersededBy', () {
    test('同じroomならrevisionが大きい方が新しい', () {
      final older = status(revision: '100');
      expect(older.isSupersededBy(status(revision: '101')), isTrue);
      expect(older.isSupersededBy(status(revision: '99')), isFalse);
      expect(older.isSupersededBy(status(revision: '100')), isFalse);
    });

    // TikTok ID を変えた直後の最大60秒、旧roomのWorkerが同じsocketルームへ送れてしまう。
    // revision の大小では判別できないので、room が違えば無条件に採用する。
    test('roomが変わったらrevisionに関係なく採用する', () {
      final old = status(roomId: 'room_a', revision: '9999');
      expect(old.isSupersededBy(status(roomId: 'room_b', revision: '1')), isTrue);
    });

    // Workerが落ちるとDBのrevisionは進まない。同じrevisionでstaleになった観測を
    // 「古い」として捨てると、live=true が永久に残る。
    test('DBのrevisionが進まなくても、同じ値の再取得は上書きできる必要がある', () {
      final live = status(revision: '100', live: true, activity: 'live');
      final stale = status(revision: '100', live: false, stale: true, activity: 'live');
      // isSupersededBy は false を返す（順序としては新しくない）。
      expect(live.isSupersededBy(stale), isFalse);
      // だからこそ live 判定は revision ではなく stale/live の値そのものを見る。
      expect(stale.live, isFalse);
    });

    test('revisionは64bitを超える桁でも比較できる', () {
      final older = status(revision: '9223372036854775807');
      expect(older.isSupersededBy(status(revision: '9223372036854775808')), isTrue);
    });
  });

  group('problem', () {
    test('healthがerrorならメッセージを出す', () {
      final s = status(health: 'error', message: '配信認証の混雑により接続を待機中です');
      expect(s.problem, '配信認証の混雑により接続を待機中です');
    });

    test('healthがerrorでなければ出さない', () {
      expect(status(health: 'ok', message: 'なにか').problem, isNull);
      expect(status(health: 'connecting', message: 'なにか').problem, isNull);
    });

    // Workerが落ちて更新が止まっただけの古いエラーを現在の障害として出すと消えない。
    test('staleなerrorは出さない', () {
      expect(status(health: 'error', stale: true, message: 'なにか').problem, isNull);
    });

    test('メッセージが空でも既定文を出す', () {
      expect(status(health: 'error').problem, isNotNull);
    });
  });

  group('tryParse', () {
    test('pushのpayload(live/staleなし)はactivityからliveを導く', () {
      final parsed = ListenerStatus.tryParse({
        'roomId': 'room_a',
        'revision': '42',
        'status': 'connected',
        'activity': 'live',
        'health': 'ok',
        'reason': null,
        'message': '配信に接続しました',
        'updatedAt': '2026-08-24T12:00:00.000Z',
      });
      expect(parsed, isNotNull);
      expect(parsed!.live, isTrue);
      expect(parsed.stale, isFalse);
    });

    test('pollのpayloadはlive/staleをそのまま使う', () {
      final parsed = ListenerStatus.tryParse({
        'roomId': 'room_a',
        'revision': '42',
        'activity': 'live',
        'health': 'ok',
        'live': false,
        'stale': true,
      });
      expect(parsed!.live, isFalse);
      expect(parsed.stale, isTrue);
    });

    test('必須項目が欠けていたら捨てる', () {
      expect(ListenerStatus.tryParse({'revision': '1', 'activity': 'live', 'health': 'ok'}), isNull);
      expect(ListenerStatus.tryParse({'roomId': 'r', 'activity': 'live', 'health': 'ok'}), isNull);
      expect(ListenerStatus.tryParse({'roomId': 'r', 'revision': '1', 'health': 'ok'}), isNull);
    });

    test('revisionが数値文字列でなければ捨てる', () {
      expect(
        ListenerStatus.tryParse({
          'roomId': 'r',
          'revision': 'abc',
          'activity': 'live',
          'health': 'ok',
        }),
        isNull,
      );
    });
  });
}
