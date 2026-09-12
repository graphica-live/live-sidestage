import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/account_deletion.dart';
import '../core/intro_onboarding_store.dart';
import '../core/logout.dart';
import '../core/session_controller.dart';
import '../models/tiktok_account_preview.dart';
import 'widgets/diamond_format.dart';
import 'widgets/gradient_kit.dart';
import 'widgets/user_avatar.dart';

const int _introSlideCount = 5;
/// [preLoginIntro] ログイン前の紹介5枚のみ。[postLoginLink] ログイン後のTikTok連携のみ。
enum OnboardingPhase { preLoginIntro, postLoginLink }

class _IntroSlide {
  const _IntroSlide({required this.icon, required this.title, required this.body});

  final IconData icon;
  final String title;
  final String body;
}

const _introSlides = [
  _IntroSlide(
    icon: Icons.speaker_notes_rounded,
    title: '画面を見ずに、コメントがわかる',
    body: 'コメントを音声で読み上げるので、配信画面から目を離さずに反応できます。リスナーごとに声を変えて、誰のコメントか聞き分けることもできます。',
  ),
  _IntroSlide(
    icon: Icons.card_giftcard,
    title: 'ギフトが、音と演出に変わる',
    body: 'ギフトごとに効果音や短い音楽を設定。届いたことを音で把握するだけでなく、ダンスやリアクションなど、ギフト連動の企画にも使えます。',
  ),
  _IntroSlide(
    icon: Icons.graphic_eq,
    title: '配信画面のまま、読み上げも効果音も',
    body: '配信するスマートフォンで読み上げと効果音をONにするだけ。1台で「配信」「コメント読み上げ」「ギフト演出」を同時に使えます。',
  ),
  _IntroSlide(
    icon: Icons.emoji_events,
    title: '応援してくれた人を、見逃さない',
    body: '貢献ランキングとギフト履歴をあとから確認。日付やリスナーで絞り込んで、誰がどれだけ応援してくれたか振り返れます。',
  ),
  _IntroSlide(
    icon: Icons.bolt,
    title: 'あのバトルを、あとから振り返る',
    body: '対戦結果や貢献者だけでなく、バトル中の流れも疑似リプレイで確認。誰が、いつ、どれだけ貢献してくれたかを振り返れます。',
  ),
];

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key, required this.phase});

  final OnboardingPhase phase;

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _formKey = GlobalKey<FormState>();
  final _tiktokHandleController = TextEditingController();
  final _pages = PageController();
  int _page = 0;

  @override
  void dispose() {
    _tiktokHandleController.dispose();
    _pages.dispose();
    super.dispose();
  }

  Future<void> _goTo(int page) {
    return _pages.animateToPage(
      page,
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOutCubic,
    );
  }

  Future<void> _finishPreLoginIntro() {
    return context.read<IntroOnboardingStore>().markCompleted();
  }

  Future<void> _preview(SessionController controller) async {
    if (!_formKey.currentState!.validate()) return;
    final preview = await controller.previewTiktokAccount(
      tiktokHandle: _tiktokHandleController.text.trim(),
    );
    if (!mounted || preview == null) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (sheetContext) => _TiktokConfirmSheet(
        preview: preview,
        onCancel: () => Navigator.of(sheetContext).pop(),
        onConfirm: () async {
          final ok = await controller.completeOnboarding(tiktokHandle: preview.tiktokHandle);
          if (!sheetContext.mounted) return;
          if (ok) Navigator.of(sheetContext).pop();
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<SessionController>();
    final isPreLogin = widget.phase == OnboardingPhase.preLoginIntro;
    final linkPageIndex = isPreLogin ? -1 : 0;
    final onLinkPage = !isPreLogin && _page == linkPageIndex;
    final pageCount = isPreLogin ? _introSlideCount : 1;
    final showSkip = isPreLogin;
    final sub = Theme.of(context).colorScheme.onSurfaceVariant;

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            children: [
              SizedBox(
                height: 48,
                child: Row(
                  children: [
                    if (showSkip)
                      TextButton(
                        onPressed: _finishPreLoginIntro,
                        child: Text(
                          'スキップ',
                          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: sub),
                        ),
                      )
                    else
                      const SizedBox(width: 72),
                    const Spacer(),
                    if (!isPreLogin)
                      PopupMenuButton<String>(
                        tooltip: 'その他',
                        icon: Icon(Icons.more_vert, size: 24, color: Theme.of(context).colorScheme.onSurface),
                        onSelected: (value) async {
                          if (value == 'logout') {
                            final confirmed = await confirmLogout(context);
                            if (!confirmed) return;
                            if (!context.mounted) return;
                            await performLogout(context);
                          } else if (value == 'delete') {
                            await confirmAndDeleteAccount(context);
                          }
                        },
                        itemBuilder: (context) => [
                          const PopupMenuItem(value: 'logout', child: Text('ログアウト')),
                          PopupMenuItem(
                            value: 'delete',
                            child: Text(
                              'アカウント削除',
                              style: TextStyle(color: Theme.of(context).colorScheme.error),
                            ),
                          ),
                        ],
                      )
                    else
                      const SizedBox(width: 48),
                  ],
                ),
              ),
              Expanded(
                child: PageView(
                  controller: _pages,
                  onPageChanged: (i) => setState(() => _page = i),
                  children: [
                    if (isPreLogin)
                      for (final slide in _introSlides) _IntroPage(slide: slide)
                    else
                      _LinkPage(
                        formKey: _formKey,
                        controller: _tiktokHandleController,
                        userName: controller.session?.userName ?? '',
                        errorMessage: controller.errorMessage,
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              _PageDots(count: pageCount, index: _page),
              const SizedBox(height: 16),
              KosaiPrimaryButton(
                label: onLinkPage ? '確認する' : '次へ',
                busy: onLinkPage && controller.isLoading,
                onPressed: controller.isLoading
                    ? null
                    : () {
                        if (onLinkPage) {
                          _preview(controller);
                        } else if (isPreLogin && _page == _introSlideCount - 1) {
                          _finishPreLoginIntro();
                        } else {
                          _goTo(_page + 1);
                        }
                      },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _IntroPage extends StatelessWidget {
  const _IntroPage({required this.slide});

  final _IntroSlide slide;

  @override
  Widget build(BuildContext context) {
    final headingStyle =
        Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 22, fontWeight: FontWeight.w700) ??
            const TextStyle(fontSize: 22, fontWeight: FontWeight.w700);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 96,
            height: 96,
            decoration: const BoxDecoration(gradient: KosaiPalette.ring, shape: BoxShape.circle),
            child: Icon(slide.icon, size: 44, color: Colors.white),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: GradientText(slide.title, style: headingStyle, textAlign: TextAlign.center),
          ),
          const SizedBox(height: 12),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 320),
            child: Text(
              slide.body,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13.5,
                height: 1.45,
                fontWeight: FontWeight.w400,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _LinkPage extends StatelessWidget {
  const _LinkPage({
    required this.formKey,
    required this.controller,
    required this.userName,
    required this.errorMessage,
  });

  final GlobalKey<FormState> formKey;
  final TextEditingController controller;
  final String userName;
  final String? errorMessage;

  @override
  Widget build(BuildContext context) {
    final headingStyle =
        Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 22, fontWeight: FontWeight.w700) ??
            const TextStyle(fontSize: 22, fontWeight: FontWeight.w700);
    return SingleChildScrollView(
      padding: const EdgeInsets.only(top: 24),
      child: Form(
        key: formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            GradientText('TikTokアカウントの連携', style: headingStyle),
            const SizedBox(height: 8),
            Text(
              'ようこそ、$userNameさん。あなたのTikTok IDを連携してください。',
              style: TextStyle(fontSize: 13.5, color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 24),
            TextFormField(
              controller: controller,
              decoration: const InputDecoration(labelText: 'TikTok ID（@なし）'),
              validator: (v) => (v == null || v.trim().isEmpty) ? 'TikTok IDを入力してください' : null,
            ),
            if (errorMessage != null) ...[
              const SizedBox(height: 12),
              Text(
                errorMessage!,
                style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 12),
            Text(
              '連携後7日間はIDを変更できません。本人のアカウントか確認してから進めてください。',
              style: TextStyle(fontSize: 10, color: Theme.of(context).colorScheme.onSurfaceVariant),
            ),
          ],
        ),
      ),
    );
  }
}

class _PageDots extends StatelessWidget {
  const _PageDots({required this.count, required this.index});

  final int count;
  final int index;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var i = 0; i < count; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            width: i == index ? 18 : 8,
            height: 8,
            decoration: BoxDecoration(
              borderRadius: const BorderRadius.all(Radius.circular(999)),
              color: i == index ? null : kosaiTrackColor(context),
              gradient: i == index ? KosaiPalette.badge : null,
            ),
          ),
        ],
      ],
    );
  }
}

class _TiktokConfirmSheet extends StatelessWidget {
  const _TiktokConfirmSheet({
    required this.preview,
    required this.onCancel,
    required this.onConfirm,
  });

  final TiktokAccountPreview preview;
  final VoidCallback onCancel;
  final VoidCallback onConfirm;

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionController>();
    final busy = session.isLoading;
    final errorMessage = session.errorMessage;
    final sub = Theme.of(context).colorScheme.onSurfaceVariant;
    final displayName = (preview.nickname == null || preview.nickname!.isEmpty)
        ? preview.tiktokHandle
        : preview.nickname!;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                GradientRing(
                  size: 64,
                  child: UserAvatar(preview.avatarUrl, size: 61),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        displayName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
                      ),
                      Text(
                        '@${preview.tiktokHandle}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 11.5, color: sub),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(child: _CountCard(label: 'フォロー', value: preview.followingCount)),
                const SizedBox(width: 8),
                Expanded(child: _CountCard(label: 'フォロワー', value: preview.followerCount)),
              ],
            ),
            if (preview.signature != null && preview.signature!.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(
                preview.signature!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11.5, color: sub),
              ),
            ],
            const SizedBox(height: 16),
            if (errorMessage != null) ...[
              Text(
                errorMessage,
                style: TextStyle(fontSize: 13, color: Theme.of(context).colorScheme.error),
              ),
              const SizedBox(height: 12),
            ],
            KosaiPrimaryButton(
              label: 'このアカウントで連携する',
              busy: busy,
              onPressed: busy ? null : onConfirm,
            ),
            const SizedBox(height: 8),
            KosaiOutlineButton(label: '戻る', onPressed: busy ? null : onCancel),
          ],
        ),
      ),
    );
  }
}

class _CountCard extends StatelessWidget {
  const _CountCard({required this.label, required this.value});

  final String label;
  final int? value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: kosaiCardColor(context),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant, width: 1),
      ),
      child: Column(
        children: [
          Text(
            label,
            style: TextStyle(fontSize: 10, color: Theme.of(context).colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 4),
          Text(
            value == null ? '-' : formatWithCommas(value!),
            style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}
