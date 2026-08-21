import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_config_store.dart';
import '../../models/app_config.dart';
import '../home_screen.dart' show SoundState;
import '../sound_library_screen.dart';
import '../sound_trigger_edit_screen.dart';

/// カテゴリごとにトリガーをまとめて表示する。カテゴリのスイッチは
/// 配下のトリガーをまとめて止めるだけで、個々のトリガーの enabled には干渉しない。
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
            subtitle: sound.lastTriggerName != null
                ? Text('直近: ${sound.lastTriggerName}', style: const TextStyle(fontSize: 12))
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
              onChanged: (value) =>
                  store.updateSound((c) => c.copyWith(masterVolume: value.round())),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.library_music_outlined),
            title: const Text('音源ライブラリ'),
            subtitle: Text('${config.assets.length}件'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const SoundLibraryScreen()),
            ),
          ),
          if (sound.errorMessage != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(
                sound.errorMessage!,
                style: const TextStyle(color: Colors.red, fontSize: 12),
              ),
            ),
          const Divider(),
          if (config.categories.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text(
                'カテゴリを追加すると、トリガーをまとめてON/OFFできます',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey),
              ),
            ),
          for (final category in config.categories)
            _CategorySection(category: category, config: config),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showAddMenu(context, store, config),
        icon: const Icon(Icons.add),
        label: const Text('追加'),
      ),
    );
  }

  void _showAddMenu(BuildContext context, AppConfigStore store, SoundConfig config) {
    showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.folder_outlined),
              title: const Text('カテゴリを追加'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _promptCategoryName(context, store);
              },
            ),
            ListTile(
              leading: const Icon(Icons.bolt_outlined),
              title: const Text('トリガーを追加'),
              enabled: config.categories.isNotEmpty,
              subtitle: config.categories.isEmpty
                  ? const Text('先にカテゴリを追加してください')
                  : null,
              onTap: config.categories.isEmpty
                  ? null
                  : () {
                      Navigator.of(sheetContext).pop();
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => SoundTriggerEditScreen(
                            initialCategoryId: config.categories.first.id,
                          ),
                        ),
                      );
                    },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _promptCategoryName(BuildContext context, AppConfigStore store) async {
    final name = await _promptText(context, title: 'カテゴリを追加', label: 'カテゴリ名');
    if (name == null || name.isEmpty) return;
    await store.updateSound((c) => c.copyWith(
          categories: [
            ...c.categories,
            SoundCategory(id: 'cat_${DateTime.now().microsecondsSinceEpoch}', name: name),
          ],
        ));
  }
}

class _CategorySection extends StatelessWidget {
  const _CategorySection({required this.category, required this.config});

  final SoundCategory category;
  final SoundConfig config;

  @override
  Widget build(BuildContext context) {
    final store = context.read<AppConfigStore>();
    final triggers = config.triggers.where((t) => t.categoryId == category.id).toList();

    return ExpansionTile(
      initiallyExpanded: true,
      title: Text(category.name),
      subtitle: Text('${triggers.length}件のトリガー', style: const TextStyle(fontSize: 12)),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Switch(
            value: category.enabled,
            onChanged: (value) => store.updateSound((c) => c.copyWith(
                  categories: [
                    for (final cat in c.categories)
                      cat.id == category.id ? cat.copyWith(enabled: value) : cat,
                  ],
                )),
          ),
          PopupMenuButton<String>(
            onSelected: (action) async {
              if (action == 'rename') {
                final name = await _promptText(context, title: 'カテゴリ名を変更', label: 'カテゴリ名', initial: category.name);
                if (name == null || name.isEmpty) return;
                await store.updateSound((c) => c.copyWith(
                      categories: [
                        for (final cat in c.categories)
                          cat.id == category.id ? cat.copyWith(name: name) : cat,
                      ],
                    ));
              } else if (action == 'delete') {
                // カテゴリを消すと配下のトリガーも消える。音源ライブラリは残す。
                await store.updateSound((c) => c.copyWith(
                      categories: c.categories.where((cat) => cat.id != category.id).toList(),
                      triggers: c.triggers.where((t) => t.categoryId != category.id).toList(),
                    ));
              }
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'rename', child: Text('名前を変更')),
              PopupMenuItem(value: 'delete', child: Text('削除')),
            ],
          ),
        ],
      ),
      children: [
        if (triggers.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Text('トリガーがありません', style: TextStyle(color: Colors.grey, fontSize: 13)),
          ),
        for (final trigger in triggers)
          ListTile(
            dense: true,
            title: Text(trigger.name.isEmpty ? '（無題）' : trigger.name),
            subtitle: Text(_summarize(trigger, config), style: const TextStyle(fontSize: 12)),
            trailing: Switch(
              value: trigger.enabled,
              onChanged: (value) => store.updateSound((c) => c.copyWith(
                    triggers: [
                      for (final t in c.triggers)
                        t.id == trigger.id ? t.copyWith(enabled: value) : t,
                    ],
                  )),
            ),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => SoundTriggerEditScreen(triggerId: trigger.id),
              ),
            ),
          ),
      ],
    );
  }

  String _summarize(SoundTrigger trigger, SoundConfig config) {
    final parts = <String>[];
    switch (trigger.eventType) {
      case SoundEventType.gift:
        parts.add(trigger.giftName.isEmpty ? 'ギフト: すべて' : 'ギフト: ${trigger.giftName}');
        if (trigger.minCoins > 0) parts.add('${trigger.minCoins}コイン以上');
        if (!trigger.treatGiftComboAsSingle) parts.add('まとめ投げは分割');
      case SoundEventType.comment:
        parts.add(trigger.commentMode == SoundCommentMode.exact
            ? 'コメント: 「${trigger.commentText}」と一致'
            : 'コメント: すべて');
      case SoundEventType.follow:
        parts.add('フォロー');
    }
    if (trigger.userIds.isNotEmpty) parts.add('${trigger.userIds.length}人限定');

    final missing = trigger.soundIds.where((id) => !config.assets.any((a) => a.id == id)).length;
    parts.add('音源${trigger.soundIds.length}件${missing > 0 ? '（$missing件が見つかりません）' : ''}');
    return parts.join(' / ');
  }
}

Future<String?> _promptText(
  BuildContext context, {
  required String title,
  required String label,
  String initial = '',
}) {
  final controller = TextEditingController(text: initial);
  return showDialog<String>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        autofocus: true,
        decoration: InputDecoration(labelText: label),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(),
          child: const Text('キャンセル'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(controller.text.trim()),
          child: const Text('保存'),
        ),
      ],
    ),
  );
}
