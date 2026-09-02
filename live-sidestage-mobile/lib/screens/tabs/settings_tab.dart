import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/account_deletion.dart';
import '../../core/account_status_store.dart';
import '../../core/app_config_store.dart';
import '../../core/battle_filter_store.dart';
import '../../core/plan_gate.dart';
import '../../core/privacy_policy.dart';
import '../../core/session_controller.dart';
import '../../core/theme_mode_store.dart';
import '../../core/upgrade_notice.dart';
import '../../models/auth_session.dart';
import '../../models/voice_catalog.dart';
import '../home_screen.dart' show SpeechState;
import '../subscription_screen.dart';
import '../widgets/gradient_kit.dart';
import '../widgets/list_panel.dart';
import '../widgets/voicevox_terms.dart';

void _showUpgradeRequired(BuildContext context, String message) =>
    showUpgradeRequiredNotice(context, message);

/// 設定の集約先。
///
/// **読み上げ・効果音の設定項目はすべてここに置く。** TTSタブとサウンドタブは
/// 配信中に見る運用画面なので、状態表示と開始/停止だけを持たせる。同じ設定を
/// 両方に出すと、どちらが効いているのか分からなくなる。
///
/// 見た目は光彩(Kosai)の `.impeccable/approved/settings-tab-kosai/`。
/// 数値設定(音量・速さ・しきい値)は一覧では「値 + ›」の行にとどめ、
/// スライダーはタップで開くボトムシートの中だけに置く。
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
    final themeModeStore = context.watch<ThemeModeStore>();
    final battleFilter = context.watch<BattleFilterStore>();
    final accountStatus = context.watch<AccountStatusStore>();
    final planGate = PlanGate(accountStatus.status);

    // **どの設定も「開始しているか」では止めない。** `ttsEnabled` / `sound.enabled` は
    // 機能のON/OFF設定ではなく開始しているかの記録なので、それで無効化すると
    // 「一度開始しないと設定できない」画面になる。停止中の変更は永続化され、次の
    // onStart で背景 Isolate が読む。運用中の変更も applyConfig でそのまま届く。
    // 止めるのは開始/停止の遷移中だけ（保存とサービス起動の間に挟まると渡らない）。
    final canEdit = !busy;

    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        const KosaiSectionHeading('表示', top: 8),
        ListPanel(
          children: [
            _SettingValueRow(
              title: 'テーマ',
              value: themeModeStore.themeMode.label,
              onTap: () => _pickThemeMode(context, themeModeStore),
            ),
          ],
        ),
        // 読み上げ・効果音の ON/OFF は各タブの「開始/停止」ボタンが持つ。
        // ここに同じトグルを置くと二重になり、どちらが接続を制御しているのか分からなくなる。
        const KosaiSectionHeading('読み上げ'),
        ListPanel(
          children: [
            _SettingSwitchRow(
              title: 'ランダムボイス',
              subtitle: planGate.canUseRandomVoice
                  ? 'コメント投稿者ごとに声を割り当てます'
                  : 'PRO/ULTRAプランで利用できます',
              value: store.config.randomVoice,
              enabled: canEdit && planGate.canUseRandomVoice,
              onChanged: store.setRandomVoice,
              onLockedTap: !canEdit
                  ? null
                  : () => _showUpgradeRequired(context, 'PRO/ULTRAプランで利用できます'),
            ),
            _VoiceRow(
              styleId: store.config.fixedStyleId,
              randomVoice: store.config.randomVoice,
              enabled: canEdit,
              canUseAllVoices: planGate.canUseAllVoices,
              onSelected: store.setFixedStyleId,
            ),
            _SettingValueRow(
              title: '読み上げの音量',
              value: '${store.config.ttsVolume}',
              accent: true,
              onTap: !canEdit
                  ? null
                  : () => showKosaiValueSheet(
                        context,
                        title: '読み上げの音量',
                        value: store.config.ttsVolume,
                        onChanged: store.setTtsVolume,
                      ),
            ),
            // 速度は合成時にしか効かせられないので、変えても**先読み済みの1件には
            // 反映されない**（次の次から効く）。音量と違って即座には変わらない。
            _SettingValueRow(
              title: '読み上げの速さ',
              value: '${store.config.ttsSpeed}%',
              accent: true,
              locked: !planGate.canAdjustTtsSpeed,
              onTap: !canEdit
                  ? null
                  : !planGate.canAdjustTtsSpeed
                      ? () => _showUpgradeRequired(context, 'PRO/ULTRAプランで速度を調整できます')
                      : () => showKosaiValueSheet(
                            context,
                            title: '読み上げの速さ',
                            value: store.config.ttsSpeed,
                            onChanged: store.setTtsSpeed,
                            min: 50,
                            max: 200,
                            divisions: 30,
                            suffix: '%',
                          ),
            ),
          ],
        ),
        const KosaiSectionHeading('効果音'),
        ListPanel(
          children: [
            // セットをまたいだ共通の音量。配信中に下げたくなるものなので運用中も触れる。
            //
            // 以前は「全体の音量」という表示だったが、**読み上げには一切かかっていない**
            // (sound_engine.dart: gift.volume * masterVolume)。名前だけが「全体」を
            // 名乗っていて、読み上げも下がると誤解される。内部名 masterVolume は
            // 保存済み設定のキーなので変えない。
            _SettingValueRow(
              title: 'すべての効果音の音量',
              value: '${store.sound.masterVolume}',
              accent: true,
              onTap: !canEdit
                  ? null
                  : () => showKosaiValueSheet(
                        context,
                        title: 'すべての効果音の音量',
                        value: store.sound.masterVolume,
                        onChanged: (value) =>
                            store.updateSound((c) => c.copyWith(masterVolume: value)),
                      ),
            ),
          ],
        ),
        // comp未定義。バトル履歴タブのしきい値トグルが参照する境界値をここで変える。
        const KosaiSectionHeading('バトル履歴'),
        ListPanel(
          children: [
            _SettingValueRow(
              title: '小さいバトルを隠す',
              subtitle: 'バトル履歴タブで非表示にする下限',
              value: '${battleFilter.threshold}コイン',
              accent: true,
              onTap: () => showKosaiValueSheet(
                context,
                title: '小さいバトルを隠すしきい値',
                value: battleFilter.threshold,
                onChanged: battleFilter.setThreshold,
                max: maxBattleHideSmallThreshold,
                divisions: 20,
                suffix: 'コイン',
              ),
            ),
          ],
        ),
        const KosaiSectionHeading('プラン'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: GradientBorderCard(
            padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    // β表記込みの表示文字列はサーバーの`planLabel`が唯一の正本
                    // (クライアントで組み立て直さない)。`_PlanBadge`と同じ扱い。
                    accountStatus.status.planLabel,
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
                  ),
                ),
                KosaiOutlineButton(
                  label: 'アップグレード',
                  expand: false,
                  verticalPadding: 9,
                  horizontalPadding: 19,
                  fontSize: 12,
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const SubscriptionScreen()),
                  ),
                ),
              ],
            ),
          ),
        ),
        const KosaiSectionHeading('アカウント'),
        ListPanel(
          children: [
            _SettingValueRow(
              title: 'TikTok ID',
              value: '@${session?.streamer?.tiktokId ?? ''}',
              trailingIcon: Icons.edit,
              onTap: onChangeTiktokId,
            ),
            if (session != null && session.userEmail.isNotEmpty)
              _SettingValueRow(
                // どちらでログインしたかは session が持っている。決め打ちにすると
                // 実際とは違うプロバイダを表示することになる。
                title: switch (session.provider) {
                  AuthProvider.apple => 'Appleアカウント',
                  AuthProvider.email => 'メールアカウント',
                  AuthProvider.google => 'Googleアカウント',
                },
                subtitle: session.userEmail,
                trailingIcon: null,
              ),
            _SettingValueRow(
              title: 'VOICEVOX利用規約',
              onTap: () => showVoicevoxTermsDialog(context),
            ),
            _SettingValueRow(
              title: 'プライバシーポリシー',
              onTap: () => launchPrivacyPolicy(context),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: ListPanel(
            margin: const EdgeInsets.symmetric(horizontal: 16),
            children: [
              InkWell(
                onTap: () async {
                  final confirmed = await confirmLogout(context);
                  if (!confirmed) return;
                  if (!context.mounted) return;
                  await onBeforeLogout();
                  if (!context.mounted) return;
                  await context.read<SessionController>().logout();
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'ログアウト',
                      style: TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: KosaiDangerButton(
            label: 'アカウント削除',
            onPressed: () => confirmAndDeleteAccount(context, onBeforeDelete: onBeforeLogout),
          ),
        ),
        if (store.syncPending)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              '設定を反映中…',
              style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ),
      ],
    );
  }

  Future<void> _pickThemeMode(BuildContext context, ThemeModeStore store) async {
    final picked = await showModalBottomSheet<ThemeMode>(
      context: context,
      builder: (context) => _ThemeModePickerSheet(selected: store.themeMode),
    );
    if (picked != null && picked != store.themeMode) store.setThemeMode(picked);
  }
}

extension on ThemeMode {
  String get label => switch (this) {
        ThemeMode.system => 'システム設定に合わせる',
        ThemeMode.light => 'ライト',
        ThemeMode.dark => 'ダーク',
      };
}

// ── 行 ──────────────────────────────────────────────────────────────────────

/// 「ラベル ─ 値 ›」の1行(comp `.switch-row`)。
/// 数値設定は[accent]でc2の太字にし、選択肢はsub色にする。
class _SettingValueRow extends StatelessWidget {
  const _SettingValueRow({
    required this.title,
    this.subtitle,
    this.value,
    this.accent = false,
    this.locked = false,
    this.trailingIcon = Icons.chevron_right,
    this.onTap,
  });

  final String title;
  final String? subtitle;
  final String? value;

  /// 値をアクセント色(c2)の太字にする。音量・速さ・しきい値などの数値設定。
  final bool accent;

  /// プラン制限で変更できない。錠アイコンを添えるが**押下は止めない**。
  final bool locked;

  final IconData? trailingIcon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final sub = Theme.of(context).colorScheme.onSurfaceVariant;
    final subtitleText = subtitle;
    final valueText = value;

    return InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 52),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 13),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500)),
                    if (subtitleText != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 1),
                        child: Text(subtitleText, style: TextStyle(fontSize: 11, color: sub)),
                      ),
                  ],
                ),
              ),
              if (valueText != null)
                Flexible(
                  child: Text(
                    valueText,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.right,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: accent ? FontWeight.w700 : FontWeight.w400,
                      color: accent ? KosaiPalette.c2 : sub,
                    ),
                  ),
                ),
              if (locked) ...[
                const SizedBox(width: 4),
                Icon(Icons.lock_outline, size: 16, color: sub),
              ],
              if (trailingIcon != null) ...[
                const SizedBox(width: 4),
                Icon(trailingIcon, size: 18, color: sub),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// 「ラベル ─ スイッチ」の1行(comp `.switch-row`)。
class _SettingSwitchRow extends StatelessWidget {
  const _SettingSwitchRow({
    required this.title,
    required this.value,
    required this.enabled,
    required this.onChanged,
    this.subtitle,
    this.onLockedTap,
  });

  final String title;
  final String? subtitle;
  final bool value;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  /// 無効なときにタップされたら呼ぶ(ロック理由の案内)。**押しても無反応にしない。**
  final VoidCallback? onLockedTap;

  @override
  Widget build(BuildContext context) {
    final sub = Theme.of(context).colorScheme.onSurfaceVariant;
    final subtitleText = subtitle;

    return InkWell(
      onTap: enabled ? () => onChanged(!value) : onLockedTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 52),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500)),
                    if (subtitleText != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 1),
                        child: Text(subtitleText, style: TextStyle(fontSize: 11, color: sub)),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Transform.scale(
                scale: 0.85,
                child: Switch(value: value, onChanged: enabled ? onChanged : null),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// ランダムボイスがOFFのときに読み上げるボイス。
///
/// 選択肢は同梱 vvm の静的な一覧（[VoiceCatalog]）から出す。VOICEVOX が返す実際の
/// 一覧は読み上げを開始しないと存在せず、停止中に開くのが普通のこの画面では使えない。
class _VoiceRow extends StatelessWidget {
  const _VoiceRow({
    required this.styleId,
    required this.randomVoice,
    required this.enabled,
    required this.canUseAllVoices,
    required this.onSelected,
  });

  final int styleId;
  final bool randomVoice;
  final bool enabled;
  final bool canUseAllVoices;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    final label = VoiceCatalog.labelFor(styleId);
    final canPick = enabled && !randomVoice;

    return _SettingValueRow(
      title: 'ボイス',
      // ランダム中でも選択済みのボイスは出す。理由だけに差し替えると、OFFにしたとき
      // 何の声になるのか確かめられない。
      subtitle: randomVoice ? 'ランダムボイスをOFFにすると使えます' : null,
      value: label,
      onTap: canPick ? () => _pick(context) : null,
    );
  }

  Future<void> _pick(BuildContext context) async {
    final picked = await showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      builder: (context) => _VoicePickerSheet(selected: styleId, canUseAllVoices: canUseAllVoices),
    );
    if (picked != null && picked != styleId) onSelected(picked);
  }
}

// ── シート ───────────────────────────────────────────────────────────────────

/// 数値設定のボトムシート(comp `settings-tab-kosai/comp-sheet.png`)。
/// 一覧の行は「値 + ›」に留め、スライダーはこの中にだけ置く。
///
/// ドラッグ中は手元の値で追従させ、**指を離したときにだけ保存する**。
/// `onChanged` ごとに永続化すると、1回のドラッグで数十回の書き込みと背景 Isolate への
/// 送信が走る。逆に追従を省くと、`value` が設定値のままなのでつまみが指に付いてこない。
Future<void> showKosaiValueSheet(
  BuildContext context, {
  required String title,
  required int value,
  required ValueChanged<int> onChanged,
  int min = 0,
  int max = 100,
  int divisions = 20,
  String suffix = '',
}) {
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: Colors.transparent,
    builder: (_) => _ValueSheet(
      title: title,
      value: value,
      onChanged: onChanged,
      min: min,
      max: max,
      divisions: divisions,
      suffix: suffix,
    ),
  );
}

class _ValueSheet extends StatefulWidget {
  const _ValueSheet({
    required this.title,
    required this.value,
    required this.onChanged,
    required this.min,
    required this.max,
    required this.divisions,
    required this.suffix,
  });

  final String title;
  final int value;
  final ValueChanged<int> onChanged;
  final int min;
  final int max;
  final int divisions;
  final String suffix;

  @override
  State<_ValueSheet> createState() => _ValueSheetState();
}

class _ValueSheetState extends State<_ValueSheet> {
  late int _value = widget.value;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        decoration: BoxDecoration(
          color: kosaiCardColor(context),
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        ),
        padding: const EdgeInsets.fromLTRB(18, 20, 18, 26),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 18),
              decoration: BoxDecoration(
                color: kosaiTrackColor(context),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(widget.title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                GradientText(
                  '$_value${widget.suffix}',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                  gradient: KosaiPalette.score,
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Slider(
                value: _value.toDouble().clamp(widget.min.toDouble(), widget.max.toDouble()),
                min: widget.min.toDouble(),
                max: widget.max.toDouble(),
                divisions: widget.divisions,
                onChanged: (v) => setState(() => _value = v.round()),
                onChangeEnd: (v) => widget.onChanged(v.round()),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ThemeModePickerSheet extends StatelessWidget {
  const _ThemeModePickerSheet({required this.selected});

  final ThemeMode selected;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ListView(
        shrinkWrap: true,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text(
              'テーマを選ぶ',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
          ),
          for (final mode in ThemeMode.values)
            ListTile(
              key: ValueKey('theme-mode-${mode.name}'),
              title: Text(mode.label),
              trailing: mode == selected ? const Icon(Icons.check) : null,
              onTap: () => Navigator.of(context).pop(mode),
            ),
        ],
      ),
    );
  }
}

class _VoicePickerSheet extends StatelessWidget {
  const _VoicePickerSheet({required this.selected, required this.canUseAllVoices});

  final int selected;
  final bool canUseAllVoices;

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
              for (final style in character.styles) ...[
                if (canUseAllVoices || VoiceCatalog.isFreeStyle(style.styleId))
                  ListTile(
                    // スタイル名はキャラをまたいで重複する（「あまあま」など）。行の
                    // 同一性は styleId で持たせる。
                    key: ValueKey('voice-style-${style.styleId}'),
                    title: Text(style.styleName),
                    trailing:
                        style.styleId == selected ? const Icon(Icons.check) : null,
                    onTap: () => Navigator.of(context).pop(style.styleId),
                  )
                else
                  ListTile(
                    key: ValueKey('voice-style-${style.styleId}'),
                    title: Text(style.styleName, style: const TextStyle(color: Colors.grey)),
                    leading: const Icon(Icons.lock_outline, color: Colors.grey, size: 18),
                    subtitle: const Text('PRO/ULTRAプランで選べます'),
                    onTap: () => _showUpgradeRequired(context, 'PRO/ULTRAプランで選べます'),
                  ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}
