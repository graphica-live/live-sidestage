/// コイン数を`🪙3,613`のようにカンマ区切りで表示するための共通フォーマッタ。
/// 貢献タブ・バトル履歴タブの`RankingListTile`が使う。
String formatDiamonds(int value) {
  final digits = value.toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write(',');
    buffer.write(digits[i]);
  }
  return '🪙${buffer.toString()}';
}
