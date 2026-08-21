import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:provider/provider.dart';

import '../core/app_config_store.dart';
import '../models/app_config.dart';

/// トリガーの新規作成 / 編集。
///
/// [triggerId] を渡すと編集、渡さないと [initialCategoryId] のカテゴリへ新規作成する。
class SoundTriggerEditScreen extends StatefulWidget {
  const SoundTriggerEditScreen({super.key, this.triggerId, this.initialCategoryId});

  final String? triggerId;
  final String? initialCategoryId;

  @override
  State<SoundTriggerEditScreen> createState() => _SoundTriggerEditScreenState();
}

class _SoundTriggerEditScreenState extends State<SoundTriggerEditScreen> {
  late SoundTrigger _draft;
  late final TextEditingController _nameController;
  late final TextEditingController _giftNameController;
  late final TextEditingController _minCoinsController;
  late final TextEditingController _commentTextController;
  bool _initialized = false;

  @override
  void initState() {
    super.initState();
    final config = context.read<AppConfigStore>().sound;
    final existing = widget.triggerId == null
        ? null
        : config.triggers.where((t) => t.id == widget.triggerId).firstOrNull;

    _draft = existing ??
        SoundTrigger(
          id: 'trg_${DateTime.now().microsecondsSinceEpoch}',
          name: '',
          categoryId: widget.initialCategoryId ??
              (config.categories.isNotEmpty ? config.categories.first.id : ''),
        );

    _nameController = TextEditingController(text: _draft.name);
    _giftNameController = TextEditingController(text: _draft.giftName);
    _minCoinsController = TextEditingController(text: '${_draft.minCoins}');
    _commentTextController = TextEditingController(text: _draft.commentText);
    _initialized = existing != null || widget.triggerId == null;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _giftNameController.dispose();
    _minCoinsController.dispose();
    _commentTextController.dispose();
    super.dispose();
  }

  void _update(SoundTrigger Function(SoundTrigger t) transform) {
    setState(() => _draft = transform(_draft));
  }

  Future<void> _save() async {
    final store = context.read<AppConfigStore>();
    final name = _nameController.text.trim();
    // giftName / commentText は desktop と同じく trim + 小文字化して保持する。
    final next = _draft.copyWith(
      name: name,
      giftName: _giftNameController.text.trim().toLowerCase(),
      minCoins: int.tryParse(_minCoinsController.text.trim()) ?? 0,
      commentText: _commentTextController.text.trim().toLowerCase(),
    );

    await store.updateSound((c) {
      final exists = c.triggers.any((t) => t.id == next.id);
      return c.copyWith(
        triggers: exists
            ? [for (final t in c.triggers) t.id == next.id ? next : t]
            : [...c.triggers, next],
      );
    });
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('トリガーを削除'),
        content: Text('「${_draft.name.isEmpty ? '（無題）' : _draft.name}」を削除します。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('削除'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await context.read<AppConfigStore>().updateSound(
          (c) => c.copyWith(triggers: c.triggers.where((t) => t.id != _draft.id).toList()),
        );
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  /// 背景 Isolate へ再生だけを依頼する。サービス停止中は鳴らせない
  /// （UI 側のプレイヤーで鳴らすと、実際の発火経路とは別物の確認になる）。
  Future<void> _testFire() async {
    final messenger = ScaffoldMessenger.of(context);
    if (_draft.soundIds.isEmpty) {
      messenger.showSnackBar(const SnackBar(content: Text('音源が選ばれていません')));
      return;
    }
    if (!await FlutterForegroundTask.isRunningService) {
      messenger.showSnackBar(const SnackBar(content: Text('「開始」してからテストしてください')));
      return;
    }
    FlutterForegroundTask.sendDataToTask({
      'command': 'testPlaySound',
      'soundIds': _draft.playMode == SoundPlayMode.random
          ? [_draft.soundIds.first]
          : _draft.soundIds,
    });
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppConfigStore>();
    final config = store.sound;

    if (!_initialized) {
      // 編集対象が消えていた（別画面でカテゴリごと削除された等）。
      return Scaffold(
        appBar: AppBar(title: const Text('トリガー')),
        body: const Center(child: Text('このトリガーは削除されています')),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.triggerId == null ? 'トリガーを追加' : 'トリガーを編集'),
        actions: [
          if (widget.triggerId != null)
            IconButton(
              icon: const Icon(Icons.delete_outline),
              tooltip: '削除',
              onPressed: _delete,
            ),
          TextButton(onPressed: _save, child: const Text('保存')),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: 8),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              controller: _nameController,
              decoration: const InputDecoration(labelText: 'トリガー名'),
            ),
          ),
          if (config.categories.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: DropdownButtonFormField<String>(
                initialValue: config.categories.any((c) => c.id == _draft.categoryId)
                    ? _draft.categoryId
                    : config.categories.first.id,
                decoration: const InputDecoration(labelText: 'カテゴリ'),
                items: [
                  for (final c in config.categories)
                    DropdownMenuItem(value: c.id, child: Text(c.name)),
                ],
                onChanged: (value) {
                  if (value != null) _update((t) => t.copyWith(categoryId: value));
                },
              ),
            ),
          const _SectionHeader('発火条件'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SegmentedButton<SoundEventType>(
              segments: const [
                ButtonSegment(value: SoundEventType.gift, label: Text('ギフト')),
                ButtonSegment(value: SoundEventType.comment, label: Text('コメント')),
                ButtonSegment(value: SoundEventType.follow, label: Text('フォロー')),
              ],
              selected: {_draft.eventType},
              onSelectionChanged: (selected) =>
                  _update((t) => t.copyWith(eventType: selected.first)),
            ),
          ),
          ..._conditionFields(),
          const _SectionHeader('対象ユーザー'),
          ListTile(
            title: Text(_draft.userIds.isEmpty ? '全員' : '${_draft.userIds.length}人に限定'),
            subtitle: _draft.userIds.isEmpty
                ? null
                : Text(_draft.userIds.join(', '), style: const TextStyle(fontSize: 12)),
            trailing: const Icon(Icons.edit),
            onTap: _editUserIds,
          ),
          const _SectionHeader('鳴らす音'),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SegmentedButton<SoundPlayMode>(
              segments: const [
                ButtonSegment(value: SoundPlayMode.sequential, label: Text('全部順に')),
                ButtonSegment(value: SoundPlayMode.random, label: Text('1つランダム')),
              ],
              selected: {_draft.playMode},
              onSelectionChanged: (selected) =>
                  _update((t) => t.copyWith(playMode: selected.first)),
            ),
          ),
          if (config.assets.isEmpty)
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                '音源がありません。サウンドタブの「音源ライブラリ」から追加してください。',
                style: TextStyle(color: Colors.grey, fontSize: 13),
              ),
            ),
          for (final asset in config.assets)
            CheckboxListTile(
              dense: true,
              title: Text(asset.name),
              value: _draft.soundIds.contains(asset.id),
              onChanged: (checked) => _update((t) => t.copyWith(
                    soundIds: checked == true
                        ? [...t.soundIds, asset.id]
                        : t.soundIds.where((id) => id != asset.id).toList(),
                  )),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: OutlinedButton.icon(
              onPressed: _testFire,
              icon: const Icon(Icons.play_arrow),
              label: const Text('テスト発火'),
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _conditionFields() {
    switch (_draft.eventType) {
      case SoundEventType.gift:
        return [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              controller: _giftNameController,
              decoration: const InputDecoration(
                labelText: 'ギフト名',
                helperText: '空欄なら任意のギフトに反応します',
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              controller: _minCoinsController,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: '最低コイン数',
                helperText: 'まとめ投げは「コイン数 × 連打数」で判定します',
              ),
            ),
          ),
          SwitchListTile(
            title: const Text('まとめ投げを1回として扱う'),
            subtitle: const Text('OFFにすると連打の回数だけ鳴ります'),
            value: _draft.treatGiftComboAsSingle,
            onChanged: (value) => _update((t) => t.copyWith(treatGiftComboAsSingle: value)),
          ),
        ];
      case SoundEventType.comment:
        return [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: SegmentedButton<SoundCommentMode>(
              segments: const [
                ButtonSegment(value: SoundCommentMode.any, label: Text('すべてのコメント')),
                ButtonSegment(value: SoundCommentMode.exact, label: Text('完全一致')),
              ],
              selected: {_draft.commentMode},
              onSelectionChanged: (selected) =>
                  _update((t) => t.copyWith(commentMode: selected.first)),
            ),
          ),
          if (_draft.commentMode == SoundCommentMode.exact)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: TextField(
                controller: _commentTextController,
                decoration: const InputDecoration(
                  labelText: '一致させるコメント',
                  helperText: '大文字小文字は区別しません',
                ),
              ),
            ),
        ];
      case SoundEventType.follow:
        return const [
          Padding(
            padding: EdgeInsets.all(16),
            child: Text(
              'フォローされたときに鳴ります。追加の条件はありません。',
              style: TextStyle(color: Colors.grey, fontSize: 13),
            ),
          ),
        ];
    }
  }

  Future<void> _editUserIds() async {
    final controller = TextEditingController(text: _draft.userIds.join('\n'));
    final result = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('対象ユーザー'),
        content: TextField(
          controller: controller,
          maxLines: 6,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'TikTok ID（1行に1つ）',
            helperText: '空欄なら全員が対象',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: const Text('保存'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (result == null) return;
    final ids = result
        .split('\n')
        .map((s) => s.trim().replaceFirst(RegExp(r'^@'), ''))
        .where((s) => s.isNotEmpty)
        .toList();
    _update((t) => t.copyWith(userIds: ids));
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
