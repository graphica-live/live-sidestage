import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/app_config_store.dart';
import '../../core/feature_status.dart';
import '../../core/gift_name_ja.dart';
import '../../core/sound_file_cleanup.dart';
import '../../core/sound_library.dart';
import '../../models/app_config.dart';
import '../gift_sound_edit_screen.dart';
import '../home_screen.dart' show SoundState;
import '../widgets/feature_status_bar.dart';

/// セットタブを押したときの案内。運用中は使うセットを変えられない。
const String _lockedSetMessage = 'セットを変更するには停止してください';

/// ギフト設定を触ろうとしたときの案内。
const String _lockedSettingMessage = '設定を変更するには停止してください';

void _showLocked(BuildContext context, String message) {
  // 連打で溜めない。同じ案内が何枚も積まれても意味がない。
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message), duration: const Duration(seconds: 2)));
}

/// 「ギフト → 音」の一覧。最大 [SoundConfig.maxSets] セットを切り替えて使う。
///
/// ## 停止中 = 設定モード / 開始中 = 運用モード
///
/// 停止中はすべて編集でき、開始中は「停止」と「全体音量」だけを触れる。
/// セットは切り替えず、開始した時点のものを使い続ける。
///
/// **ロックの条件は `started` ではなく `started || busy`。** 開始処理は
/// 「設定を保存 → サービス起動」の順に進むので（home_screen.dart の `_toggleFeature`）、
/// その途中は設定だけ有効でサービスがまだ動いておらず、`started` は false のままになる。
/// ここで編集を許すと、背景 Isolate へ渡らない変更や、起動と競合する変更が入る。
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
    final selected = config.selectedSet;
    final locked = started || busy;

    return Scaffold(
      body: ListView(
        padding: const EdgeInsets.only(bottom: 96),
        children: [
          FeatureStatusBar(status: status, errors: errors, notice: notice),
          if (store.configFromFutureVersion) const ConfigTooNewBanner(),

          // どのセットが対象なのかをタブの色だけに委ねない（§7）。
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Text(
              '${started ? '使用中' : '現在のセット'}：${selected.name}',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.bold,
                color: Theme.of(context).colorScheme.primary,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),

          FeatureStartButton(
            started: started,
            busy: busy,
            blocked: store.configFromFutureVersion,
            onToggle: onToggle,
          ),

          // 全体音量はセット共通なので、セットタブより上に置く（§10）。
          // 運用中も配信中に調整できる必要があるため触れるままにする（§11）。
          // 開始/停止の遷移中だけは止める。
          _MasterVolumeSlider(
            value: config.masterVolume,
            enabled: !busy,
            onChanged: (value) =>
                store.updateSound((c) => c.copyWith(masterVolume: value)),
          ),

          _SoundSetTabs(config: config, locked: locked),
          _SelectedSetHeader(set: selected, locked: locked),

          if (sound.lastGiftName != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              // 受信した英語名がそのまま入っている。一覧のタイトルと表記が
              // 揃っていないと同じギフトだと分からないので、ここも辞書を通す。
              child: Text('直近: ${GiftNameJa.display(sound.lastGiftName!)}',
                  style: const TextStyle(fontSize: 12, color: Colors.grey)),
            ),
          if (sound.overflowCount > 0)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Text(
                '1回のギフトで鳴らせる上限を超えた回数: ${sound.overflowCount}',
                style: const TextStyle(color: Colors.orange, fontSize: 12),
              ),
            ),

          if (selected.gifts.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Text(
                'まだ何も登録されていません。\n「追加」からギフトと音を選んでください。',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey),
              ),
            ),
          for (final gift in selected.gifts)
            _GiftSoundTile(gift: gift, setId: selected.id, locked: locked),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: locked
            ? null
            : () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => GiftSoundEditScreen(setId: selected.id),
                  ),
                ),
        icon: const Icon(Icons.add),
        label: const Text('追加'),
      ),
    );
  }
}

/// 全体音量。
///
/// ドラッグ中は手元の値で追従させ、**指を離したときにだけ保存する**。
/// `onChanged` ごとに永続化すると、1回のドラッグで数十回の書き込みと背景 Isolate への
/// 送信が走る。逆に追従を省くと、`value` が設定値のままなのでつまみが指に付いてこない。
class _MasterVolumeSlider extends StatefulWidget {
  const _MasterVolumeSlider({
    required this.value,
    required this.enabled,
    required this.onChanged,
  });

  final int value;
  final bool enabled;
  final ValueChanged<int> onChanged;

  @override
  State<_MasterVolumeSlider> createState() => _MasterVolumeSliderState();
}

class _MasterVolumeSliderState extends State<_MasterVolumeSlider> {
  /// ドラッグ中だけ持つ表示用の値。離したら null に戻して設定値へ従う。
  int? _dragging;

  @override
  Widget build(BuildContext context) {
    final value = _dragging ?? widget.value;

    return ListTile(
      title: const Text('全体の音量'),
      subtitle: Slider(
        value: value.toDouble(),
        max: 100,
        divisions: 20,
        label: '$value',
        onChanged: widget.enabled ? (v) => setState(() => _dragging = v.round()) : null,
        onChangeEnd: (v) {
          setState(() => _dragging = null);
          widget.onChanged(v.round());
        },
      ),
      trailing: Text('$value'),
    );
  }
}

/// セットの切り替えタブ。名前や数が増えても収まるよう横スクロールにする（§5）。
class _SoundSetTabs extends StatelessWidget {
  const _SoundSetTabs({required this.config, required this.locked});

  final SoundConfig config;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      child: Row(
        children: [
          for (final set in config.sets) ...[
            _SetChip(set: set, config: config, locked: locked),
            const SizedBox(width: 8),
          ],
          // 5セット到達時とロック中は disabled。消すとタブ行の幅が変わって
          // 並びが飛ぶので、非表示にはしない（§16）。
          Tooltip(
            message: config.canAddSet ? 'セットを追加' : 'セットは最大${SoundConfig.maxSets}個までです',
            child: ActionChip(
              label: const Text('＋'),
              onPressed:
                  locked || !config.canAddSet ? null : () => _addSet(context),
            ),
          ),
        ],
      ),
    );
  }
}

class _SetChip extends StatelessWidget {
  const _SetChip({required this.set, required this.config, required this.locked});

  final SoundSet set;
  final SoundConfig config;
  final bool locked;

  /// タブ1つの上限幅。長いセット名で行が横に伸びきらないようにする（§6）。
  /// 省略した正式名称は操作メニューの見出しで出す。
  static const double _maxWidth = 140;

  @override
  Widget build(BuildContext context) {
    final isSelected = set.id == config.selectedSetId;

    return GestureDetector(
      // 上級者向けのショートカット。これだけが操作方法にならないよう、
      // 見える「…」メニューも別に用意してある（§18）。
      onLongPress: locked ? null : () => showSetMenu(context, set),
      child: Opacity(
        // ロック中の他セットは薄くしてロックを示す。画面全体はグレーアウトしない（§15）。
        opacity: locked && !isSelected ? 0.45 : 1,
        child: ChoiceChip(
          label: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: _maxWidth),
            child: Text(set.name, overflow: TextOverflow.ellipsis, maxLines: 1),
          ),
          selected: isSelected,
          // **ロック中も onSelected を null にしない。** null にすると押しても
          // 無反応になり、「停止してください」を伝えられない（§14）。
          onSelected: (_) {
            if (isSelected) return;
            if (locked) {
              _showLocked(context, _lockedSetMessage);
              return;
            }
            context.read<AppConfigStore>().updateSound((c) => c.selectSet(set.id));
          },
        ),
      ),
    );
  }
}

/// 選択中セットの見出しと操作メニュー（§17）。
class _SelectedSetHeader extends StatelessWidget {
  const _SelectedSetHeader({required this.set, required this.locked});

  final SoundSet set;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(16, 8, locked ? 16 : 4, 0),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  set.name,
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              // ロック中は全項目が禁止なので、空のメニューを出す意味がない。
              if (!locked)
                IconButton(
                  icon: const Icon(Icons.more_horiz),
                  tooltip: 'セットの操作',
                  onPressed: () => showSetMenu(context, set),
                ),
            ],
          ),
        ),
        const Divider(),
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 0, 16, 4),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text('ギフト設定', style: TextStyle(fontSize: 12, color: Colors.grey)),
          ),
        ),
      ],
    );
  }
}

class _GiftSoundTile extends StatelessWidget {
  const _GiftSoundTile({required this.gift, required this.setId, required this.locked});

  final GiftSound gift;
  final String setId;
  final bool locked;

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
        onChanged: locked
            ? null
            : (value) => store.updateSound(
                  (c) => c.updateSet(
                    setId,
                    (gifts) => [
                      for (final g in gifts)
                        g.id == gift.id ? g.copyWith(enabled: value) : g,
                    ],
                  ),
                ),
      ),
      onTap: () {
        if (locked) {
          _showLocked(context, _lockedSettingMessage);
          return;
        }
        Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => GiftSoundEditScreen(setId: setId, giftSoundId: gift.id),
          ),
        );
      },
    );
  }
}

// ── セット操作 ────────────────────────────────────────────────────────────────

enum _SetAction { rename, duplicate, reorder, remove }

/// 「…」とタブ長押しの共通メニュー。専用のセット管理画面は作らない（§17）。
Future<void> showSetMenu(BuildContext context, SoundSet set) async {
  final config = context.read<AppConfigStore>().sound;

  final action = await showModalBottomSheet<_SetAction>(
    context: context,
    builder: (sheetContext) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // タブでは省略されうるので、ここでは正式名称を出す（§6）。
          ListTile(
            dense: true,
            title: Text(set.name, style: const TextStyle(fontWeight: FontWeight.bold)),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.edit_outlined),
            title: const Text('名前を変更'),
            onTap: () => Navigator.of(sheetContext).pop(_SetAction.rename),
          ),
          ListTile(
            leading: const Icon(Icons.copy_outlined),
            title: const Text('複製'),
            enabled: config.canAddSet,
            subtitle: config.canAddSet
                ? null
                : Text('セットは最大${SoundConfig.maxSets}個までです'),
            onTap: () => Navigator.of(sheetContext).pop(_SetAction.duplicate),
          ),
          if (config.sets.length > 1)
            ListTile(
              leading: const Icon(Icons.swap_vert),
              title: const Text('並び替え'),
              onTap: () => Navigator.of(sheetContext).pop(_SetAction.reorder),
            ),
          // 最後の1セットは消せない。空のセット状態を作らない（§21）。
          if (config.canRemoveSet)
            ListTile(
              leading: const Icon(Icons.delete_outline, color: Colors.red),
              title: const Text('削除', style: TextStyle(color: Colors.red)),
              onTap: () => Navigator.of(sheetContext).pop(_SetAction.remove),
            ),
        ],
      ),
    ),
  );

  if (action == null || !context.mounted) return;

  switch (action) {
    case _SetAction.rename:
      await _renameSet(context, set);
    case _SetAction.duplicate:
      await _duplicateSet(context, set);
    case _SetAction.reorder:
      await _reorderSets(context);
    case _SetAction.remove:
      await _removeSet(context, set);
  }
}

Future<void> _addSet(BuildContext context) async {
  final store = context.read<AppConfigStore>();
  if (!store.sound.canAddSet) return;

  final name = await _promptSetName(
    context,
    title: '新しいセット',
    initialValue: 'セット${store.sound.sets.length + 1}',
    actionLabel: '作成',
  );
  if (name == null) return;
  // 上限は addSet の中でも見ているので、待っている間に増えていても壊れない。
  await store.updateSound((c) => c.addSet(name));
}

Future<void> _renameSet(BuildContext context, SoundSet set) async {
  final store = context.read<AppConfigStore>();
  final name = await _promptSetName(
    context,
    title: '名前を変更',
    initialValue: set.name,
    actionLabel: '変更',
  );
  if (name == null) return;
  await store.updateSound((c) => c.renameSet(set.id, name));
}

/// 企画ごとに設定を作り直さなくて済むよう、ギフト・音・個別音量ごと複製する（§19）。
/// 音源の実ファイルはコピーせず参照だけ増やす。
Future<void> _duplicateSet(BuildContext context, SoundSet set) async {
  final store = context.read<AppConfigStore>();
  if (!store.sound.canAddSet) return;

  final name = await _promptSetName(
    context,
    title: 'セットを複製',
    initialValue: '${set.name} コピー',
    actionLabel: '複製',
  );
  if (name == null) return;
  await store.updateSound((c) => c.duplicateSet(set.id, name));
}

Future<void> _reorderSets(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    builder: (_) => const _ReorderSetsSheet(),
  );
}

Future<void> _removeSet(BuildContext context, SoundSet set) async {
  final store = context.read<AppConfigStore>();
  if (!store.sound.canRemoveSet) return;

  final confirmed = await showDialog<bool>(
    context: context,
    // ダイアログ外タップ・戻る操作はキャンセル扱い（AlertDialog の既定）。
    builder: (dialogContext) => AlertDialog(
      title: Text('「${set.name}」を削除しますか？'),
      content: const Text('このセットに登録されているギフト・サウンド設定も削除されます。'),
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
  if (confirmed != true) return;

  // 設定から外す前に候補を控える。外したあとでは引けない。
  final candidates = [for (final g in set.gifts) g.fileName];
  await store.updateSound((c) => c.removeSet(set.id));

  // 複製で同じファイルを共有していることがあるので、単純には消せない。
  final library = SoundLibrary();
  try {
    await deleteUnreferencedSoundFiles(store, library, candidates);
  } finally {
    library.dispose();
  }
}

/// 最大5件しかないので、専用の管理画面は作らずボトムシートで済ませる（§22）。
class _ReorderSetsSheet extends StatelessWidget {
  const _ReorderSetsSheet();

  @override
  Widget build(BuildContext context) {
    final store = context.watch<AppConfigStore>();
    final sets = store.sound.sets;

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text('並び替え', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
          ),
          Flexible(
            child: ReorderableListView.builder(
              shrinkWrap: true,
              itemCount: sets.length,
              itemBuilder: (_, index) => ListTile(
                key: ValueKey(sets[index].id),
                leading: const Icon(Icons.drag_handle),
                title: Text(sets[index].name, overflow: TextOverflow.ellipsis),
              ),
              // onReorder ではなく onReorderItem を使う。こちらは取り除いた後の
              // 位置を渡してくるので、呼び出し側での index 補正が要らない。
              onReorderItem: (oldIndex, newIndex) {
                store.updateSound((c) => c.reorderSets(oldIndex, newIndex));
              },
            ),
          ),
          const SizedBox(height: 8),
        ],
      ),
    );
  }
}

/// セット名の入力。空のまま決定されたら初期値を採る（操作を止めない）。
Future<String?> _promptSetName(
  BuildContext context, {
  required String title,
  required String initialValue,
  required String actionLabel,
}) {
  return showDialog<String>(
    context: context,
    builder: (_) => _SetNameDialog(
      title: title,
      initialValue: initialValue,
      actionLabel: actionLabel,
    ),
  );
}

class _SetNameDialog extends StatefulWidget {
  const _SetNameDialog({
    required this.title,
    required this.initialValue,
    required this.actionLabel,
  });

  final String title;
  final String initialValue;
  final String actionLabel;

  @override
  State<_SetNameDialog> createState() => _SetNameDialogState();
}

class _SetNameDialogState extends State<_SetNameDialog> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initialValue);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final text = _controller.text.trim();
    Navigator.of(context).pop(text.isEmpty ? widget.initialValue : text);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        controller: _controller,
        autofocus: true,
        maxLength: SoundSet.maxNameLength,
        textInputAction: TextInputAction.done,
        decoration: const InputDecoration(labelText: 'セット名'),
        onSubmitted: (_) => _submit(),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('キャンセル'),
        ),
        FilledButton(onPressed: _submit, child: Text(widget.actionLabel)),
      ],
    );
  }
}
