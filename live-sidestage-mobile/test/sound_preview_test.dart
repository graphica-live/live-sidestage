import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:live_sidestage_mobile/core/sound_library.dart';
import 'package:live_sidestage_mobile/core/sound_preview.dart';
import 'package:live_sidestage_mobile/models/app_config.dart';

/// 再生要求を記録するだけの fake。完了タイミングをテスト側で制御する。
class FakePreviewPlayer implements PreviewPlayer {
  final List<String> played = [];
  final List<Uint8List> playedBytes = [];
  final List<double> volumes = [];
  int stopCount = 0;
  bool disposed = false;

  /// 呼ばれた順の記録。`stop` と `play` の前後関係を見るため。
  final List<String> events = [];

  /// 設定すると [stop] がこれを待つ。await 中に画面が閉じる状況を作るため。
  Completer<void>? stopGate;

  /// 設定すると **次の1回だけ** [playBytes] がこれを待つ。
  /// 再生開始の完了順が入れ替わる状況を作るため。
  Completer<void>? playGate;

  /// 設定すると [play] がこの例外を投げる。
  Object? playError;

  @override
  Future<void> play(String filePath, double volume) async {
    final error = playError;
    if (error != null) throw error;
    played.add(filePath);
    volumes.add(volume);
    events.add('play');
  }

  @override
  Future<void> playBytes(Uint8List bytes, double volume) async {
    final error = playError;
    if (error != null) throw error;
    final gate = playGate;
    playGate = null;
    if (gate != null) await gate.future;
    playedBytes.add(bytes);
    volumes.add(volume);
    events.add('play');
  }

  @override
  Future<void> stop() async {
    stopCount++;
    events.add('stop');
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

  group('検索結果の試聴', () {
    const labSound = RemoteSound(
      name: 'ドラムロール',
      mp3Url: 'https://soundeffect-lab.info/sound/battle/mp3/drum.mp3',
    );

    /// 応答を差し替えた [SoundPreview] を作る。
    SoundPreview previewWith(http.Client client) {
      final library = SoundLibrary(client: client, overrideDirectory: root);
      addTearDown(library.dispose);
      return SoundPreview(library: library, player: player);
    }

    Future<String?> playLab(SoundPreview preview, {int masterVolume = 100}) => preview.playRemote(
          sound: labSound,
          source: SoundSourceKind.soundEffectLab,
          masterVolume: masterVolume,
        );

    test('取り込まずに、取得したバイト列をそのまま鳴らす', () async {
      final bytes = Uint8List.fromList([1, 2, 3]);
      final preview = previewWith(MockClient((_) async => http.Response.bytes(bytes, 200)));

      final error = await playLab(preview, masterVolume: 50);

      expect(error, isNull);
      expect(player.playedBytes.single, bytes);
      // ギフトごとの音量はまだ無いので、全体音量だけが掛かる。
      expect(player.volumes.single, closeTo(0.5, 0.0001));
      // 試聴は端末に何も残さない。
      expect((await preview.library.soundsDirectory()).listSync(), isEmpty);
    });

    test('許可外ホストの URL は取りに行かない', () async {
      var requests = 0;
      final preview = previewWith(MockClient((_) async {
        requests++;
        return http.Response.bytes(Uint8List.fromList([1]), 200);
      }));

      final error = await preview.playRemote(
        sound: const RemoteSound(name: 'x', mp3Url: 'https://evil.example.com/a.mp3'),
        source: SoundSourceKind.soundEffectLab,
        masterVolume: 100,
      );

      expect(error, contains(SoundLibrary.soundEffectLabHost));
      expect(requests, 0);
      expect(player.playedBytes, isEmpty);
    });

    test('途中で別ホストへリダイレクトされたら鳴らさない', () async {
      final preview = previewWith(MockClient((request) async {
        if (request.url.host == SoundLibrary.soundEffectLabHost) {
          return http.Response('', 302, headers: {'location': 'https://evil.example.com/a.mp3'});
        }
        return http.Response.bytes(Uint8List.fromList([1]), 200);
      }));

      final error = await playLab(preview);

      expect(error, isNotNull);
      expect(player.playedBytes, isEmpty);
    });

    test('端末内の音源には配布元が無いので鳴らさない', () async {
      final preview = previewWith(MockClient((_) async => http.Response.bytes(Uint8List.fromList([1]), 200)));

      final error = await preview.playRemote(
        sound: labSound,
        source: SoundSourceKind.local,
        masterVolume: 100,
      );

      expect(error, isNotNull);
      expect(player.playedBytes, isEmpty);
    });

    test('取得に失敗したらメッセージを返す', () async {
      final preview = previewWith(MockClient((_) async => http.Response('', 500)));

      final error = await playLab(preview);

      expect(error, contains('ダウンロードに失敗'));
      expect(player.playedBytes, isEmpty);
    });

    test('取得中に別の音を押したら、遅れて届いた方は鳴らさない', () async {
      final slow = Completer<void>();
      final preview = previewWith(MockClient((request) async {
        if (request.url.path.endsWith('slow.mp3')) {
          await slow.future;
          return http.Response.bytes(Uint8List.fromList([9]), 200);
        }
        return http.Response.bytes(Uint8List.fromList([1]), 200);
      }));

      final pending = preview.playRemote(
        sound: const RemoteSound(
          name: 'slow',
          mp3Url: 'https://soundeffect-lab.info/sound/slow.mp3',
        ),
        source: SoundSourceKind.soundEffectLab,
        masterVolume: 100,
      );
      await pumpEventQueue();
      await playLab(preview);
      slow.complete();

      expect(await pending, isNull);
      expect(player.playedBytes, [
        Uint8List.fromList([1]),
      ]);
    });

    test('取得中に止めたら鳴らさない', () async {
      final gate = Completer<void>();
      final preview = previewWith(MockClient((_) async {
        await gate.future;
        return http.Response.bytes(Uint8List.fromList([1]), 200);
      }));

      final pending = playLab(preview);
      await pumpEventQueue();
      await preview.stop();
      gate.complete();

      expect(await pending, isNull);
      expect(player.playedBytes, isEmpty);
    });

    test('追い越された要求は、後から鳴り始めた音を止めない', () async {
      final preview = previewWith(
        MockClient((_) async => http.Response.bytes(Uint8List.fromList([1]), 200)),
      );
      // 1件目の再生開始を止めておき、2件目に追い越させる。
      final firstPlay = Completer<void>();
      player.playGate = firstPlay;

      final pending = playLab(preview);
      await pumpEventQueue();
      await playLab(preview);
      firstPlay.complete();
      await pending;

      // 止めるのは各再生の直前だけ。追い越された側が後から止めると、
      // 鳴っているのは最新の音なのでそれを消してしまう。
      expect(player.events, ['stop', 'stop', 'play', 'play']);
    });

    test('画面を離れた後は鳴らさない', () async {
      final preview = previewWith(MockClient((_) async => http.Response.bytes(Uint8List.fromList([1]), 200)));
      await preview.dispose();

      final error = await playLab(preview);

      expect(error, isNull);
      expect(player.playedBytes, isEmpty);
    });
  });
}
