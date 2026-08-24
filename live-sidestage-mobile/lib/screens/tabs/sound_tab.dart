import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_config_store.dart';
import '../../core/feature_status.dart';
import '../../core/gift_name_ja.dart';
import '../../models/app_config.dart';
import '../gift_sound_edit_screen.dart';
import '../home_screen.dart' show SoundState;
import '../widgets/feature_status_bar.dart';

/// 「ギフト → 音」の一覧。カテゴリ・トリガー・音源ライブラリという中間概念は無い。
class SoundTab extends StatelessWidget {
  const SoundTab({
    super.key,
    required this.sound,
    required this.status,
    required this.errors,
    required this.notice,
    required this.started,
    required this.busy,
    required this.onToggle,
  });

  final SoundState sound;
  final FeatureStatus status;
  final List<(String, String)> errors;

  /// TikTok 側の事情（レート制限・再接続待ちなど）。エラーではないので赤くしない。
  final String? notice;

  /// この機能が開始済みか（= 有効かつサービス稼働中）。
  final bool started;
  final bool busy;
  final ValueChanged<bool> onToggle;

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppConfigStore>();
    final config = store.sound;

    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.only(bottom: 96),
        children: [
          FeatureStatusBar(status: status, errors: errors, notice: notice),
          FeatureStartButton(started: started, busy: busy, onToggle: onToggle),
          if (sound.lastGiftName != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              // 受信した英語名がそのまま入っている。一覧のタイトルと表記が
              // 揃っていないと同じギフトだと分からないので、ここも辞書を通す。
              child: Text('直近: ${GiftNameJa.display(sound.lastGiftName!)}',
                  style: const TextStyle(fontSize: 12, color: Colors.grey)),
            ),
          ListTile(
            title: const Text('全体の音量'),
            subtitle: Slider(
              value: config.masterVolume.toDouble(),
              max: 100,
              divisions: 20,
              label: '${config.masterVolume}',
              // ドラッグ中は表示だけ動かし、指を離したときに保存する。
              // onChanged ごとに永続化すると、1回のドラッグで数十回の書き込みと
              // 背景 Isolate への送信が走る。
              onChanged: (_) {},
              onChangeEnd: (value) =>
                  store.updateSound((c) => c.copyWith(masterVolume: value.round())),
            ),
            trailing: Text('${config.masterVolume}'),
          ),
          if (sound.overflowCount > 0)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Text(
                '1回のギフトで鳴らせる上限を超えた回数: ${sound.overflowCount}',
                style: const TextStyle(color: Colors.orange, fontSize: 12),
              ),
            ),
          const Divider(),
          if (config.gifts.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Text(
                'まだ何も登録されていません。\n「追加」からギフトと音を選んでください。',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey),
              ),
            ),
          for (final gift in config.gifts) _GiftSoundTile(gift: gift),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (_) => const GiftSoundEditScreen()),
        ),
        icon: const Icon(Icons.add),
        label: const Text('追加'),
      ),
    );
  }
}

class _GiftSoundTile extends StatelessWidget {
  const _GiftSoundTile({required this.gift});

  final GiftSound gift;

  @override
  Widget build(BuildContext context) {
    final store = context.read<AppConfigStore>();

    return ListTile(
      leading: GiftThumbnail(gift.giftImageUrl),
      // 保存してあるのは TikTok の英語名。表示だけ辞書で日本語にするので、
      // あとから辞書が増えれば登録済みの設定にも効く。
      title: Text(GiftNameJa.display(gift.giftName, fallback: gift.displayGiftName)),
      subtitle: Text(
        gift.soundName.isEmpty ? gift.fileName : gift.soundName,
        style: const TextStyle(fontSize: 12),
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Switch(
        value: gift.enabled,
        onChanged: (value) => store.updateSound((c) => c.copyWith(
              gifts: [
                for (final g in c.gifts) g.id == gift.id ? g.copyWith(enabled: value) : g,
              ],
            )),
      ),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => GiftSoundEditScreen(giftSoundId: gift.id)),
      ),
    );
  }
}
