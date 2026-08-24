import 'package:flutter_test/flutter_test.dart';
import 'package:live_sidestage_mobile/core/sound_library.dart';
import 'package:live_sidestage_mobile/models/app_config.dart';

/// 検索画面に出す「配布元サイトを開く」リンクの行き先。
///
/// アプリ内の検索が叩く URL と同じページを指していないと、
/// 「アプリでは0件なのにサイトには有る」ときの確認ができない。
void main() {
  test('キーワードがあればサイト内検索の結果ページを指す', () {
    expect(
      SoundLibrary.sitePageUri(SoundSourceKind.soundEffectLab, query: 'clap').toString(),
      'https://soundeffect-lab.info/sound/search.php?s=clap',
    );
    expect(
      SoundLibrary.sitePageUri(SoundSourceKind.myInstants, query: 'clap').toString(),
      'https://www.myinstants.com/en/search/?name=clap',
    );
  });

  test('日本語のキーワードはパーセントエンコードして渡す', () {
    expect(
      SoundLibrary.sitePageUri(SoundSourceKind.soundEffectLab, query: '拍手').toString(),
      'https://soundeffect-lab.info/sound/search.php?s=%E6%8B%8D%E6%89%8B',
    );
  });

  test('キーワードが空ならサイトのトップを指す', () {
    expect(
      SoundLibrary.sitePageUri(SoundSourceKind.soundEffectLab).toString(),
      'https://soundeffect-lab.info/',
    );
    expect(
      SoundLibrary.sitePageUri(SoundSourceKind.myInstants).toString(),
      'https://www.myinstants.com/',
    );
  });

  test('空白だけのキーワードは未入力と同じ扱いにする', () {
    expect(
      SoundLibrary.sitePageUri(SoundSourceKind.soundEffectLab, query: '   ').toString(),
      'https://soundeffect-lab.info/',
    );
  });

  test('前後の空白はキーワードに含めない', () {
    expect(
      SoundLibrary.sitePageUri(SoundSourceKind.myInstants, query: '  clap  ').toString(),
      'https://www.myinstants.com/en/search/?name=clap',
    );
  });

  test('端末内の音源にはサイトが無いので呼び出し自体を弾く', () {
    expect(
      () => SoundLibrary.sitePageUri(SoundSourceKind.local),
      throwsArgumentError,
    );
  });

  test('リンクのラベルに使うホストは検索リクエスト先と同じ', () {
    expect(
      SoundLibrary.sitePageUri(SoundSourceKind.soundEffectLab).host,
      SoundLibrary.soundEffectLabHost,
    );
    expect(
      SoundLibrary.sitePageUri(SoundSourceKind.myInstants).host,
      SoundLibrary.myInstantsHost,
    );
  });
}
