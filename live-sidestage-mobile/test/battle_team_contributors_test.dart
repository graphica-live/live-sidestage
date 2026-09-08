import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/battle_team_contributors.dart';

void main() {
  Map<String, Object?> contributor(String tiktokUid) => {
        'tiktokUid': tiktokUid,
        'nickname': tiktokUid,
        'giftCount': 1,
        'totalDiamonds': 10,
      };

  group('BattleTeamParticipantContributors.tryParse', () {
    test('正常な行を解析できる', () {
      final p = BattleTeamParticipantContributors.tryParse({
        'tiktokUid': 'a1',
        'displayName': 'Aさん',
        'captureStatus': 'partial',
        'partialNote': '一部欠測',
        'battleScore': '120',
        'observedGiftTotal': 5,
        'contributors': [contributor('u1')],
      });
      expect(p, isNotNull);
      expect(p!.tiktokUid, 'a1');
      expect(p.displayName, 'Aさん');
      expect(p.captureStatus, 'partial');
      expect(p.partialNote, '一部欠測');
      expect(p.battleScore, '120');
      expect(p.observedGiftTotal, 5);
      expect(p.contributors, hasLength(1));
      expect(p.contributors[0].tiktokUid, 'u1');
    });

    test('tiktokUidが無ければnull', () {
      expect(BattleTeamParticipantContributors.tryParse({'displayName': 'x'}), isNull);
    });

    test('displayName欠落はtiktokUidへフォールバック', () {
      final p = BattleTeamParticipantContributors.tryParse({'tiktokUid': 'a1'});
      expect(p!.displayName, 'a1');
    });

    test('Map以外はnull', () {
      expect(BattleTeamParticipantContributors.tryParse(null), isNull);
    });
  });

  group('BattleTeamContributors.tryParse', () {
    test('aggregateモードの陣営を解析できる', () {
      final team = BattleTeamContributors.tryParse({
        'index': 0,
        'isSelf': true,
        'displayName': '自陣',
        'battleScore': '150',
        'observedGiftTotal': 3,
        'contributors': [contributor('u1')],
        'participants': [],
        'selectorMode': 'aggregate',
      });
      expect(team, isNotNull);
      expect(team!.isSelf, isTrue);
      expect(team.isIndividual, isFalse);
      expect(team.contributors, hasLength(1));
    });

    test('individualモードの陣営(4陣営以上の統合列)を解析できる', () {
      final team = BattleTeamContributors.tryParse({
        'index': 1,
        'isSelf': false,
        'displayName': '相手陣営(統合)',
        'observedGiftTotal': 0,
        'contributors': [contributor('u1')],
        'participants': [
          {
            'tiktokUid': 'r1',
            'displayName': 'R1',
            'battleScore': '80',
            'observedGiftTotal': 1,
            'contributors': [contributor('u1')],
          },
          {
            'tiktokUid': 'r2',
            'displayName': 'R2',
            'battleScore': '60',
            'observedGiftTotal': 1,
            'contributors': [contributor('u2')],
          },
          {
            'tiktokUid': 'r3',
            'displayName': 'R3',
            'battleScore': '40',
            'observedGiftTotal': 1,
            'contributors': [contributor('u3')],
          },
        ],
        'selectorMode': 'individual',
      });
      expect(team, isNotNull);
      expect(team!.isIndividual, isTrue);
      expect(team.participants, hasLength(3));
      expect(team.participants[0].tiktokUid, 'r1');
    });

    test('selectorMode欠落・未知値はaggregateへフォールバック', () {
      final team = BattleTeamContributors.tryParse({'index': 0, 'observedGiftTotal': 0, 'contributors': []});
      expect(team!.isIndividual, isFalse);
      final unknown = BattleTeamContributors.tryParse({
        'index': 0,
        'observedGiftTotal': 0,
        'contributors': [],
        'selectorMode': 'other',
      });
      expect(unknown!.isIndividual, isFalse);
    });

    test('indexが無ければnull', () {
      expect(BattleTeamContributors.tryParse({'displayName': 'x'}), isNull);
    });

    test('participantsが不正(Map以外)でも空リストへ落ちる', () {
      final team = BattleTeamContributors.tryParse({
        'index': 0,
        'observedGiftTotal': 0,
        'contributors': [],
        'participants': 'not a list',
      });
      expect(team!.participants, isEmpty);
    });
  });

  group('BattleTeamContributors.tryParseList', () {
    Map<String, Object?> team(int index, bool isSelf) => {
          'index': index,
          'isSelf': isSelf,
          'observedGiftTotal': 0,
          'contributors': <Object?>[],
        };

    test('2陣営以上ならそのまま返す', () {
      final teams = BattleTeamContributors.tryParseList([team(0, true), team(1, false)]);
      expect(teams, hasLength(2));
    });

    test('1陣営以下(または欠損)ならnull', () {
      expect(BattleTeamContributors.tryParseList([team(0, true)]), isNull);
      expect(BattleTeamContributors.tryParseList(null), isNull);
      expect(BattleTeamContributors.tryParseList('not a list'), isNull);
    });

    test('4陣営以上も1件のリストとしてそのまま解析される(統合は個々のteam内で表現される)', () {
      final teams = BattleTeamContributors.tryParseList([
        team(0, true),
        team(1, false),
        team(2, false),
        team(3, false),
      ]);
      expect(teams, hasLength(4));
    });
  });
}
