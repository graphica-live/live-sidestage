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

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppConfigStore>();

    return Column(
      children: [
        FeatureStatusBar(status: status, errors: errors, notice: notice),
        if (store.configFromFutureVersion) const ConfigTooNewBanner(),
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
              : ListView.separated(
                  controller: scrollController,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  itemCount: comments.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, index) {
                    final c = comments[index];
                    return ListTile(
                      leading: CircleAvatar(
                        backgroundImage:
                            c.profilePictureUrl != null ? NetworkImage(c.profilePictureUrl!) : null,
                        child: c.profilePictureUrl == null ? const Icon(Icons.person) : null,
                      ),
                      title: Text(c.nickname),
                      subtitle: Text(c.comment),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
