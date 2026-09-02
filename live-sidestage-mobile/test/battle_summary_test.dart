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

    test('avatarUrlを解析できる。空文字・欠損はnull', () {
      expect(BattleOpponent.tryParse({'count': 1, 'avatarUrl': 'https://x/a.png'})!.avatarUrl, 'https://x/a.png');
      expect(BattleOpponent.tryParse({'count': 1, 'avatarUrl': ''})!.avatarUrl, isNull);
      expect(BattleOpponent.tryParse({'count': 1})!.avatarUrl, isNull);
    });
  });

  group('BattleParticipant.tryParseList', () {
    test('anchorIdとavatarUrlを持つ配列を解析できる', () {
      final list = BattleParticipant.tryParseList([
        {'anchorId': 'a1', 'avatarUrl': 'https://x/a1.png'},
        {'anchorId': 'a2', 'avatarUrl': null},
      ]);
      expect(list, hasLength(2));
      expect(list![0].anchorId, 'a1');
      expect(list[0].avatarUrl, 'https://x/a1.png');
      expect(list[1].avatarUrl, isNull);
    });

    test('anchorIdが無い要素は除外する', () {
      final list = BattleParticipant.tryParseList([
        {'avatarUrl': 'https://x/a.png'},
        {'anchorId': 'a1'},
      ]);
      expect(list, hasLength(1));
      expect(list![0].anchorId, 'a1');
    });

    test('null・List以外はnull', () {
      expect(BattleParticipant.tryParseList(null), isNull);
      expect(BattleParticipant.tryParseList('not a list'), isNull);
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

    test('selfTeam・opponentTeamを解析できる', () {
      final battle = BattleSummary.tryParse({
        'battleId': 'b1',
        'status': 'finished',
        'selfTeam': [
          {'anchorId': 'me', 'avatarUrl': 'https://x/me.png'},
        ],
        'opponentTeam': [
          {'anchorId': 'r1', 'avatarUrl': 'https://x/r1.png'},
          {'anchorId': 'r2', 'avatarUrl': null},
        ],
      });
      expect(battle!.selfTeam, hasLength(1));
      expect(battle.selfTeam![0].avatarUrl, 'https://x/me.png');
      expect(battle.opponentTeam, hasLength(2));
    });

    test('selfTeam・opponentTeamが無ければnull(対戦相手不明・チーム未解決)', () {
      final battle = BattleSummary.tryParse({'battleId': 'b1', 'status': 'unknown'});
      expect(battle!.selfTeam, isNull);
      expect(battle.opponentTeam, isNull);
    });
  });

  group('BattleTeam(3陣営以上)', () {
    Map<String, Object?> team(int index, bool isSelf, String? score, List<String> anchorIds) => {
          'index': index,
          'isSelf': isSelf,
          'score': score,
          'participants': [
            for (final id in anchorIds) {'anchorId': id, 'tiktokId': '${id}_handle'},
          ],
        };

    test('陣営ごとのスコアと参加者を解析できる', () {
      final battle = BattleSummary.tryParse({
        'battleId': 'b1',
        'status': 'finished',
        'selfScore': '150',
        'teams': [
          team(0, true, '150', ['me', 'ally']),
          team(1, false, '100', ['x1', 'x2']),
          team(2, false, '15', ['y1', 'y2']),
        ],
      });
      expect(battle!.teams, hasLength(3));
      expect(battle.teams![0].isSelf, isTrue);
      expect(battle.teams![1].score, '100');
      expect(battle.teams![2].participants.map((p) => p.anchorId), ['y1', 'y2']);
    });

    test('陣営が2つ未満ならteamsはnull(従来のselfTeam/opponentTeam表示へ倒す)', () {
      final battle = BattleSummary.tryParse({
        'battleId': 'b1',
        'status': 'finished',
        'teams': [team(0, true, '10', ['me'])],
      });
      expect(battle!.teams, isNull);
    });

    test('teamsが無い(古いサーバー)ならnull', () {
      expect(BattleSummary.tryParse({'battleId': 'b1', 'status': 'live'})!.teams, isNull);
    });

    test('maxOtherTeamScoreは自陣以外の最大スコア。全てnullならnull', () {
      final battle = BattleSummary.tryParse({
        'battleId': 'b1',
        'status': 'finished',
        'teams': [
          team(0, true, '150', ['me']),
          team(1, false, '100', ['x1']),
          team(2, false, '900', ['y1']),
        ],
      });
      expect(battle!.maxOtherTeamScore, '900');

      final noScores = BattleSummary.tryParse({
        'battleId': 'b2',
        'status': 'finished',
        'teams': [
          team(0, true, '150', ['me']),
          team(1, false, null, ['x1']),
        ],
      });
      expect(noScores!.maxOtherTeamScore, isNull);
    });

    test('30桁のスコアもStringのまま比較できる(桁あふれしない)', () {
      const huge = '999999999999999999999999999999';
      final battle = BattleSummary.tryParse({
        'battleId': 'b1',
        'status': 'finished',
        'teams': [
          team(0, true, '1', ['me']),
          team(1, false, huge, ['x1']),
          team(2, false, '2', ['y1']),
        ],
      });
      expect(battle!.maxOtherTeamScore, huge);
    });
  });
}
