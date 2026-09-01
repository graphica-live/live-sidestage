import 'package:flutter/material.dart';

import '../../core/tiktok_profile.dart';
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
    return Card(
      child: ListTile(
        leading: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ConstrainedBox(
              constraints: const BoxConstraints(minWidth: 24),
              child: Text(
                '$rank',
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
            const SizedBox(width: 8),
            UserAvatar(entry.profileImageUrl),
          ],
        ),
        title: Text(entry.nickname),
        trailing: Text(
          '${entry.totalDiamonds}コイン',
          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 18),
        ),
        onTap: () => openTiktokProfile(context, entry.uniqueId),
      ),
    );
  }
}
