import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:live_sidestage_mobile/core/sound_library.dart';

/// 配布元サイトの検索結果ページを読む部分。
///
/// サイトのHTMLは実物を写している（myinstants の1件は
/// `<button class="small-button" onclick="play('...')" title="Play NAME sound">`）。
/// サイト側が仕様を変えたらここが落ちる。
void main() {
  /// myinstants の検索結果1ページ分に相当するHTML。
  String myInstantsHtml(List<String> names) {
    final buffer = StringBuffer();
    for (var i = 0; i < names.length; i++) {
      final slug = 'sound-$i';
      buffer.writeln('<div class="instant">');
      buffer.writeln('<div class="circle small-button-background"></div>');
      buffer.writeln(
        '<button class="small-button" '
        'onclick="play(\'/media/sounds/$slug.mp3\', \'loader-$i\', \'$slug\')" '
        'title="Play ${names[i]} sound" type="button"></button>',
      );
      buffer.writeln('<a href="/en/instant/$slug/" class="instant-link">${names[i]}</a>');
      buffer.writeln('</div>');
    }
    return buffer.toString();
  }

  MockClient okClient(String body, {void Function(http.Request)? onRequest}) {
    return MockClient((request) async {
      onRequest?.call(request);
      return http.Response(
        body,
        200,
        headers: {'content-type': 'text/html; charset=utf-8'},
      );
    });
  }

  group('MyInstants の最小キーワード長', () {
    test('2文字以下は通信せずに理由を返す', () async {
      var requested = false;
      final library = SoundLibrary(
        client: MockClient((_) async {
          requested = true;
          return http.Response('', 200);
        }),
      );

      for (final query in ['F', 'FA', '  fa  ', 'あ']) {
        await expectLater(
          () => library.searchMyInstants(query),
          throwsA(isA<SoundLibraryException>()),
          reason: '「$query」はサイト側が常に0件を返す長さ',
        );
      }
      expect(requested, isFalse, reason: '0件と区別が付かないので投げる前に弾く');
    });

    test('サロゲートペアは1文字として数える', () async {
      final library = SoundLibrary(client: okClient(myInstantsHtml(const ['ok'])));

      // 絵文字1つ + 1文字 = 2文字。String.length では4になるが弾く。
      await expectLater(
        () => library.searchMyInstants('👍a'),
        throwsA(isA<SoundLibraryException>()),
      );
      // 絵文字1つ + 2文字 = 3文字。
      expect(await library.searchMyInstants('👍ab'), hasLength(1));
    });

    test('3文字あればサイト内検索の結果ページを叩く', () async {
      Uri? requestedUri;
      final library = SoundLibrary(
        client: okClient(
          myInstantsHtml(const ['Fart']),
          onRequest: (request) => requestedUri = request.url,
        ),
      );

      final results = await library.searchMyInstants('far');

      expect(requestedUri.toString(), 'https://www.myinstants.com/en/search/?name=far');
      expect(results.single.name, 'Fart');
      expect(results.single.mp3Url, 'https://www.myinstants.com/media/sounds/sound-0.mp3');
    });

    test('空のキーワードは検索そのものを行わない', () async {
      final library = SoundLibrary(
        client: MockClient((_) async => fail('通信してはいけない')),
      );
      expect(await library.searchMyInstants('   '), isEmpty);
    });
  });

  group('検索結果の取りこぼし', () {
    test('1ページ36件をすべて持ち帰る', () async {
      final names = List.generate(36, (i) => 'sound number $i');
      final library = SoundLibrary(client: okClient(myInstantsHtml(names)));

      final results = await library.searchMyInstants('boom');

      expect(results, hasLength(36), reason: 'myinstants の1ページは36件');
      expect(results.last.name, 'sound number 35');
    });

    test('上限を超えた分だけ捨てる', () async {
      final names = List.generate(80, (i) => 'sound $i');
      final library = SoundLibrary(client: okClient(myInstantsHtml(names)));

      final results = await library.searchMyInstants('boom');

      expect(results, hasLength(SoundLibrary.maxSearchResults));
    });
  });

  group('サイトの応答', () {
    test('0件のときの404は空の結果として扱う', () async {
      final library = SoundLibrary(
        client: MockClient((_) async => http.Response('Not Found', 404)),
      );
      expect(await library.searchMyInstants('zzzqqq'), isEmpty);
    });

    test('404以外のエラーは失敗として伝える', () async {
      final library = SoundLibrary(
        client: MockClient((_) async => http.Response('Server Error', 500)),
      );
      await expectLater(
        () => library.searchMyInstants('boom'),
        throwsA(isA<SoundLibraryException>()),
      );
    });

    test('日本語の音源名とHTMLエンティティを復元する', () async {
      final library = SoundLibrary(
        client: okClient(myInstantsHtml(const ['なるほど', 'it&#39;s a &quot;test&quot;'])),
      );

      final results = await library.searchMyInstants('なるほど');

      expect(results.map((r) => r.name), ['なるほど', 'it\'s a "test"']);
    });
  });

  group('効果音ラボ', () {
    test('1文字でも検索できる（文字数制限はMyInstants側の事情）', () async {
      Uri? requestedUri;
      final library = SoundLibrary(
        client: okClient(
          '<li><span>拍手</span> <a href="/common/se/clap.mp3" download="clap.mp3">',
          onRequest: (request) => requestedUri = request.url,
        ),
      );

      final results = await library.searchSoundEffectLab('F');

      expect(requestedUri.toString(), 'https://soundeffect-lab.info/sound/search.php?s=F');
      expect(results.single.name, '拍手');
      expect(results.single.mp3Url, 'https://soundeffect-lab.info/common/se/clap.mp3');
    });
  });
}
