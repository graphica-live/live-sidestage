import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/battle_summary.dart';

void main() {
  group('BattleStatus.tryParse', () {
    test('4値をそのまま解釈する', () {
      expect(BattleStatus.tryParse('live'), BattleStatus.live);
      expect(BattleStatus.tryParse('finished'), BattleStatus.finished);
      expect(BattleStatus.tryParse('cut_short'), BattleStatus.cutShort);
    });

    test('未知の値・nullはunknown', () {
      expect(BattleStatus.tryParse('other'), BattleStatus.unknown);
      expect(BattleStatus.tryParse(null), BattleStatus.unknown);
    });
  });

  group('BattleOpponent.tryParse', () {
    test('tiktokIdとcountを解析できる', () {
      final opponent = BattleOpponent.tryParse({'tiktokId': 'rival', 'count': 2});
      expect(opponent!.tiktokId, 'rival');
      expect(opponent.count, 2);
    });

    test('tiktokIdが無ければnull(相手roomはあるが特定できないケース)', () {
      final opponent = BattleOpponent.tryParse({'count': 1});
      expect(opponent!.tiktokId, isNull);
      expect(opponent.count, 1);
    });

    test('countが0以下・欠損なら1へ落ちる', () {
      expect(BattleOpponent.tryParse({'count': 0})!.count, 1);
      expect(BattleOpponent.tryParse(<String, Object?>{})!.count, 1);
    });

    test('Map以外はnull(相手が全く特定できないケース)', () {
      expect(BattleOpponent.tryParse(null), isNull);
    });
  });

  group('BattleSummary.tryParse', () {
    test('正常な行を解析できる', () {
      final battle = BattleSummary.tryParse({
        'battleId': 'b1',
        'startedAt': '2026-08-28T09:00:00.000Z',
        'status': 'finished',
        'opponent': {'tiktokId': 'rival', 'count': 1},
        'selfScore': '1200',
        'opponentScore': '900',
      });

      expect(battle, isNotNull);
      expect(battle!.battleId, 'b1');
      expect(battle.status, BattleStatus.finished);
      expect(battle.opponent!.tiktokId, 'rival');
      expect(battle.selfScore, '1200');
      expect(battle.opponentScore, '900');
    });

    test('battleIdが無ければnull', () {
      expect(BattleSummary.tryParse({'status': 'live'}), isNull);
    });

    test('Map以外はnull', () {
      expect(BattleSummary.tryParse('not a map'), isNull);
    });

    test('opponent・selfScore・opponentScoreは全てnullになりうる', () {
      final battle = BattleSummary.tryParse({'battleId': 'b1', 'status': 'unknown'});
      expect(battle!.opponent, isNull);
      expect(battle.selfScore, isNull);
      expect(battle.opponentScore, isNull);
      expect(battle.startedAt, isNull);
    });

    test('30桁の数値文字列も精度を落とさずStringのまま保持する', () {
      const hugeScore = '123456789012345678901234567890';
      final battle = BattleSummary.tryParse({
        'battleId': 'b1',
        'status': 'live',
        'selfScore': hugeScore,
      });
      expect(battle!.selfScore, hugeScore);
    });
  });
}
