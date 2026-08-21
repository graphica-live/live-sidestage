import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_config_store.dart';
import '../../core/session_controller.dart';
import '../home_screen.dart' show SpeechState;

class SettingsTab extends StatelessWidget {
  const SettingsTab({
    super.key,
    required this.speech,
    required this.onChangeTiktokId,
    required this.onBeforeLogout,
  });

  final SpeechState speech;
  final Future<void> Function() onChangeTiktokId;
  final Future<void> Function() onBeforeLogout;

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppConfigStore>();
    final session = context.watch<SessionController>().session;

    return ListView(
      children: [
        const _SectionHeader('読み上げ'),
        SwitchListTile(
          title: const Text('コメントを読み上げる'),
          subtitle: const Text('OFFにするとVOICEVOXの初期化も行いません'),
          value: store.config.ttsEnabled,
          onChanged: (value) => store.setTtsEnabled(value),
        ),
        SwitchListTile(
          title: const Text('ランダムボイス'),
          subtitle: const Text('コメント投稿者ごとに声を割り当てます'),
          value: store.config.randomVoice,
          onChanged: store.config.ttsEnabled ? (value) => store.setRandomVoice(value) : null,
        ),
        ListTile(
          title: Text('読み上げの音量  ${store.config.ttsVolume}'),
          subtitle: Slider(
            value: store.config.ttsVolume.toDouble(),
            max: 100,
            divisions: 20,
            label: '${store.config.ttsVolume}',
            onChanged: store.config.ttsEnabled ? (value) => store.setTtsVolume(value.round()) : null,
          ),
        ),
        const _SectionHeader('効果音'),
        SwitchListTile(
          title: const Text('効果音を鳴らす'),
          value: store.sound.enabled,
          onChanged: (value) => store.updateSound((c) => c.copyWith(enabled: value)),
        ),
        const _SectionHeader('アカウント'),
        ListTile(
          leading: const Icon(Icons.alternate_email),
          title: const Text('TikTok ID'),
          subtitle: Text('@${session?.streamer?.tiktokId ?? ''}'),
          trailing: const Icon(Icons.edit),
          onTap: onChangeTiktokId,
        ),
        if (session != null && session.userEmail.isNotEmpty)
          ListTile(
            leading: const Icon(Icons.account_circle_outlined),
            title: const Text('Googleアカウント'),
            subtitle: Text(session.userEmail),
          ),
        ListTile(
          leading: const Icon(Icons.logout, color: Colors.red),
          title: const Text('ログアウト', style: TextStyle(color: Colors.red)),
          onTap: () async {
            await onBeforeLogout();
            if (!context.mounted) return;
            await context.read<SessionController>().logout();
          },
        ),
        if (store.syncPending)
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text('設定を反映中…', style: TextStyle(fontSize: 12, color: Colors.grey)),
          ),
      ],
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.bold,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}
