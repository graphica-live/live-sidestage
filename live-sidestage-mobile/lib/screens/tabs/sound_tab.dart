import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/account_status_store.dart';
import '../../core/app_config_store.dart';
import '../../core/feature_status.dart';
import '../../core/gift_name_ja.dart';
import '../../core/plan_gate.dart';
import '../../core/sound_file_cleanup.dart';
import '../../core/sound_library.dart';
import '../../core/upgrade_notice.dart';
import '../../models/app_config.dart';
import '../gift_sound_edit_screen.dart';
import '../home_screen.dart' show SoundState;
import '../widgets/feature_status_bar.dart';
import '../widgets/gradient_kit.dart';

/// セットタブを押したときの案内。運用中は使うセットを変えられない。
const String _lockedSetMessage = 'セットを変更するには停止してください';

/// ギフト設定を触ろうとしたときの案内。
const String _lockedSettingMessage = '設定を変更するには停止してください';

void _showLocked(BuildContext context, String message) => showTimedNotice(context, message);

/// FREEプランの上限到達を伝え、プラン選択画面への導線を添える。
void _showUpgradeRequired(BuildContext context, String message) =>
    showUpgradeRequiredNotice(context, message);

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
    final planGate = PlanGate(context.watch<AccountStatusStore>().status);
    final soundLimitReached = planGate.maxSoundRegistrations != null &&
        config.totalGiftSoundCount >= planGate.maxSoundRegistrations!;

    final sub = Theme.of(context).colorScheme.onSurfaceVariant;

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: ListView(
        // 「音を追加」は画面右下固定の拡張FAB(comp `.fab-ext`)へ戻したので、
        // 最終行が隠れないぶんの逃げを取る。
        padding: const EdgeInsets.only(bottom: 84),
        children: [
          FeatureStatusBar(status: status, errors: errors, notice: notice),
          if (store.configFromFutureVersion) const ConfigTooNewBanner(),

          FeatureStartButton(
            started: started,
            busy: busy,
            blocked: store.configFromFutureVersion,
            onToggle: onToggle,
            labelPrefix: '効果音を',
          ),

          // 全体音量は設定タブにある。配信中に見る画面なので、ここには
          // 状態とセットの中身だけを置く。

          // 受信の状況はセットの設定ではないので、囲いの中には入れない。
          if (sound.lastGiftName != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
              // 受信した英語名がそのまま入っている。一覧のタイトルと表記が
              // 揃っていないと同じギフトだと分からないので、ここも辞書を通す。
              child: Text('直近: ${GiftNameJa.display(sound.lastGiftName!)}',
                  style: TextStyle(fontSize: 12, color: sub)),
            ),
          if (sound.overflowCount > 0)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
              child: Text(
                '1回のギフトで鳴らせる上限を超えた回数: ${sound.overflowCount}',
                style: const TextStyle(color: Colors.orange, fontSize: 12),
              ),
            ),

          const KosaiSectionHeading('効果音セット'),
          // どのセットが対象なのかをタブの色だけに委ねない（§7）。囲いの見出しにも
          // 同じ名前が出るが、こちらは画面を開いた瞬間に目に入る位置での明示で、
          // 役割が違う（スクロールで囲いの見出しが流れても対象が分かる）。
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
            child: Text(
              // 停止中は「これから使うセット」、開始中は「今まさに鳴っているセット」。
              // 意味が違うので文言を分ける(既存の作り分けを維持)。
              started ? '使用中：${selected.name}' : '現在のセット：${selected.name}',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: started
                    ? KosaiPalette.c2
                    : Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),

          _SoundSetTabs(config: config, locked: locked),
          _SelectedSetPanel(set: selected, locked: locked),
        ],
      ),
      floatingActionButton: KosaiExtendedFab(
        label: '音を追加',
        dimmed: locked || soundLimitReached,
        // **ロック中も onPressed を null にしない。** null にすると押しても
        // 無反応で、なぜ追加できないのかを伝えられない（§14）。
        onPressed: () {
          if (locked) {
            _showLocked(context, _lockedSettingMessage);
            return;
          }
          if (soundLimitReached) {
            _showUpgradeRequired(context, 'FREEプランでは効果音の登録は5件までです');
            return;
          }
          Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => GiftSoundEditScreen(setId: selected.id)),
          );
        },
      ),
    );
  }
}

/// セットの切り替えタブ(comp `.chip-row`)。名前や数が増えても収まるよう
/// 横スクロールにする（§5）。
class _SoundSetTabs extends StatelessWidget {
  const _SoundSetTabs({required this.config, required this.locked});

  final SoundConfig config;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      // 下の余白は持たない。選択中タブの舌をそのまま下のパネルへ接続させる。
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
      child: Row(
        // タブごとに舌のぶんの高さを持つので、チップの上端で揃える。
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final set in config.sets) ...[
            _SetChip(set: set, config: config, locked: locked),
            const SizedBox(width: 8),
          ],
          // 5セット到達時とロック中は薄くするだけ。消すとタブ行の幅が変わって
          // 並びが飛ぶので、非表示にはしない（§16）。
          Padding(
            padding: const EdgeInsets.only(bottom: _SetTabNotch.height),
            child: KosaiChip(
              label: '＋追加',
              selected: false,
              dashed: true,
              dimmed: locked || !config.canAddSet,
              onTap: () {
                if (locked) {
                  _showLocked(context, _lockedSetMessage);
                  return;
                }
                if (!config.canAddSet) {
                  showTimedNotice(context, 'セットは最大${SoundConfig.maxSets}個までです');
                  return;
                }
                _addSet(context);
              },
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

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        KosaiChip(
          label: set.name,
          selected: isSelected,
          maxWidth: _maxWidth,
          // ロック中の他セットは薄くしてロックを示す。画面全体はグレーアウトしない（§15）。
          dimmed: locked && !isSelected,
          // 上級者向けのショートカット。これだけが操作方法にならないよう、
          // 見える「…」メニューも別に用意してある（§18）。
          onLongPress: locked ? null : () => showSetMenu(context, set),
          // **ロック中も onTap を null にしない。** null にすると押しても
          // 無反応になり、「停止してください」を伝えられない（§14）。
          onTap: () {
            if (isSelected) return;
            if (locked) {
              _showLocked(context, _lockedSetMessage);
              return;
            }
            context.read<AppConfigStore>().updateSound((c) => c.selectSet(set.id));
          },
        ),
        // 選択中だけ下のパネルへ舌(comp `.bubble::before` の吹き出し)を出す。
        // 非選択でも同じ高さを取っておき、選択を移してもタブ行の高さが変わらないようにする。
        SizedBox(
          height: _SetTabNotch.height,
          child: isSelected ? _SetTabNotch(color: kosaiCardColor(context)) : null,
        ),
      ],
    );
  }
}

/// 選択中のタブから下のパネルへ伸びる舌。どのタブの中身を見ているのかを、
/// 色の一致だけでなく形でも示す。
class _SetTabNotch extends StatelessWidget {
  const _SetTabNotch({required this.color});

  final Color color;

  static const double width = 18;
  static const double height = 7;

  @override
  Widget build(BuildContext context) => CustomPaint(
        size: const Size(width, height),
        painter: _SetTabNotchPainter(color),
      );
}

class _SetTabNotchPainter extends CustomPainter {
  const _SetTabNotchPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(0, size.height)
      ..lineTo(size.width / 2, 0)
      ..lineTo(size.width, size.height)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_SetTabNotchPainter oldDelegate) => oldDelegate.color != color;
}

/// 選択中セットの中身を1枚に囲うパネル(comp `.panel.soft.bubble`)。
///
/// 見出しもギフト一覧も、タブと地続きの面に閉じ込める。囲いが無いと
/// 一覧が画面直下に流れ、どこまでがそのセットの持ち物なのかが見えない。
class _SelectedSetPanel extends StatelessWidget {
  const _SelectedSetPanel({required this.set, required this.locked});

  final SoundSet set;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    final divider = kosaiRowDividerColor(context);
    final gifts = set.gifts;

    return Container(
      // 上マージンは持たない。タブの舌と接するのが囲いの上端。
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      decoration: BoxDecoration(
        color: kosaiCardColor(context),
        borderRadius: BorderRadius.circular(18),
        boxShadow: kosaiPanelShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _SelectedSetHeader(set: set, locked: locked),
          if (gifts.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
              child: Text(
                'まだ何も登録されていません。\n「音を追加」からギフトと音を選んでください。',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            )
          else
            for (var i = 0; i < gifts.length; i++) ...[
              if (i > 0)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                  child: Divider(height: 1, thickness: 1, color: divider),
                ),
              _GiftSoundTile(gift: gifts[i], setId: set.id, locked: locked),
            ],
        ],
      ),
    );
  }
}

/// パネルの見出し(comp `.bubble-label`)と操作メニュー（§17）。
class _SelectedSetHeader extends StatelessWidget {
  const _SelectedSetHeader({required this.set, required this.locked});

  final SoundSet set;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(14, locked ? 12 : 4, locked ? 14 : 4, 2),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '「${set.name}」セットの内容',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          // ロック中は全項目が禁止なので、空のメニューを出す意味がない。
          if (!locked)
            IconButton(
              icon: const Icon(Icons.more_horiz, size: 20),
              tooltip: 'セットの操作',
              onPressed: () => showSetMenu(context, set),
            ),
        ],
      ),
    );
  }
}

/// ギフト1行(comp `.row-item`)。左からギフト画像・名前/音源名/音量メーター・スイッチ。
class _GiftSoundTile extends StatelessWidget {
  const _GiftSoundTile({required this.gift, required this.setId, required this.locked});

  final GiftSound gift;
  final String setId;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    final store = context.read<AppConfigStore>();
    final sub = Theme.of(context).colorScheme.onSurfaceVariant;

    return InkWell(
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
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 13),
        child: Row(
          children: [
            GiftThumbnail(gift.giftImageUrl),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  // 保存してあるのは TikTok の英語名。表示だけ辞書で日本語にするので、
                  // あとから辞書が増えれば登録済みの設定にも効く。
                  Text(
                    GiftNameJa.display(gift.giftName, fallback: gift.displayGiftName),
                    style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 1),
                  Text(
                    gift.soundName.isEmpty ? gift.fileName : gift.soundName,
                    style: TextStyle(fontSize: 11.5, color: sub),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  // 個別音量(GiftSoundEditScreenで設定)は一覧では見えなかった。
                  // 何本鳴っているか把握するのに毎回開く必要があったので、ここでも可視化する。
                  const SizedBox(height: 4),
                  _MiniVolumeMeter(volume: gift.volume),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Switch(
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
          ],
        ),
      ),
    );
  }
}

/// [GiftSound.volume](0-100)を5本の棒で可視化する(comp `.vmeter`)。数値を出さないのは
/// このタイルが1行の要約であるため──正確な値を見る・変えるのは
/// タップ先の [GiftSoundEditScreen] の役目で、ここは大小の見た目だけでよい。
class _MiniVolumeMeter extends StatelessWidget {
  const _MiniVolumeMeter({required this.volume});

  final int volume;

  /// comp `.vmeter .bar` の高さ(3/5/7/9/9px)を換算したもの。
  static const List<double> _barHeights = [4, 6, 8, 11, 11];

  @override
  Widget build(BuildContext context) {
    final activeBars = (volume / 100 * _barHeights.length).round().clamp(0, _barHeights.length);
    final off = kosaiTrackColor(context);

    return Semantics(
      label: '音量 $volume',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (var i = 0; i < _barHeights.length; i++)
            Padding(
              padding: EdgeInsets.only(right: i < _barHeights.length - 1 ? 2 : 0),
              child: Container(
                width: 3,
                height: _barHeights[i],
                decoration: BoxDecoration(
                  color: i < activeBars ? KosaiPalette.c2 : off,
                  borderRadius: BorderRadius.circular(1.5),
                ),
              ),
            ),
        ],
      ),
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
