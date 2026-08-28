import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:path_provider/path_provider.dart';
import 'package:voicevox_core/voicevox_core.dart';

import 'voice_pool.dart';

const List<String> _dictFileNames = [
  'char.bin',
  'COPYING',
  'left-id.def',
  'matrix.bin',
  'pos-id.def',
  'rewrite.def',
  'right-id.def',
  'sys.dic',
  'unk.dic',
];

const List<String> _modelFileNames = ['0.vvm', '4.vvm'];

class TtsAssetPaths {
  TtsAssetPaths({required this.dictDir, required this.modelPaths});

  final String dictDir;
  final List<String> modelPaths;
}

Future<TtsAssetPaths> extractTtsAssets() async {
  final supportDir = await getApplicationSupportDirectory();

  final dictDir = Directory('${supportDir.path}/open_jtalk_dic_utf_8-1.11');
  await dictDir.create(recursive: true);
  for (final name in _dictFileNames) {
    final file = File('${dictDir.path}/$name');
    if (await file.exists()) continue;
    final data = await rootBundle.load('assets/open_jtalk_dic_utf_8-1.11/$name');
    await file.writeAsBytes(data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes));
  }

  final modelDir = Directory('${supportDir.path}/voicevox_models');
  await modelDir.create(recursive: true);
  final modelPaths = <String>[];
  for (final name in _modelFileNames) {
    final file = File('${modelDir.path}/$name');
    if (!await file.exists()) {
      final data = await rootBundle.load('assets/voicevox_models/$name');
      await file.writeAsBytes(data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes));
    }
    modelPaths.add(file.path);
  }

  return TtsAssetPaths(dictDir: dictDir.path, modelPaths: modelPaths);
}

// Isolate間のメッセージはSendPort/String/int/Uint8List/List/Mapなど、
// isolate境界を越えて確実に送受信できるプリミティブ型のみで構成する
// (独自クラスのインスタンスは送受信可否が不確実なため使わない)。
//
// メインisolate → ワーカーisolate: ['synthesize', id, text, styleId]
// ワーカーisolate → メインisolate:
//   ['ready', metasJson]
//   ['init_error', message]
//   ['result', id, wavBytes]
//   ['result_error', id, message]

class TtsEngine {
  final ReceivePort _receivePort = ReceivePort();
  SendPort? _workerSendPort;
  final Map<int, Completer<Uint8List>> _pending = {};
  int _nextId = 0;
  List<VoiceStyle> voices = [];

  Future<void> initialize() async {
    final assets = await extractTtsAssets();
    final readyCompleter = Completer<void>();

    _receivePort.listen((dynamic message) {
      if (message is SendPort) {
        _workerSendPort = message;
        return;
      }
      if (message is! List) return;

      final tag = message[0] as String;
      switch (tag) {
        case 'ready':
          voices = VoiceStyle.listFromMetasJson(message[1] as String);
          if (!readyCompleter.isCompleted) readyCompleter.complete();
        case 'init_error':
          if (!readyCompleter.isCompleted) {
            readyCompleter.completeError(Exception(message[1] as String));
          }
        case 'result':
          final id = message[1] as int;
          final completer = _pending.remove(id);
          completer?.complete(message[2] as Uint8List);
        case 'result_error':
          final id = message[1] as int;
          final completer = _pending.remove(id);
          completer?.completeError(Exception(message[2] as String));
      }
    });

    await Isolate.spawn(_isolateMain, [
      _receivePort.sendPort,
      assets.dictDir,
      assets.modelPaths,
    ]);

    await readyCompleter.future;
  }

  Future<Uint8List> synthesize(String text, int styleId) {
    final id = _nextId++;
    final completer = Completer<Uint8List>();
    _pending[id] = completer;
    _workerSendPort!.send(['synthesize', id, text, styleId]);
    return completer.future;
  }

  void dispose() {
    _receivePort.close();
  }
}

void _isolateMain(List<dynamic> args) {
  final mainSendPort = args[0] as SendPort;
  final dictDir = args[1] as String;
  final modelPaths = args[2] as List<String>;

  final workerReceivePort = ReceivePort();
  mainSendPort.send(workerReceivePort.sendPort);

  if (Platform.isAndroid) {
    // voicevox_coreパッケージのAndroidデフォルトファイル名には"lib"接頭辞が付かず、
    // 実際にjniLibsへ配置したファイル名(lib*.so)と一致しないため明示的に指定する。
    VoicevoxCoreDynamicLibraryService().set('core', 'libvoicevox_core.so');
    VoicevoxCoreDynamicLibraryService().set('onnxruntime', 'libvoicevox_onnxruntime.so');
  } else if (Platform.isIOS) {
    // iOSはbare dylibではなく ios/VoicevoxNative の xcframework を Runner.app へ
    // Embedしたものを開く。パスはバンドル内のframework相対で解決される。
    // 'onnxruntime'キーは設定しない。このキーは voicevoxxOnnxruntimeLoadOnce() が
    // options.filename として渡すためだけのもので、iOSで使う init_once 経路では
    // 参照されない。ONNX Runtime本体は voicevox_core が @rpath で直接リンクして
    // いるので、同じFrameworksディレクトリに同梱されていればdyldが解決する。
    VoicevoxCoreDynamicLibraryService().set('core', 'voicevox_core.framework/voicevox_core');
  }

  // iOS向けにリリースされている voicevox_core は ONNX Runtime をリンク済みで
  // ビルドされており、voicevox_onnxruntime_load_once シンボルを持たない
  // (nmで確認済み。iOSスライスにあるのは voicevox_onnxruntime_init_once のみ)。
  // 呼び分けないとiOSではシンボル解決に失敗する。戻り値のレコード型は同一。
  final onnxResult = Platform.isIOS
      ? voicevoxxOnnxruntimeInitOnce()
      : voicevoxxOnnxruntimeLoadOnce();
  if (onnxResult.result != VOICEVOX_RESULT_OK) {
    mainSendPort.send(['init_error', 'ONNX Runtimeの読み込みに失敗しました (code=${onnxResult.result})']);
    return;
  }

  final openJtalkResult = voicevoxxOpenJtalkRcNew(dictDir);
  if (openJtalkResult.result != VOICEVOX_RESULT_OK) {
    mainSendPort.send(['init_error', 'OpenJTalk辞書の読み込みに失敗しました (code=${openJtalkResult.result})']);
    return;
  }

  final synthesizerResult = onnxResult.onnxruntime.createSynthesizer(openJtalkResult.openJtalk);
  if (synthesizerResult.result != VOICEVOX_RESULT_OK) {
    mainSendPort.send(['init_error', 'Synthesizerの構築に失敗しました (code=${synthesizerResult.result})']);
    return;
  }
  final synthesizer = synthesizerResult.synthesizer;

  for (final path in modelPaths) {
    final modelResult = voicevoxxVoiceModelFileOpen(path);
    if (modelResult.result != VOICEVOX_RESULT_OK) {
      mainSendPort.send(['init_error', '音声モデルを開けませんでした: $path (code=${modelResult.result})']);
      return;
    }
    final loadResult = synthesizer.loadModel(modelResult.model);
    if (loadResult != VOICEVOX_RESULT_OK) {
      mainSendPort.send(['init_error', '音声モデルの読み込みに失敗しました: $path (code=$loadResult)']);
      return;
    }
  }

  final metasJson = synthesizer.getMetasJson();
  mainSendPort.send(['ready', metasJson]);

  workerReceivePort.listen((dynamic message) {
    if (message is! List || message[0] != 'synthesize') return;
    final id = message[1] as int;
    final text = message[2] as String;
    final styleId = message[3] as int;

    final queryResult = synthesizer.createAudioQuery(text, styleId);
    if (queryResult.result != VOICEVOX_RESULT_OK) {
      mainSendPort.send(['result_error', id, 'AudioQuery生成失敗 (code=${queryResult.result})']);
      return;
    }

    final query = jsonDecode(queryResult.audioQueryJson) as Map<String, dynamic>;
    query['volumeScale'] = 0.8;
    query['speedScale'] = 1.0;
    query['prePhonemeLength'] = 0;
    query['postPhonemeLength'] = 0;

    final synthesisResult = synthesizer.synthesis(jsonEncode(query), styleId);
    if (synthesisResult.result != VOICEVOX_RESULT_OK) {
      mainSendPort.send(['result_error', id, '音声合成失敗 (code=${synthesisResult.result})']);
      return;
    }

    mainSendPort.send(['result', id, synthesisResult.wav]);
  });
}
