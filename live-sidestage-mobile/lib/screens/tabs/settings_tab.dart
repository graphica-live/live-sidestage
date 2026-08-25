import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_config_store.dart';
import '../../core/session_controller.dart';
import '../../models/auth_session.dart';
import '../../models/voice_catalog.dart';
import '../home_screen.dart' show SpeechState;

/// 設定の集約先。
///
/// **読み上げ・効果音の設定項目はすべてここに置く。** TTSタブとサウンドタブは
/// 配信中に見る運用画面なので、状態表示と開始/停止だけを持たせる。同じ設定を
/// 両方に出すと、どちらが効いているのか分からなくなる。
class SettingsTab extends StatelessWidget {
  const SettingsTab({
    super.key,
    required this.speech,
    required this.busy,
    required this.onChangeTiktokId,
    required this.onBeforeLogout,
  });

  final SpeechState speech;

  /// 開始/停止の遷移中。開始処理は「設定を保存 → サービス起動」の順に進むので、
  /// この間の変更は背景 Isolate へ渡らない。
  final bool busy;

  final Future<void> Function() onChangeTiktokId;
  final Future<void> Function() onBeforeLogout;

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppConfigStore>();
    final session = context.watch<SessionController>().session;

    // **どの設定も「開始しているか」では止めない。** `ttsEnabled` / `sound.enabled` は
    // 機能のON/OFF設定ではなく開始しているかの記録なので、それで無効化すると
    // 「一度開始しないと設定できない」画面になる。停止中の変更は永続化され、次の
    // onStart で背景 Isolate が読む。運用中の変更も applyConfig でそのまま届く。
    // 止めるのは開始/停止の遷移中だけ（保存とサービス起動の間に挟まると渡らない）。
    final canEdit = !busy;

    return ListView(
      children: [
        // 読み上げ・効果音の ON/OFF は各タブの「開始/停止」ボタンが持つ。
        // ここに同じトグルを置くと二重になり、どちらが接続を制御しているのか分からなくなる。
        const _SectionHeader('読み上げ'),
        SwitchListTile(
          title: const Text('ランダムボイス'),
          subtitle: const Text('コメント投稿者ごとに声を割り当てます'),
          value: store.config.randomVoice,
          onChanged: canEdit ? (value) => store.setRandomVoice(value) : null,
        ),
        _VoiceTile(
          styleId: store.config.fixedStyleId,
          randomVoice: store.config.randomVoice,
          enabled: canEdit,
          onSelected: store.setFixedStyleId,
        ),
        _VolumeSlider(
          title: '読み上げの音量',
          value: store.config.ttsVolume,
          enabled: canEdit,
          onChanged: store.setTtsVolume,
        ),
        const _SectionHeader('効果音'),
        // セットをまたいだ共通の音量。配信中に下げたくなるものなので運用中も触れる。
        _VolumeSlider(
          title: '全体の音量',
          value: store.sound.masterVolume,
          enabled: canEdit,
          onChanged: (value) =>
              store.updateSound((c) => c.copyWith(masterVolume: value)),
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
            // どちらでログインしたかは session が持っている。決め打ちにすると
            // Apple で入っている人に嘘を表示することになる。
            title: Text(
              session.provider == AuthProvider.apple ? 'Appleアカウント' : 'Googleアカウント',
            ),
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

/// ランダムボイスがOFFのときに読み上げるボイス。
///
/// 選択肢は同梱 vvm の静的な一覧（[VoiceCatalog]）から出す。VOICEVOX が返す実際の
/// 一覧は読み上げを開始しないと存在せず、停止中に開くのが普通のこの画面では使えない。
class _VoiceTile extends StatelessWidget {
  const _VoiceTile({
    required this.styleId,
    required this.randomVoice,
    required this.enabled,
    required this.onSelected,
  });

  final int styleId;
  final bool randomVoice;
  final bool enabled;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final label = VoiceCatalog.labelFor(styleId);
    final canPick = enabled && !randomVoice;

    return ListTile(
      title: const Text('ボイス'),
      // ランダム中でも選択済みのボイスは出す。理由だけに差し替えると、OFFにしたとき
      // 何の声になるのか確かめられない。
      subtitle: Text(
        randomVoice ? '$label ・ ランダムボイスをOFFにすると使えます' : label,
      ),
      trailing: const Icon(Icons.chevron_right),
      enabled: canPick,
      onTap: canPick ? () => _pick(context) : null,
    );
  }

  Future<void> _pick(BuildContext context) async {
    final picked = await showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _VoicePickerSheet(selected: styleId),
    );
    if (picked != null && picked != styleId) onSelected(picked);
  }
}

class _VoicePickerSheet extends StatelessWidget {
  const _VoicePickerSheet({required this.selected});

  final int selected;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ConstrainedBox(
        // 固定高にすると端末によっては画面からはみ出す。
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.85,
        ),
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Text(
                'ボイスを選ぶ',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
              ),
            ),
            for (final character in VoiceCatalog.characters) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Text(
                  character.name,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
              ),
              for (final style in character.styles)
                ListTile(
                  // スタイル名はキャラをまたいで重複する（「あまあま」など）。行の
                  // 同一性は styleId で持たせる。
                  key: ValueKey('voice-style-${style.styleId}'),
                  title: Text(style.styleName),
                  trailing:
                      style.styleId == selected ? const Icon(Icons.check) : null,
                  onTap: () => Navigator.of(context).pop(style.styleId),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

/// 0-100 の音量。
///
/// ドラッグ中は手元の値で追従させ、**指を離したときにだけ保存する**。
/// `onChanged` ごとに永続化すると、1回のドラッグで数十回の書き込みと背景 Isolate への
/// 送信が走る。逆に追従を省くと、`value` が設定値のままなのでつまみが指に付いてこない。
class _VolumeSlider extends StatefulWidget {
  const _VolumeSlider({
    required this.title,
    required this.value,
    required this.enabled,
    required this.onChanged,
  });

  final String title;
  final int value;
  final bool enabled;
  final ValueChanged<int> onChanged;

  @override
  State<_VolumeSlider> createState() => _VolumeSliderState();
}

class _VolumeSliderState extends State<_VolumeSlider> {
  /// ドラッグ中だけ持つ表示用の値。離したら null に戻して設定値へ従う。
  int? _dragging;

  @override
  Widget build(BuildContext context) {
    final value = _dragging ?? widget.value;

    return ListTile(
      title: Text(widget.title),
      subtitle: Slider(
        value: value.toDouble(),
        max: 100,
        divisions: 20,
        label: '$value',
        onChanged:
            widget.enabled ? (v) => setState(() => _dragging = v.round()) : null,
        onChangeEnd: (v) {
          setState(() => _dragging = null);
          widget.onChanged(v.round());
        },
      ),
      trailing: Text('$value'),
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
