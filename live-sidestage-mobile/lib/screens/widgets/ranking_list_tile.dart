import 'package:flutter/material.dart';

import '../../models/gift_ranking_entry.dart';
import 'user_avatar.dart';

/// 貢献タブとバトル履歴タブの貢献者展開が共有する1行。
/// サーバー側で同じ形状(`GiftAnalyticsUser`)のデータを返すため両方から使う。
class RankingListTile extends StatelessWidget {
  const RankingListTile({super.key, required this.rank, required this.entry});

  final int rank;
  final GiftRankingEntry entry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final isTopThree = rank <= 3;

    final cardTheme = theme.cardTheme;
    final baseShape = cardTheme.shape as RoundedRectangleBorder?;
    final shape = isTopThree && baseShape != null
        ? baseShape.copyWith(side: BorderSide(color: colorScheme.primary, width: 1.5))
        : null;

    return Card(
      shape: shape,
      child: ListTile(
        contentPadding: isTopThree
            ? const EdgeInsets.symmetric(horizontal: 16, vertical: 4)
            : null,
        leading: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 24),
              child: Text(
                '$rank',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: isTopThree ? colorScheme.primary : null,
                ),
              ),
            ),
            const SizedBox(width: 8),
            UserAvatar(entry.profileImageUrl),
          ],
        ),
        title: Text(
          entry.nickname,
          style: isTopThree ? theme.textTheme.titleLarge : null,
        ),
        trailing: Text(
          '${entry.totalDiamonds}コイン',
          style: TextStyle(
            fontWeight: FontWeight.w600,
            fontSize: isTopThree ? 20 : 18,
          ),
        ),
      ),
    );
  }
}
