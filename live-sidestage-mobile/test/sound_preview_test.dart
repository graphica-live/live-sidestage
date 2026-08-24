import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/sound_library.dart';
import 'package:live_sidestage_mobile/core/sound_preview.dart';

/// 再生要求を記録するだけの fake。完了タイミングをテスト側で制御する。
class FakePreviewPlayer implements PreviewPlayer {
  final List<String> played = [];
  final List<double> volumes = [];
  int stopCount = 0;
  bool disposed = false;

  /// 設定すると [stop] がこれを待つ。await 中に画面が閉じる状況を作るため。
  Completer<void>? stopGate;

  /// 設定すると [play] がこの例外を投げる。
  Object? playError;

  @override
  Future<void> play(String filePath, double volume) async {
    final error = playError;
    if (error != null) throw error;
    played.add(filePath);
    volumes.add(volume);
  }

  @override
  Future<void> stop() async {
    stopCount++;
    final gate = stopGate;
    if (gate != null) await gate.future;
  }

  @override
  Future<void> dispose() async {
    disposed = true;
  }
}

void main() {
  late Directory root;
  late SoundLibrary library;
  late FakePreviewPlayer player;
  late SoundPreview preview;

  setUp(() {
    root = Directory.systemTemp.createTempSync('sound_preview_test');
    library = SoundLibrary(overrideDirectory: root);
    player = FakePreviewPlayer();
    preview = SoundPreview(library: library, player: player);
  });

  tearDown(() {
    library.dispose();
    if (root.existsSync()) root.deleteSync(recursive: true);
  });

  /// `sounds/` に実ファイルを置く。パス解決は実ファイルの存在を見るため。
  Future<String> putSound(String fileName) async {
    final dir = await library.soundsDirectory();
    final file = File('${dir.path}${Platform.pathSeparator}$fileName');
    await file.writeAsBytes([0]);
    return file.path;
  }

  test('サービスが動いていなくても鳴らせる', () async {
    final path = await putSound('a.mp3');

    final error = await preview.play(fileName: 'a.mp3', volume: 100, masterVolume: 100);

    expect(error, isNull);
    expect(player.played, [path]);
  });

  test('全体音量が掛かる', () async {
    await putSound('a.mp3');

    await preview.play(fileName: 'a.mp3', volume: 50, masterVolume: 50);

    expect(player.volumes.single, closeTo(0.25, 0.0001));
  });

  test('ファイルが無ければメッセージを返し、鳴らさない', () async {
    final error = await preview.play(fileName: 'gone.mp3', volume: 100, masterVolume: 100);

    expect(error, isNotNull);
    expect(player.played, isEmpty);
  });

  test('sounds/ の外を指すファイル名は弾く', () async {
    final error = await preview.play(
      fileName: '../escaped.mp3',
      volume: 100,
      masterVolume: 100,
    );

    expect(error, isNotNull);
    expect(player.played, isEmpty);
  });

  test('連打しても重ならない。前の音を止めてから鳴らす', () async {
    final path = await putSound('a.mp3');

    await preview.play(fileName: 'a.mp3', volume: 100, masterVolume: 100);
    await preview.play(fileName: 'a.mp3', volume: 100, masterVolume: 100);

    expect(player.played, [path, path]);
    // 2回目は必ず停止を挟む。重ねると連打のぶんだけプレイヤーが増える。
    expect(player.stopCount, greaterThanOrEqualTo(2));
  });

  test('停止すると、進行中の再生要求も鳴らない', () async {
    await putSound('a.mp3');
    final gate = Completer<void>();
    player.stopGate = gate;

    final pending = preview.play(fileName: 'a.mp3', volume: 100, masterVolume: 100);
    await pumpEventQueue();
    player.stopGate = null;
    await preview.stop();
    gate.complete();

    expect(await pending, isNull);
    expect(player.played, isEmpty);
  });

  test('画面を離れたら、鳴り始める前の要求は捨てる', () async {
    await putSound('a.mp3');
    final gate = Completer<void>();
    player.stopGate = gate;

    final pending = preview.play(fileName: 'a.mp3', volume: 100, masterVolume: 100);
    await pumpEventQueue();
    await preview.dispose();
    gate.complete();

    expect(await pending, isNull);
    expect(player.played, isEmpty);
    expect(player.disposed, isTrue);
  });

  test('破棄後は鳴らさない', () async {
    await putSound('a.mp3');
    await preview.dispose();

    final error = await preview.play(fileName: 'a.mp3', volume: 100, masterVolume: 100);

    expect(error, isNull);
    expect(player.played, isEmpty);
  });

  test('再生に失敗したらメッセージを返す', () async {
    await putSound('a.mp3');
    player.playError = StateError('boom');

    final error = await preview.play(fileName: 'a.mp3', volume: 100, masterVolume: 100);

    expect(error, contains('再生に失敗しました'));
  });
}
