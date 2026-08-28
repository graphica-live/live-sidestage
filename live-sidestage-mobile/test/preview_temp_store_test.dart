import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/sound_library.dart';
import 'package:live_sidestage_mobile/core/sound_preview.dart';

Uint8List bytes(String s) => Uint8List.fromList(s.codeUnits);

void main() {
  late Directory dir;
  late PreviewTempStore store;

  setUp(() async {
    dir = await Directory.systemTemp.createTemp('preview_store_test');
    store = PreviewTempStore(overrideDirectory: dir);
  });

  tearDown(() async {
    if (await dir.exists()) await dir.delete(recursive: true);
  });

  Future<List<String>> names() async {
    final entries = await dir.list().toList();
    final result = entries.whereType<File>().map((f) => f.uri.pathSegments.last).toList();
    result.sort();
    return result;
  }

  group('stage', () {
    test('毎回ちがうファイル名にする', () async {
      // 同じパスを上書きすると audioplayers(darwin)が前の音をそのまま鳴らす。
      final a = await store.stage(bytes('one'), '.mp3');
      final b = await store.stage(bytes('two'), '.mp3');
      expect(a.path, isNot(b.path));
      expect(await names(), hasLength(2));
    });

    test('渡した拡張子で書く', () async {
      final staged = await store.stage(bytes('x'), '.wav');
      expect(staged.path, endsWith('.wav'));
    });

    test('中身がそのまま書かれる', () async {
      final staged = await store.stage(bytes('hello'), '.mp3');
      expect(await File(staged.path).readAsBytes(), bytes('hello'));
    });
  });

  group('deleteOlderThan', () {
    test('自分より古いものだけ消し、自分と新しいものは残す', () async {
      final a = await store.stage(bytes('a'), '.mp3');
      final b = await store.stage(bytes('b'), '.mp3');
      final c = await store.stage(bytes('c'), '.mp3');

      await store.deleteOlderThan(b.seq);

      expect(await File(a.path).exists(), isFalse);
      // 追い越された側が新しい音源を消すと、鳴る予定のファイルが消える。
      expect(await File(b.path).exists(), isTrue);
      expect(await File(c.path).exists(), isTrue);
    });

    test('二度呼んでも壊れない', () async {
      final a = await store.stage(bytes('a'), '.mp3');
      final b = await store.stage(bytes('b'), '.mp3');
      await store.deleteOlderThan(b.seq);
      await store.deleteOlderThan(b.seq);
      expect(await File(a.path).exists(), isFalse);
    });
  });

  test('deleteSeq は指定した1件だけ消す', () async {
    final a = await store.stage(bytes('a'), '.mp3');
    final b = await store.stage(bytes('b'), '.mp3');
    await store.deleteSeq(a.seq);
    expect(await File(a.path).exists(), isFalse);
    expect(await File(b.path).exists(), isTrue);
  });

  test('deleteAll は追跡中の全部を消す', () async {
    await store.stage(bytes('a'), '.mp3');
    await store.stage(bytes('b'), '.mp3');
    await store.deleteAll();
    expect(await names(), isEmpty);
  });

  group('sweepStale', () {
    test('古いファイルだけ消す', () async {
      final old = File('${dir.path}/prev_old.mp3');
      await old.writeAsBytes(bytes('old'));
      await old.setLastModified(DateTime.now().subtract(const Duration(hours: 2)));

      final fresh = File('${dir.path}/prev_fresh.mp3');
      await fresh.writeAsBytes(bytes('fresh'));

      await store.sweepStale();

      expect(await old.exists(), isFalse);
      // 新しいものは、別インスタンスが今まさに鳴らそうとしている可能性がある。
      expect(await fresh.exists(), isTrue);
    });

    test('二度目は何もしない', () async {
      await store.sweepStale();
      final old = File('${dir.path}/prev_old.mp3');
      await old.writeAsBytes(bytes('old'));
      await old.setLastModified(DateTime.now().subtract(const Duration(hours: 2)));

      await store.sweepStale();

      expect(await old.exists(), isTrue);
    });
  });

  group('SoundLibrary.previewExtensionOf', () {
    test('URLの拡張子を使う', () {
      expect(SoundLibrary.previewExtensionOf('https://example.com/a/b.wav'), '.wav');
    });

    test('クエリが付いていても取り違えない', () {
      expect(SoundLibrary.previewExtensionOf('https://example.com/a.mp3?token=x.zip'), '.mp3');
    });

    test('未知の拡張子と拡張子なしは mp3 に倒す', () {
      expect(SoundLibrary.previewExtensionOf('https://example.com/a.exe'), '.mp3');
      expect(SoundLibrary.previewExtensionOf('https://example.com/a'), '.mp3');
    });
  });
}
