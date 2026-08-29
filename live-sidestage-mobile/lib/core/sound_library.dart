import 'dart:async';
import 'dart:io';
import 'dart:typed_data' show BytesBuilder;

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import '../models/app_config.dart';

/// 外部サイトの検索結果1件。
@immutable
class RemoteSound {
  final String name;
  final String mp3Url;
  const RemoteSound({required this.name, required this.mp3Url});
}

/// 取り込みが完了した音源ファイル。**設定には入っていない。**
///
/// [SoundLibrary] は「どのギフトに割り当てるか」「有効か」を決める立場ではないので、
/// [GiftSound] ではなくこの DTO を返す。編集画面がギフト名などと組み合わせて
/// [GiftSound] を組み立てる。
@immutable
class ImportedSound {
  /// `sounds/` 配下の実ファイル名（basename）。
  final String fileName;
  final String soundName;
  final SoundSourceKind source;
  final String? sourceUrl;

  const ImportedSound({
    required this.fileName,
    required this.soundName,
    required this.source,
    this.sourceUrl,
  });
}

class SoundLibraryException implements Exception {
  final String message;
  SoundLibraryException(this.message);
  @override
  String toString() => message;
}

/// 音源ファイルの取得・保存・削除。
///
/// desktop(TikEffect)の soundeffect-lab.js / myinstants.js を移植しているが、
/// **そのままではない**。desktop は検索HTMLも音源も全量メモリへ読み込むので、
/// 公開アプリに載せると端末のメモリ・ストレージを枯渇させうる。
/// timeout・サイズ上限・リダイレクトの都度検証・総容量上限をここで課す。
class SoundLibrary {
  SoundLibrary({http.Client? client, this.overrideDirectory})
      : _client = client ?? http.Client();

  final http.Client _client;

  /// テスト用。指定すると `getApplicationSupportDirectory()` を使わない。
  final Directory? overrideDirectory;

  static const Duration requestTimeout = Duration(seconds: 15);

  /// 1ファイルの上限。効果音なので数百KBが普通。
  static const int maxFileBytes = 5 * 1024 * 1024;

  /// sounds/ 全体の上限。
  static const int maxTotalBytes = 200 * 1024 * 1024;

  /// 検索HTMLの読み込み上限。
  static const int maxHtmlBytes = 3 * 1024 * 1024;

  /// 1回の検索で持ち帰る件数の上限。
  ///
  /// 配布元サイトの検索結果1ページは myinstants が36件、効果音ラボが30件。
  /// 1ページ分を丸ごと収められる値にしておかないと、末尾の数件が黙って落ちて
  /// 「サイトには有るのにアプリに出てこない」状態になる。
  static const int maxSearchResults = 60;

  /// MyInstants が受け付ける最小キーワード長（文字数）。
  ///
  /// サイト側の検索は2文字以下だと必ず404(0件)を返す。`fart` が36件出るのに
  /// `fa` では0件なので部分一致の問題ではなく純粋な文字数制限で、
  /// [searchMyInstants] は0件時の404を空扱いにする都合上、そのまま投げると
  /// 「見つかりませんでした」と区別が付かない。通信する前にここで弾く。
  static const int myInstantsMinQueryLength = 3;

  static const int maxRedirects = 5;

  static const String soundEffectLabHost = 'soundeffect-lab.info';
  static const String myInstantsHost = 'www.myinstants.com';

  static final RegExp _soundEffectLabItem =
      RegExp(r'<li><span>([^<]*)</span>[^<]*<a href="([^"]+\.mp3)"[^>]*download=');
  static final RegExp _myInstantsItem = RegExp(
      r'''<button class="small-button" onclick="play\('([^']+)'[^)]*\)"[^>]*title="Play ([\s\S]*?) sound"''');

  Directory? _cachedDir;

  Future<Directory> soundsDirectory() async {
    if (_cachedDir != null) return _cachedDir!;
    final base = overrideDirectory ?? await getApplicationSupportDirectory();
    final dir = Directory('${base.path}${Platform.pathSeparator}sounds');
    if (!await dir.exists()) await dir.create(recursive: true);
    _cachedDir = dir;
    return dir;
  }

  /// ファイル名から実ファイルパスを引く。存在しなければ null。
  /// [SoundEngine] の resolvePath に渡す。
  ///
  /// [fileName] は basename でなければならない。設定は端末内に保存された JSON なので
  /// 通常は安全だが、壊れた設定やテスト発火コマンド経由で `../` が入りうるため、
  /// ここでも `sounds/` の外へ出ないことを確認する。
  String? resolvePathSync(String fileName, Directory soundsDir) {
    if (!isSafeFileName(fileName)) return null;
    final file = File('${soundsDir.path}${Platform.pathSeparator}$fileName');
    return file.existsSync() ? file.path : null;
  }

  /// `sounds/` 直下の単純なファイル名かどうか。
  static bool isSafeFileName(String fileName) {
    if (fileName.isEmpty || fileName.length > 200) return false;
    if (fileName.contains('/') || fileName.contains(r'\')) return false;
    if (fileName == '.' || fileName == '..') return false;
    return true;
  }

  Future<int> totalBytes() async {
    final dir = await soundsDirectory();
    var total = 0;
    await for (final entity in dir.list()) {
      if (entity is File) {
        total += await entity.length();
      }
    }
    return total;
  }

  // ── 取り込み ────────────────────────────────────────────────────────────────

  /// 端末内のファイルを取り込む。呼び出し側が file_picker などでパスを取得する。
  Future<ImportedSound> importLocalFile({
    required String sourcePath,
    required String displayName,
  }) async {
    final source = File(sourcePath);
    if (!await source.exists()) {
      throw SoundLibraryException('ファイルが見つかりませんでした。');
    }
    final length = await source.length();
    _ensureFileSize(length);
    await _ensureTotalCapacity(length);

    final id = _newId();
    final extension = _extensionOf(sourcePath, fallback: '.mp3');
    return _commit(
      id: id,
      extension: extension,
      displayName: displayName,
      source: SoundSourceKind.local,
      sourceUrl: null,
      write: (tempFile) => source.copy(tempFile.path),
    );
  }

  /// 配布元サイトのページ URL。[query] が空ならトップ、あればサイト内検索の結果ページ。
  ///
  /// アプリ内の検索は検索結果 HTML から拾えた分しか出せない(カテゴリ一覧・試聴・
  /// 利用規約はサイト側にしか無い)ので、検索画面からブラウザで開く導線に使う。
  /// 検索リクエスト側の URL もここへ寄せて、両者が別のページを指す状態を作らない。
  static Uri sitePageUri(SoundSourceKind source, {String query = ''}) {
    final trimmed = query.trim();
    return switch (source) {
      SoundSourceKind.soundEffectLab => trimmed.isEmpty
          ? Uri.https(soundEffectLabHost, '/')
          : Uri.https(soundEffectLabHost, '/sound/search.php', {'s': trimmed}),
      SoundSourceKind.myInstants => trimmed.isEmpty
          ? Uri.https(myInstantsHost, '/')
          : Uri.https(myInstantsHost, '/en/search/', {'name': trimmed}),
      SoundSourceKind.local =>
        throw ArgumentError.value(source, 'source', '端末内の音源に配布元サイトは無い'),
    };
  }

  Future<List<RemoteSound>> searchSoundEffectLab(String query) {
    final trimmed = query.trim();
    if (trimmed.isEmpty) return Future.value(const []);
    final uri = sitePageUri(SoundSourceKind.soundEffectLab, query: trimmed);
    return _search(
      uri: uri,
      headers: const {
        'User-Agent': 'Mozilla/5.0 (LiveSidestage)',
        'Referer': 'https://$soundEffectLabHost/',
      },
      pattern: _soundEffectLabItem,
      nameGroup: 1,
      urlGroup: 2,
      baseOrigin: 'https://$soundEffectLabHost',
      label: '効果音ラボ',
    );
  }

  Future<List<RemoteSound>> searchMyInstants(String query) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) return const [];
    // 絵文字などのサロゲートペアを2文字と数えないよう runes で見る。
    // サイト側の判定もコードポイント数。
    if (trimmed.runes.length < myInstantsMinQueryLength) {
      throw SoundLibraryException(
        'MyInstants は $myInstantsMinQueryLength 文字以上のキーワードでないと検索できません。'
        'サイト側の仕様で、短いキーワードは常に0件になります。',
      );
    }
    final uri = sitePageUri(SoundSourceKind.myInstants, query: trimmed);
    return _search(
      uri: uri,
      headers: const {'User-Agent': 'Mozilla/5.0 (LiveSidestage)'},
      pattern: _myInstantsItem,
      nameGroup: 2,
      urlGroup: 1,
      baseOrigin: 'https://$myInstantsHost',
      label: 'MyInstants',
      // 検索結果0件のとき200ではなく404を返す仕様。
      treat404AsEmpty: true,
    );
  }

  Future<ImportedSound> downloadRemote({
    required RemoteSound sound,
    required SoundSourceKind source,
  }) async {
    final fetched = await _fetchRemote(sound: sound, source: source);
    await _ensureTotalCapacity(fetched.bytes.length);

    return _commit(
      id: _newId(),
      extension: _extensionOf(fetched.uri.path, fallback: '.mp3'),
      displayName: sound.name,
      source: source,
      sourceUrl: fetched.uri.toString(),
      write: (tempFile) => tempFile.writeAsBytes(fetched.bytes, flush: true),
    );
  }

  /// 取り込む前に鳴らして確かめるための取得。**ここではファイルに書かない。**
  ///
  /// 一時ファイルにすると「どの要求が作ったファイルを、いつ誰が消すか」を要求ごとに
  /// 追う必要があり、連打・画面破棄と絡んで残骸や取り違えの原因になる。採用前の音は
  /// 端末に残す理由が無いので、バイト列のまま [SoundPreview] へ渡して鳴らす。
  ///
  /// **iOS だけは例外で、鳴らす直前に一時ファイルへ書く。** audioplayers の darwin 実装が
  /// `setSourceBytes` を未実装として弾くため、バイト列のままでは鳴らせない。ただし
  /// 書くのは `AudioPlayerPreview`（プレイヤーの所有者）であって、ここではない —
  /// ファイルの寿命をプレイヤーの寿命に一致させることで、上の懸念を避けている。
  /// `sounds/` の総容量（[maxTotalBytes]）にも数えない — ディスクを使わないため。
  /// 1件あたりの上限（[maxFileBytes]）は取り込みと同じく効く。
  Future<Uint8List> fetchPreviewBytes({
    required RemoteSound sound,
    required SoundSourceKind source,
  }) async {
    final fetched = await _fetchRemote(sound: sound, source: source);
    return fetched.bytes;
  }

  /// 音源ファイルを削除する。設定から参照を外したあとに呼ぶこと。
  Future<void> deleteFile(String fileName) async {
    if (!isSafeFileName(fileName)) return;
    final dir = await soundsDirectory();
    final file = File('${dir.path}${Platform.pathSeparator}$fileName');
    if (await file.exists()) await file.delete();
  }

  /// 取り込み済みの音源ファイルを全て削除する。アカウント削除時の後始末専用
  /// ([pruneOrphans]と違い、設定の内容に関わらず無条件で消す) — 同一端末で
  /// 別アカウントへログインしたとき、前アカウントの効果音を引き継がないため。
  Future<void> deleteAll() async {
    final dir = await soundsDirectory();
    await for (final entity in dir.list()) {
      if (entity is File) await entity.delete();
    }
  }

  /// 設定から参照されていない実ファイルを掃除する。
  ///
  /// **設定が正しく読めたときにだけ呼ぶこと。** 壊れたJSONや未対応の未来バージョンで
  /// 既定値へフォールバックした状態で呼ぶと、ユーザーの音源を全部消してしまう。
  ///
  /// [minAge] より新しいファイルは残す。編集画面は「ファイルを保存 → 設定を保存」の
  /// 順で動くので、その間にサービスが起動すると取り込み直後のファイルが
  /// まだどこからも参照されていない。時間で猶予を置いて取り違えを防ぐ。
  Future<int> pruneOrphans(
    Iterable<String> keepFileNames, {
    Duration minAge = const Duration(minutes: 10),
  }) async {
    final dir = await soundsDirectory();
    final keep = keepFileNames.toSet();
    final threshold = DateTime.now().subtract(minAge);
    var removed = 0;
    await for (final entity in dir.list()) {
      if (entity is! File) continue;
      final name = entity.uri.pathSegments.last;
      // 取り込み途中で落ちた一時ファイルもここで回収する。
      if (keep.contains(name) && !name.endsWith('.part')) continue;
      final stat = await entity.stat();
      if (stat.modified.isAfter(threshold)) continue;
      await entity.delete();
      removed++;
    }
    return removed;
  }

  void dispose() => _client.close();

  // ── 内部 ────────────────────────────────────────────────────────────────────

  /// 配布元から音源を取ってくる。**取り込みも試聴もここだけを通す。**
  ///
  /// host 固定・Referer・サイズ上限・リダイレクト各段の検証を2箇所に書くと、
  /// 片方だけ条件が緩んでも気づけない。
  ///
  /// 返す [Uri] は検証済みの取得元（リダイレクト前）。拡張子と `sourceUrl` に使う。
  Future<({Uri uri, Uint8List bytes})> _fetchRemote({
    required RemoteSound sound,
    required SoundSourceKind source,
  }) async {
    // 三項演算子で2択にすると local が MyInstants 扱いになる。網羅的に分ける。
    final allowedHost = switch (source) {
      SoundSourceKind.soundEffectLab => soundEffectLabHost,
      SoundSourceKind.myInstants => myInstantsHost,
      SoundSourceKind.local => throw SoundLibraryException('この音源はダウンロードできません。'),
    };
    final uri = _parseAndVerify(sound.mp3Url, allowedHost);

    final bytes = await _getBytes(uri, allowedHost: allowedHost, maxBytes: maxFileBytes, headers: {
      'User-Agent': 'Mozilla/5.0 (LiveSidestage)',
      if (source == SoundSourceKind.soundEffectLab) 'Referer': 'https://$soundEffectLabHost/',
    });
    _ensureFileSize(bytes.length);

    return (uri: uri, bytes: bytes);
  }

  /// 一時ファイルへ書いてから rename する。途中で失敗しても壊れたファイルが
  /// 音源として設定に残らない。
  Future<ImportedSound> _commit({
    required String id,
    required String extension,
    required String displayName,
    required SoundSourceKind source,
    required String? sourceUrl,
    required Future<void> Function(File tempFile) write,
  }) async {
    final dir = await soundsDirectory();
    final fileName = '$id$extension';
    final tempFile = File('${dir.path}${Platform.pathSeparator}$fileName.part');
    final finalFile = File('${dir.path}${Platform.pathSeparator}$fileName');

    try {
      await write(tempFile);
      final length = await tempFile.length();
      if (length == 0) throw SoundLibraryException('音声ファイルが空でした。');
      _ensureFileSize(length);
      await tempFile.rename(finalFile.path);
    } catch (e) {
      if (await tempFile.exists()) {
        await tempFile.delete().catchError((_) => tempFile);
      }
      if (e is SoundLibraryException) rethrow;
      throw SoundLibraryException('音源の保存に失敗しました: $e');
    }

    return ImportedSound(
      fileName: fileName,
      soundName: displayName.isEmpty ? fileName : displayName,
      source: source,
      sourceUrl: sourceUrl,
    );
  }

  Future<List<RemoteSound>> _search({
    required Uri uri,
    required Map<String, String> headers,
    required RegExp pattern,
    required int nameGroup,
    required int urlGroup,
    required String baseOrigin,
    required String label,
    bool treat404AsEmpty = false,
  }) async {
    final http.Response response;
    try {
      response = await _client.get(uri, headers: headers).timeout(requestTimeout);
    } catch (e) {
      throw SoundLibraryException('$label の検索に失敗しました。通信環境を確認してください。');
    }

    if (treat404AsEmpty && response.statusCode == 404) return const [];
    if (response.statusCode >= 400) {
      throw SoundLibraryException('$label の検索に失敗しました (HTTP ${response.statusCode})');
    }
    if (response.bodyBytes.length > maxHtmlBytes) {
      throw SoundLibraryException('$label の応答が大きすぎます。');
    }

    final results = <RemoteSound>[];
    for (final match in pattern.allMatches(response.body)) {
      if (results.length >= maxSearchResults) break;
      final rawUrl = match.group(urlGroup);
      final rawName = match.group(nameGroup);
      if (rawUrl == null || rawName == null) continue;
      final url = rawUrl.startsWith('http') ? rawUrl : '$baseOrigin$rawUrl';
      results.add(RemoteSound(name: _decodeEntities(rawName), mp3Url: url));
    }
    return results;
  }

  /// リダイレクトを自前で追い、**各段で** scheme と host を検証する。
  /// 初回だけ検証しても、途中で別ホストへ飛ばされたら意味がない。
  Future<Uint8List> _getBytes(
    Uri uri, {
    required String allowedHost,
    required int maxBytes,
    required Map<String, String> headers,
  }) async {
    var current = uri;

    for (var hop = 0; hop <= maxRedirects; hop++) {
      _parseAndVerify(current.toString(), allowedHost);

      final request = http.Request('GET', current)
        ..followRedirects = false
        ..headers.addAll(headers);

      final http.StreamedResponse response;
      try {
        response = await _client.send(request).timeout(requestTimeout);
      } catch (e) {
        throw SoundLibraryException('音声のダウンロードに失敗しました。通信環境を確認してください。');
      }

      if (response.isRedirect || (response.statusCode >= 300 && response.statusCode < 400)) {
        final location = response.headers['location'];
        await _discardBody(response);
        if (location == null) throw SoundLibraryException('リダイレクト先が不正です。');
        current = current.resolve(location);
        continue;
      }

      if (response.statusCode >= 400) {
        await _discardBody(response);
        throw SoundLibraryException('音声のダウンロードに失敗しました (HTTP ${response.statusCode})');
      }

      // Content-Length と実受信バイト数の両方を見る。
      // chunked では Content-Length が無いので、読みながら打ち切る必要がある。
      final declared = response.contentLength;
      if (declared != null && declared > maxBytes) {
        await _discardBody(response);
        throw SoundLibraryException('音声ファイルが大きすぎます（上限 ${maxBytes ~/ (1024 * 1024)}MB）。');
      }

      final builder = BytesBuilder(copy: false);
      await for (final chunk in response.stream.timeout(requestTimeout)) {
        builder.add(chunk);
        if (builder.length > maxBytes) {
          throw SoundLibraryException('音声ファイルが大きすぎます（上限 ${maxBytes ~/ (1024 * 1024)}MB）。');
        }
      }
      return builder.takeBytes();
    }

    throw SoundLibraryException('リダイレクトが多すぎます。');
  }

  /// 使わない body を捨てる。**待ち切らない** — 相手がいつまでも閉じない場合に、
  /// リダイレクトやエラー応答の後始末で処理全体が止まってしまう。
  Future<void> _discardBody(http.StreamedResponse response) async {
    try {
      await response.stream.drain<void>().timeout(requestTimeout);
    } catch (_) {
      // 捨てるだけなので失敗しても構わない。
    }
  }

  Uri _parseAndVerify(String raw, String allowedHost) {
    final Uri uri;
    try {
      uri = Uri.parse(raw);
    } catch (_) {
      throw SoundLibraryException('無効なURLです。');
    }
    if (uri.scheme != 'https' || uri.host != allowedHost) {
      throw SoundLibraryException('$allowedHost のURLのみ取り込めます。');
    }
    return uri;
  }

  void _ensureFileSize(int length) {
    if (length > maxFileBytes) {
      throw SoundLibraryException('音声ファイルが大きすぎます（上限 ${maxFileBytes ~/ (1024 * 1024)}MB）。');
    }
  }

  Future<void> _ensureTotalCapacity(int incoming) async {
    final total = await totalBytes();
    if (total + incoming > maxTotalBytes) {
      throw SoundLibraryException(
        '音源の合計サイズが上限（${maxTotalBytes ~/ (1024 * 1024)}MB）を超えます。不要な音源を削除してください。',
      );
    }
  }

  String _newId() => 'snd_${DateTime.now().microsecondsSinceEpoch}';

  /// 試聴（取り込まずに鳴らす側）が使う拡張子。
  ///
  /// iOS は一時ファイルへ書いてから鳴らすが、AVURLAsset は**拡張子から形式を推測する**ため
  /// ここを間違えると鳴らない。[downloadRemote] と同じ導出を使うこと — 取り込み後の再生と
  /// 判定を揃えておけば、「試聴では鳴ったのに取り込んだら鳴らない」がそもそも起きない。
  static String previewExtensionOf(String url) =>
      _extensionOf(Uri.tryParse(url)?.path ?? url, fallback: '.mp3');

  static String _extensionOf(String path, {required String fallback}) {
    final dot = path.lastIndexOf('.');
    if (dot < 0) return fallback;
    final ext = path.substring(dot).toLowerCase();
    const allowed = {'.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'};
    return allowed.contains(ext) ? ext : fallback;
  }

  static String _decodeEntities(String value) => value
      .replaceAll('&#39;', "'")
      .replaceAll('&quot;', '"')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
}
