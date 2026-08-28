import 'package:flutter/material.dart';

/// 貢献/ギフト履歴タブで使う円形のユーザーアイコン。
/// `GiftThumbnail`(gift_sound_edit_screen.dart)と同じ描画パターンの円形版。
class UserAvatar extends StatelessWidget {
  const UserAvatar(this.imageUrl, {super.key, this.size = 36});

  final String? imageUrl;
  final double size;

  @override
  Widget build(BuildContext context) {
    final url = imageUrl;
    final placeholder = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: Theme.of(context).disabledColor.withValues(alpha: 0.15),
        shape: BoxShape.circle,
      ),
      child: Icon(Icons.person, size: size * 0.6, color: Theme.of(context).disabledColor),
    );

    if (url == null) return placeholder;

    return ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: Image.network(
          url,
          fit: BoxFit.cover,
          cacheWidth: (size * MediaQuery.of(context).devicePixelRatio).round(),
          errorBuilder: (_, _, _) => placeholder,
          frameBuilder: (_, child, frame, wasSynchronouslyLoaded) =>
              wasSynchronouslyLoaded || frame != null ? child : placeholder,
        ),
      ),
    );
  }
}
