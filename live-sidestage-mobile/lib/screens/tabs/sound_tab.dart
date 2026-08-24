import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_config_store.dart';
import '../../core/gift_name_ja.dart';
import '../../models/app_config.dart';
import '../gift_sound_edit_screen.dart';
import '../home_screen.dart' show SoundState;

/// 「ギフト → 音」の一覧。カテゴリ・トリガー・音源ライブラリという中間概念は無い。
class SoundTab extends StatelessWidget {
  const SoundTab({super.key, required this.sound});

  final SoundState sound;

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppConfigStore>();
    final config = store.sound;

    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.only(bottom: 96),
        children: [
          SwitchListTile(
            title: const Text('効果音を鳴らす'),
            subtitle: sound.lastGiftName != null
                // 受信した英語名がそのまま入っている。一覧のタイトルと表記が
                // 揃っていないと同じギフトだと分からないので、ここも辞書を通す。
                ? Text('直近: ${GiftNameJa.display(sound.lastGiftName!)}',
                    style: const TextStyle(fontSize: 12))
                : null,
            value: config.enabled,
            onChanged: (value) => store.updateSound((c) => c.copyWith(enabled: value)),
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
          if (sound.errorMessage != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(
                sound.errorMessage!,
                style: const TextStyle(color: Colors.red, fontSize: 12),
              ),
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
