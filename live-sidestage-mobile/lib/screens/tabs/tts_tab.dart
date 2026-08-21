import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_config_store.dart';
import '../../models/comment.dart';
import '../home_screen.dart' show SpeechState;

/// 受信コメントの一覧と読み上げ状態。
class TtsTab extends StatelessWidget {
  const TtsTab({
    super.key,
    required this.comments,
    required this.scrollController,
    required this.speech,
    required this.serviceRunning,
    required this.roomSwitching,
    required this.switchingToTiktokId,
  });

  final List<Comment> comments;
  final ScrollController scrollController;
  final SpeechState speech;
  final bool serviceRunning;
  final bool roomSwitching;
  final String? switchingToTiktokId;

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppConfigStore>();
    final ttsEnabled = store.config.ttsEnabled;
    final ttsVolume = store.config.ttsVolume;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
          child: Row(
            children: [
              const Text('読み上げ', style: TextStyle(fontSize: 13)),
              Switch(
                value: ttsEnabled,
                onChanged: (value) => store.setTtsEnabled(value),
              ),
              const SizedBox(width: 8),
              const Text('ランダムボイス', style: TextStyle(fontSize: 13)),
              Switch(
                value: store.config.randomVoice,
                onChanged: ttsEnabled ? (value) => store.setRandomVoice(value) : null,
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: Row(
            children: [
              const Text('音量', style: TextStyle(fontSize: 13)),
              Expanded(
                child: Slider(
                  value: ttsVolume.toDouble(),
                  max: 100,
                  divisions: 20,
                  label: '$ttsVolume',
                  onChanged: ttsEnabled ? (value) => store.setTtsVolume(value.round()) : null,
                ),
              ),
              SizedBox(
                width: 32,
                child: Text(
                  '$ttsVolume',
                  textAlign: TextAlign.right,
                  style: TextStyle(
                    fontSize: 13,
                    color: ttsEnabled ? null : Theme.of(context).disabledColor,
                  ),
                ),
              ),
            ],
          ),
        ),
        if (serviceRunning && ttsEnabled)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                if (!speech.initialized && speech.errorMessage == null)
                  const Text('VOICEVOX準備中…', style: TextStyle(fontSize: 12, color: Colors.grey)),
                if (speech.nowSpeakingCharacterName != null)
                  Text(
                    'VOICEVOX:${speech.nowSpeakingCharacterName}',
                    style: const TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                if (speech.errorMessage != null)
                  Expanded(
                    child: Text(
                      speech.errorMessage!,
                      style: const TextStyle(fontSize: 11, color: Colors.red),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
            ),
          ),
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
