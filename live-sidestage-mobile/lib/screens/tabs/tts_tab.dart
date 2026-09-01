import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_config_store.dart';
import '../../core/feature_status.dart';
import '../../models/comment.dart';
import '../home_screen.dart' show SpeechState;
import '../widgets/feature_status_bar.dart';

/// 受信コメントの一覧と読み上げ状態。
class TtsTab extends StatelessWidget {
  const TtsTab({
    super.key,
    required this.comments,
    required this.scrollController,
    required this.speech,
    required this.status,
    required this.errors,
    required this.notice,
    required this.started,
    required this.busy,
    required this.onToggle,
    required this.roomSwitching,
    required this.switchingToTiktokId,
    required this.showFirstRunGuide,
    required this.onDismissFirstRunGuide,
  });

  final List<Comment> comments;
  final ScrollController scrollController;
  final SpeechState speech;
  final FeatureStatus status;
  final List<(String, String)> errors;

  /// TikTok 側の事情（レート制限・再接続待ちなど）。エラーではないので赤くしない。
  final String? notice;

  /// この機能が開始済みか（= 有効かつサービス稼働中）。
  final bool started;
  final bool busy;
  final ValueChanged<bool> onToggle;

  final bool roomSwitching;
  final String? switchingToTiktokId;

  /// オンボーディング後、初回だけ出す誘導バナーを見せるか。
  final bool showFirstRunGuide;
  final VoidCallback onDismissFirstRunGuide;

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppConfigStore>();

    return Column(
      children: [
        FeatureStatusBar(status: status, errors: errors, notice: notice),
        if (store.configFromFutureVersion) const ConfigTooNewBanner(),
        if (showFirstRunGuide)
          _FirstRunGuideBanner(onDismiss: onDismissFirstRunGuide),
        FeatureStartButton(
          started: started,
          busy: busy,
          blocked: store.configFromFutureVersion,
          onToggle: onToggle,
        ),
        if (started && !speech.initialized && speech.errorMessage == null)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text('VOICEVOX準備中…', style: TextStyle(fontSize: 12, color: Colors.grey)),
            ),
          ),
        if (started && speech.nowSpeakingCharacterName != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'VOICEVOX:${speech.nowSpeakingCharacterName}',
                style: const TextStyle(fontSize: 12, color: Colors.grey),
              ),
            ),
          ),
        // ランダムボイス・音量・ボイスの選択は設定タブにある。配信中に見る画面なので、
        // ここには状態と一覧だけを置く。
        Expanded(
          child: comments.isEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      roomSwitching
                          ? '@${switchingToTiktokId ?? ''} への切り替えをサーバーが反映中です\n（最大60秒。「開始」を押しておけば、反映され次第コメントが流れ始めます）'
                          : '「開始」を押すと、ここにコメントが表示されます\n（登録直後は反映まで最大60秒ほどかかります）',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.grey),
                    ),
                  ),
                )
              : ListView.builder(
                  controller: scrollController,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: comments.length,
                  itemBuilder: (context, index) {
                    final c = comments[index];
                    // Signal-Only Color Ruleの例外(DESIGN.md参照)。装飾ではなく
                    // 「今読み上げ中」という状態を伝えるための着色。
                    final isNowSpeaking =
                        speech.nowSpeakingCommentKey != null &&
                        c.identityKey == speech.nowSpeakingCommentKey;
                    return Card(
                      color: isNowSpeaking
                          ? Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.3)
                          : null,
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundImage:
                              c.profilePictureUrl != null ? NetworkImage(c.profilePictureUrl!) : null,
                          child: c.profilePictureUrl == null ? const Icon(Icons.person) : null,
                        ),
                        title: Text(c.nickname),
                        // c.comment ではなく displayText。エモートだけのコメントは
                        // 本文が空で届くので、生のまま出すと行が空白になる。
                        subtitle: Text(c.displayText),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

/// オンボーディング直後、何から始めればいいか分からず離脱するのを防ぐための
/// 一度きりの誘導。状態伝達ではないため、Signal-Only Color Ruleの色は使わない。
class _FirstRunGuideBanner extends StatelessWidget {
  const _FirstRunGuideBanner({required this.onDismiss});

  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: [
          const Icon(Icons.info_outline, size: 18, color: Colors.grey),
          const SizedBox(width: 8),
          const Expanded(
            child: Text(
              'まず設定タブでボイスを選びましょう',
              style: TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close, size: 18),
            tooltip: '閉じる',
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
            onPressed: onDismiss,
          ),
        ],
      ),
    );
  }
}
