import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/models/app_config.dart';
import 'package:live_sidestage_mobile/models/voice_catalog.dart';

void main() {
  group('AppConfig.ttsVolume', () {
    test('既定値は100', () {
      expect(const AppConfig().ttsVolume, 100);
    });

    test('encode/decodeで往復する', () {
      final decoded = AppConfig.decode(const AppConfig(ttsVolume: 45).encode());
      expect(decoded.ttsVolume, 45);
    });

    test('ttsVolumeを持たない旧設定は100になる', () {
      final raw = jsonEncode({'schemaVersion': 1, 'revision': 3, 'ttsEnabled': true});
      expect(AppConfig.decode(raw).ttsVolume, 100);
    });

    test('範囲外は0-100へ丸め、非数値は100へ落とす', () {
      int volumeOf(Object? value) =>
          AppConfig.decode(jsonEncode({'ttsVolume': value})).ttsVolume;

      expect(volumeOf(-10), 0);
      expect(volumeOf(150), 100);
      expect(volumeOf('80'), 100);
    });

    test('bumpedはrevisionを進めて他の設定を保つ', () {
      const base = AppConfig(revision: 7, randomVoice: false, ttsVolume: 100);
      final next = base.bumped(ttsVolume: 30);

      expect(next.revision, 8);
      expect(next.ttsVolume, 30);
      expect(next.randomVoice, false);
      expect(next.ttsEnabled, true);
    });
  });

  group('AppConfig.fixedStyleId', () {
    test('既定値は四国めたん ノーマル', () {
      expect(const AppConfig().fixedStyleId, VoiceCatalog.defaultStyleId);
      expect(VoiceCatalog.labelFor(const AppConfig().fixedStyleId), '四国めたん ノーマル');
    });

    test('encode/decodeで往復する', () {
      // ずんだもん あまあま。
      final decoded = AppConfig.decode(const AppConfig(fixedStyleId: 1).encode());
      expect(decoded.fixedStyleId, 1);
    });

    test('キーを持たない旧設定は既定値になる', () {
      final raw = jsonEncode({'schemaVersion': 3, 'revision': 3, 'ttsEnabled': true});
      expect(AppConfig.decode(raw).fixedStyleId, VoiceCatalog.defaultStyleId);
    });

    // vvm を減らして実在しなくなった styleId を持ち続けると、合成のたびに失敗して
    // 読み上げが丸ごと無音になる。
    test('同梱していないstyleId・非数値は既定値へ落とす', () {
      int styleOf(Object? value) =>
          AppConfig.decode(jsonEncode({'fixedStyleId': value})).fixedStyleId;

      expect(styleOf(999), VoiceCatalog.defaultStyleId);
      expect(styleOf(-1), VoiceCatalog.defaultStyleId);
      expect(styleOf('3'), VoiceCatalog.defaultStyleId);
      expect(styleOf(null), VoiceCatalog.defaultStyleId);
    });

    test('bumpedはrevisionを進めて他の設定を保つ', () {
      const base = AppConfig(revision: 7, ttsVolume: 40);
      final next = base.bumped(fixedStyleId: 8);

      expect(next.revision, 8);
      expect(next.fixedStyleId, 8);
      expect(next.ttsVolume, 40);
    });

    // フィールドを足してもスキーマは上げない。上げると旧アプリが「未来のバージョン」と
    // 判定して設定の保存を丸ごと止めてしまう（isFutureVersion のコメント参照）。
    test('キーが増えてもschemaVersionは3のまま', () {
      expect(AppConfig.currentSchemaVersion, 3);
      expect(AppConfig.isFutureVersion(const AppConfig().encode()), isFalse);
    });
  });

  group('tryDecode', () {
    test('壊れたJSONはnull', () {
      expect(AppConfig.tryDecode('{'), isNull);
      expect(AppConfig.tryDecode('[]'), isNull);
    });

    test('空・nullはnull（未設定であって読めなかったわけではない）', () {
      expect(AppConfig.tryDecode(null), isNull);
      expect(AppConfig.tryDecode(''), isNull);
    });

    test('未対応の未来バージョンはnull', () {
      final raw = jsonEncode({'schemaVersion': AppConfig.currentSchemaVersion + 1});
      expect(AppConfig.tryDecode(raw), isNull);
    });

    test('decodeは読めないときに既定値へ落とす', () {
      expect(AppConfig.decode('{').ttsVolume, 100);
      expect(AppConfig.decode('{').sound.selectedGifts, isEmpty);
    });
  });

  group('v1からの移行', () {
    // v1: カテゴリ + トリガー + 音源ライブラリの3層。v2に対応物が無いので破棄するが、
    // TTS設定と効果音の全体スイッチ・全体音量は意味が変わっていないので引き継ぐ。
    final v1 = jsonEncode({
      'schemaVersion': 1,
      'revision': 12,
      'ttsEnabled': false,
      'randomVoice': false,
      'ttsVolume': 60,
      'sound': {
        'enabled': false,
        'masterVolume': 40,
        'categories': [
          {'id': 'cat', 'name': 'test', 'enabled': true}
        ],
        'triggers': [
          {'id': 'trg', 'name': 'x', 'categoryId': 'cat', 'soundIds': ['snd'], 'eventType': 'gift'}
        ],
        'assets': [
          {'id': 'snd', 'name': 'Drumroll', 'fileName': 'snd.mp3', 'source': 'local'}
        ],
      },
    });

    test('TTS設定を引き継ぐ', () {
      final config = AppConfig.tryDecode(v1)!;
      expect(config.ttsEnabled, false);
      expect(config.randomVoice, false);
      expect(config.ttsVolume, 60);
    });

    test('効果音の全体スイッチと全体音量を引き継ぐ', () {
      final config = AppConfig.tryDecode(v1)!;
      expect(config.sound.enabled, false);
      expect(config.sound.masterVolume, 40);
    });

    test('トリガー・カテゴリ・音源ライブラリは破棄する', () {
      expect(AppConfig.tryDecode(v1)!.sound.selectedGifts, isEmpty);
    });

    test('空でも「メイン」セットが1つできる（空のセット状態を作らない）', () {
      final sets = AppConfig.tryDecode(v1)!.sound.sets;
      expect(sets, hasLength(1));
      expect(sets.single.id, SoundSet.defaultId);
      expect(sets.single.name, SoundSet.defaultName);
    });

    test('revisionは引き継ぐ（背景Isolateとの順序保証が壊れないように）', () {
      expect(AppConfig.tryDecode(v1)!.revision, 12);
    });

    test('スキーマ版は最新へ上がる', () {
      expect(AppConfig.tryDecode(v1)!.schemaVersion, AppConfig.currentSchemaVersion);
    });
  });

  group('GiftSound', () {
    test('giftNameはtrim+小文字化して保持する', () {
      final parsed = GiftSound.tryParse({
        'id': 'g1',
        'fileName': 'a.mp3',
        'giftName': '  Rose  ',
      })!;
      expect(parsed.giftName, 'rose');
    });

    test('giftLabelは元の表記のまま', () {
      final parsed = GiftSound.tryParse({
        'id': 'g1',
        'fileName': 'a.mp3',
        'giftName': 'Rose',
        'giftLabel': 'Rose',
      })!;
      expect(parsed.giftLabel, 'Rose');
    });

    test('fileNameが無い行は捨てる（鳴らしようがない）', () {
      expect(GiftSound.tryParse({'id': 'g1', 'giftName': 'rose'}), isNull);
      expect(GiftSound.tryParse({'id': 'g1', 'fileName': ''}), isNull);
    });

    test('idが無い行は捨てる', () {
      expect(GiftSound.tryParse({'fileName': 'a.mp3'}), isNull);
    });

    test('displayGiftNameはlabel→name→すべてのギフトの順に落ちる', () {
      expect(
        const GiftSound(id: 'g', giftName: 'rose', giftLabel: 'Rose', fileName: 'a.mp3')
            .displayGiftName,
        'Rose',
      );
      expect(
        const GiftSound(id: 'g', giftName: 'rose', fileName: 'a.mp3').displayGiftName,
        'rose',
      );
      expect(
        const GiftSound(id: 'g', giftName: '', fileName: 'a.mp3').displayGiftName,
        'すべてのギフト',
      );
    });

    test('壊れた行だけ捨てて他は残す', () {
      final config = SoundConfig.fromJson({
        'gifts': [
          {'id': 'g1', 'fileName': 'a.mp3'},
          {'id': 'broken'},
          'not a map',
          {'id': 'g2', 'fileName': 'b.mp3'},
        ],
      });
      expect(config.selectedGifts.map((g) => g.id), ['g1', 'g2']);
    });

    test('encode/decodeで往復する', () {
      final original = AppConfig(
        sound: SoundConfig(
          masterVolume: 70,
          sets: const [
            SoundSet(
              id: SoundSet.defaultId,
              gifts: [
                GiftSound(
                  id: 'g1',
                  giftName: 'rose',
                  giftLabel: 'Rose',
                  giftImageUrl: 'https://p16.tiktokcdn.com/rose.png',
                  fileName: 'a.mp3',
                  soundName: 'Drumroll',
                  source: SoundSourceKind.soundEffectLab,
                  sourceUrl: 'https://soundeffect-lab.info/sound/a.mp3',
                  volume: 80,
                  enabled: false,
                ),
              ],
            ),
          ],
        ),
      );
      final decoded = AppConfig.decode(original.encode());
      final gift = decoded.sound.selectedGifts.single;

      expect(decoded.sound.masterVolume, 70);
      expect(gift.id, 'g1');
      expect(gift.giftName, 'rose');
      expect(gift.giftLabel, 'Rose');
      expect(gift.giftImageUrl, 'https://p16.tiktokcdn.com/rose.png');
      expect(gift.fileName, 'a.mp3');
      expect(gift.soundName, 'Drumroll');
      expect(gift.source, SoundSourceKind.soundEffectLab);
      expect(gift.sourceUrl, 'https://soundeffect-lab.info/sound/a.mp3');
      expect(gift.volume, 80);
      expect(gift.enabled, false);
    });
  });

  group('GiftSound.giftImageUrl', () {
    GiftSound parseImage(Object? value) => GiftSound.tryParse({
          'id': 'g1',
          'fileName': 'a.mp3',
          'giftImageUrl': value,
        })!;

    test('https のURLだけ受け入れる', () {
      expect(parseImage('https://p16.tiktokcdn.com/rose.png').giftImageUrl,
          'https://p16.tiktokcdn.com/rose.png');
      expect(parseImage('http://p16.tiktokcdn.com/rose.png').giftImageUrl, isNull);
      expect(parseImage('javascript:alert(1)').giftImageUrl, isNull);
      expect(parseImage('/rose.png').giftImageUrl, isNull);
      expect(parseImage(42).giftImageUrl, isNull);
    });

    test('キーを持たない旧設定は null', () {
      expect(GiftSound.tryParse({'id': 'g1', 'fileName': 'a.mp3'})!.giftImageUrl, isNull);
    });

    test('copyWith は未指定なら保ち、null を渡せば消す', () {
      const gift = GiftSound(
        id: 'g1',
        giftName: 'rose',
        fileName: 'a.mp3',
        giftImageUrl: 'https://p16.tiktokcdn.com/rose.png',
      );

      expect(gift.copyWith(volume: 50).giftImageUrl, 'https://p16.tiktokcdn.com/rose.png');
      // 画像を持たないギフトへ選び直したら前の絵が残ってはいけない。
      expect(gift.copyWith(giftName: 'other', giftImageUrl: null).giftImageUrl, isNull);
    });
  });

  group('v2からv3への移行', () {
    final v2 = jsonEncode({
      'schemaVersion': 2,
      'revision': 5,
      'sound': {
        'enabled': true,
        'masterVolume': 70,
        'gifts': [
          {
            'id': 'g1',
            'giftName': 'rose',
            'fileName': 'a.mp3',
            'soundName': 'ぽん',
            'volume': 40,
            'enabled': false,
          },
          {'id': 'g2', 'giftName': 'heart me', 'fileName': 'b.mp3'},
        ],
      },
    });

    test('平坦なgiftsが「メイン」1セットへ入る', () {
      final sound = AppConfig.tryDecode(v2)!.sound;
      expect(sound.sets, hasLength(1));
      expect(sound.sets.single.name, SoundSet.defaultName);
      expect(sound.selectedSetId, SoundSet.defaultId);
    });

    test('ギフト・音・個別音量・有効状態を失わない', () {
      final gifts = AppConfig.tryDecode(v2)!.sound.selectedGifts;
      expect(gifts.map((g) => g.id), ['g1', 'g2']);
      expect(gifts.first.fileName, 'a.mp3');
      expect(gifts.first.soundName, 'ぽん');
      expect(gifts.first.volume, 40);
      expect(gifts.first.enabled, isFalse);
    });

    test('全体音量と全体スイッチを引き継ぐ', () {
      final sound = AppConfig.tryDecode(v2)!.sound;
      expect(sound.masterVolume, 70);
      expect(sound.enabled, isTrue);
    });

    // UI Isolate と背景 Isolate が同じ JSON をそれぞれ独立に decode する。
    // 時刻から作ると両者で別の id になり、selectedSetId が食い違う。
    test('移行後のセットIDは決定的', () {
      expect(AppConfig.tryDecode(v2)!.sound.sets.single.id, SoundSet.defaultId);
      expect(AppConfig.tryDecode(v2)!.sound.sets.single.id, SoundSet.defaultId);
    });

    test('新規インストールの既定セットも決定的', () {
      expect(const AppConfig().sound.sets.single.id, SoundSet.defaultId);
    });
  });

  group('SoundConfigの正規化', () {
    SoundSet setOf(String id) => SoundSet(id: id, name: id);

    test('セットが空なら1件作る（空のセット状態を作らない）', () {
      final config = SoundConfig(sets: const []);
      expect(config.sets, hasLength(1));
      expect(config.sets.single.id, SoundSet.defaultId);
    });

    // 先に切り詰めてから重複を除くと [A, A, B, C, D, E] が4件になり、
    // 上限に収まるはずのセットを余計に落とす。
    test('重複除去が先、上限での切り詰めが後', () {
      final config = SoundConfig(sets: [
        setOf('A'),
        setOf('A'),
        setOf('B'),
        setOf('C'),
        setOf('D'),
        setOf('E'),
      ]);
      expect(config.sets.map((s) => s.id), ['A', 'B', 'C', 'D', 'E']);
    });

    test('上限を超えたぶんは切り詰める', () {
      final config = SoundConfig(sets: [for (var i = 0; i < 9; i++) setOf('s$i')]);
      expect(config.sets, hasLength(SoundConfig.maxSets));
    });

    test('selectedSetIdが存在しなければ先頭へ落ちる', () {
      expect(
        SoundConfig(sets: [setOf('A'), setOf('B')], selectedSetId: 'gone').selectedSetId,
        'A',
      );
    });

    test('selectedSetIdが存在すればそのまま', () {
      expect(
        SoundConfig(sets: [setOf('A'), setOf('B')], selectedSetId: 'B').selectedSet.id,
        'B',
      );
    });

    test('idを持たないセットは捨てる', () {
      final config = SoundConfig.fromJson({
        'sets': [
          {'id': 's1', 'gifts': <Object>[]},
          {'gifts': <Object>[]},
          {'id': 's2', 'gifts': <Object>[]},
        ],
      });
      expect(config.sets.map((s) => s.id), ['s1', 's2']);
    });

    test('セット名は長すぎれば切り詰め、空なら既定へ落とす', () {
      expect(SoundSet.normalizeName('あ' * 100).length, SoundSet.maxNameLength);
      expect(SoundSet.normalizeName('   '), 'セット');
      expect(SoundSet.normalizeName('  ダンス  '), 'ダンス');
    });
  });

  group('セット操作', () {
    SoundConfig base() => SoundConfig(
          sets: const [SoundSet(id: 'a', name: 'A'), SoundSet(id: 'b', name: 'B')],
          selectedSetId: 'a',
        );

    SoundConfig full() =>
        SoundConfig(sets: [for (var i = 0; i < SoundConfig.maxSets; i++) SoundSet(id: 's$i')]);

    test('addSetは末尾へ足して選択を移す', () {
      final next = base().addSet('ダンス', id: 'c');
      expect(next.sets.map((s) => s.id), ['a', 'b', 'c']);
      expect(next.selectedSetId, 'c');
      expect(next.sets.last.name, 'ダンス');
    });

    // UI の出し分けだけに頼ると、連打で上限を超えうる。
    test('addSetは上限を超えない', () {
      final next = full().addSet('6つ目', id: 'x');
      expect(next.sets, hasLength(SoundConfig.maxSets));
      expect(next.sets.any((s) => s.id == 'x'), isFalse);
    });

    test('renameSetは名前だけ変える', () {
      final next = base().renameSet('b', 'バトル');
      expect(next.sets.last.name, 'バトル');
      expect(next.selectedSetId, 'a');
    });

    // ぶつけたまま通すと、正規化が新しい方を落として「追加したのに増えない」になる。
    test('addSetは既存idとぶつかれば何もしない', () {
      final next = base().addSet('ダンス', id: 'b');
      expect(next.sets.map((s) => s.id), ['a', 'b']);
      expect(next.sets.last.name, 'B');
      expect(next.selectedSetId, 'a');
    });

    test('renameSetは存在しないidを無視する', () {
      expect(base().renameSet('gone', 'x').sets.map((s) => s.name), ['A', 'B']);
    });

    test('removeSetは最後の1セットを消さない', () {
      final one = SoundConfig(sets: const [SoundSet(id: 'only')]);
      expect(one.canRemoveSet, isFalse);
      expect(one.removeSet('only').sets, hasLength(1));
    });

    test('選択中セットを消したら同じ位置のセットへ移る', () {
      final config = SoundConfig(
        sets: const [SoundSet(id: 'a'), SoundSet(id: 'b'), SoundSet(id: 'c')],
        selectedSetId: 'b',
      );
      expect(config.removeSet('b').selectedSetId, 'c');
    });

    test('末尾の選択中セットを消したら手前へ移る', () {
      final config = SoundConfig(
        sets: const [SoundSet(id: 'a'), SoundSet(id: 'b')],
        selectedSetId: 'b',
      );
      expect(config.removeSet('b').selectedSetId, 'a');
    });

    test('選択していないセットを消しても選択は動かない', () {
      expect(base().removeSet('b').selectedSetId, 'a');
    });

    test('reorderSetsは並びを入れ替える', () {
      final config = SoundConfig(
        sets: const [SoundSet(id: 'a'), SoundSet(id: 'b'), SoundSet(id: 'c')],
      );
      expect(config.reorderSets(0, 2).sets.map((s) => s.id), ['b', 'c', 'a']);
      expect(config.reorderSets(2, 0).sets.map((s) => s.id), ['c', 'a', 'b']);
    });

    test('reorderSetsは範囲外を無視する', () {
      expect(base().reorderSets(5, 0).sets.map((s) => s.id), ['a', 'b']);
    });

    test('selectSetは存在しないidを無視する', () {
      expect(base().selectSet('gone').selectedSetId, 'a');
    });

    test('updateSetは対象セットだけ書き換える', () {
      final config = SoundConfig(sets: const [
        SoundSet(id: 'a', gifts: [GiftSound(id: 'g1', giftName: '', fileName: 'a.mp3')]),
        SoundSet(id: 'b'),
      ]);
      final next = config.updateSet(
        'b',
        (gifts) => [...gifts, const GiftSound(id: 'g2', giftName: '', fileName: 'b.mp3')],
      );
      expect(next.sets.first.gifts.map((g) => g.id), ['g1']);
      expect(next.sets.last.gifts.map((g) => g.id), ['g2']);
    });

    // 編集画面を開いている間にセットが消えたら、黙って別のセットへ書き足さない。
    test('updateSetは存在しないセットで投げる', () {
      expect(() => base().updateSet('gone', (gifts) => gifts), throwsStateError);
    });
  });

  group('セットの複製', () {
    SoundConfig source() => SoundConfig(sets: const [
          SoundSet(id: 'a', name: '通常配信', gifts: [
            GiftSound(id: 'g1', giftName: 'rose', fileName: 'a.mp3', volume: 40),
            GiftSound(id: 'g2', giftName: 'heart', fileName: 'b.mp3', enabled: false),
          ]),
        ]);

    test('複製元の直後へ挿し、選択を移す', () {
      final next = source().duplicateSet('a', '通常配信 コピー', id: 'copy');
      expect(next.sets.map((s) => s.id), ['a', 'copy']);
      expect(next.selectedSetId, 'copy');
      expect(next.sets.last.name, '通常配信 コピー');
    });

    test('ギフト設定・個別音量・有効状態をコピーする', () {
      final copy = source().duplicateSet('a', 'コピー', id: 'copy').sets.last;
      expect(copy.gifts.map((g) => g.giftName), ['rose', 'heart']);
      expect(copy.gifts.first.volume, 40);
      expect(copy.gifts.last.enabled, isFalse);
    });

    // まとめ投げの抑止キーは '<giftSoundId>|<comboId>'。id が同じだと
    // 複製元で鳴った瞬間に複製先まで抑止される。
    test('GiftSoundのidは振り直す', () {
      final copy = source().duplicateSet('a', 'コピー', id: 'copy').sets.last;
      expect(copy.gifts.map((g) => g.id), isNot(contains('g1')));
      expect(copy.gifts.map((g) => g.id).toSet(), hasLength(2));
    });

    // 実ファイルはコピーしない。5セットぶんに膨らむと総容量の上限に当たる。
    test('fileNameは共有する', () {
      final copy = source().duplicateSet('a', 'コピー', id: 'copy').sets.last;
      expect(copy.gifts.map((g) => g.fileName), ['a.mp3', 'b.mp3']);
    });

    test('上限に達していれば複製しない', () {
      final full =
          SoundConfig(sets: [for (var i = 0; i < SoundConfig.maxSets; i++) SoundSet(id: 's$i')]);
      expect(full.duplicateSet('s0', 'コピー', id: 'x').sets, hasLength(SoundConfig.maxSets));
    });

    test('存在しないセットは複製しない', () {
      expect(source().duplicateSet('gone', 'コピー', id: 'x').sets, hasLength(1));
    });
  });

  group('referencedFileNames', () {
    test('全セットを横断して集める', () {
      final config = SoundConfig(
        sets: const [
          SoundSet(id: 'a', gifts: [GiftSound(id: 'g1', giftName: '', fileName: 'a.mp3')]),
          SoundSet(id: 'b', gifts: [GiftSound(id: 'g2', giftName: '', fileName: 'b.mp3')]),
        ],
        selectedSetId: 'a',
      );
      // 選択中セットだけを見ると、裏のセットが使うファイルを孤児と誤判定する。
      expect(config.referencedFileNames, {'a.mp3', 'b.mp3'});
    });

    test('複製で共有されたファイルは片方の行を消しても参照が残る', () {
      var config = SoundConfig(sets: const [
        SoundSet(id: 'a', gifts: [GiftSound(id: 'g1', giftName: '', fileName: 'shared.mp3')]),
      ]);
      config = config.duplicateSet('a', 'コピー', id: 'copy');
      config = config.updateSet('a', (gifts) => const []);

      expect(config.referencedFileNames, contains('shared.mp3'));
    });

    test('どこからも参照されなくなれば消える', () {
      var config = SoundConfig(sets: const [
        SoundSet(id: 'a', gifts: [GiftSound(id: 'g1', giftName: '', fileName: 'lonely.mp3')]),
      ]);
      config = config.updateSet('a', (gifts) => const []);
      expect(config.referencedFileNames, isEmpty);
    });
  });

  group('isFutureVersion', () {
    test('未来のスキーマならtrue', () {
      final raw = jsonEncode({'schemaVersion': AppConfig.currentSchemaVersion + 1});
      expect(AppConfig.isFutureVersion(raw), isTrue);
    });

    test('現行・過去のスキーマはfalse', () {
      expect(
        AppConfig.isFutureVersion(jsonEncode({'schemaVersion': AppConfig.currentSchemaVersion})),
        isFalse,
      );
      expect(AppConfig.isFutureVersion(jsonEncode({'schemaVersion': 1})), isFalse);
    });

    // 壊れたJSONは上書きで復旧させたいので、保存を止める対象にしない。
    test('壊れたJSON・空・nullはfalse', () {
      expect(AppConfig.isFutureVersion('{'), isFalse);
      expect(AppConfig.isFutureVersion('[]'), isFalse);
      expect(AppConfig.isFutureVersion(''), isFalse);
      expect(AppConfig.isFutureVersion(null), isFalse);
    });
  });
}
