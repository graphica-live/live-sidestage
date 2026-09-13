import 'package:flutter/material.dart';

/// ギフトのアイコン。
///
/// 一覧は最大1000件あるが `ListView.builder` は可視行しか組み立てないので、同時に走る
/// 取得は画面に見えている数行分だけで済む。`cacheWidth` を実表示幅に合わせてデコードを
/// 縮め、Flutter 既定の `ImageCache` に収まるようにしている（追加パッケージは要らない）。
///
/// URL が無い・読み込み中・失敗のいずれも同じプレースホルダに落とす。ここで空白を返すと
/// スクロール中に行の見た目が点滅する。
class GiftThumbnail extends StatelessWidget {
  const GiftThumbnail(this.imageUrl, {super.key, this.size = defaultSize});

  final String? imageUrl;

  /// 効果音ピッカーの行頭と同じ既定サイズ。
  static const double defaultSize = 36;

  final double size;

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    final placeholder = Icon(
      Icons.card_giftcard,
      size: size * 20 / defaultSize,
      color: Theme.of(context).disabledColor,
    );

    return SizedBox(
      width: size,
      height: size,
      child: url == null
          ? placeholder
          : Image.network(
              url,
              // ギフトの絵は正方形とは限らない。引き伸ばさず収める。
              fit: BoxFit.contain,
              cacheWidth: (size * MediaQuery.of(context).devicePixelRatio)
                  .round(),
              errorBuilder: (_, _, _) => placeholder,
              frameBuilder: (_, child, frame, wasSynchronouslyLoaded) =>
                  wasSynchronouslyLoaded || frame != null ? child : placeholder,
            ),
    );
  }
}
