import 'package:flutter/material.dart';

/// 「光彩」ブランドの装飾グラデーション3色。状態伝達色(green/orange/red/grey)とは
/// 別レイヤーで、バッジ・見出し文字・メダル・カード枠など装飾要素にのみ使う
/// (`.impeccable/approved/home-screen-kosai/spec.md` 未解決事項1)。
class KosaiPalette {
  const KosaiPalette._();

  static const c1 = Color(0xFFFF7A59); // コーラル
  static const c2 = Color(0xFF9B6BFF); // バイオレット
  static const c3 = Color(0xFF2FC6A0); // ミント

  static const badge = LinearGradient(colors: [c1, c2]);
  static const rank1 = LinearGradient(colors: [c1, c2], begin: Alignment.topLeft, end: Alignment.bottomRight);
  static const rank2 = LinearGradient(colors: [c2, c3], begin: Alignment.topLeft, end: Alignment.bottomRight);
  static const rank3 = LinearGradient(colors: [c3, c1], begin: Alignment.topLeft, end: Alignment.bottomRight);
  static const ring = LinearGradient(colors: [c1, c2], begin: Alignment.topLeft, end: Alignment.bottomRight);
  static const border = LinearGradient(
    colors: [c1, c2, c3],
    begin: Alignment(-0.7, -0.7),
    end: Alignment(0.7, 0.7),
  );

  /// バトルスコア・シートの値表示(comp `.team-score.grad` / `.battle-score.grad`)。
  static const score = LinearGradient(colors: [c1, c3]);

  /// 勝利バッジ(comp `.win-badge.grad`)。
  static const win = LinearGradient(colors: [c3, c2]);

  /// スイッチOFF・スライダー非活性・音量メーターOFFの共通トラック色(comp `#E5DFE8`)。
  static const track = Color(0xFFE5DFE8);

  /// パネル内の行区切り(comp `#F1EBEE`)。ライトのみ。ダークはテーマの outlineVariant。
  static const rowDivider = Color(0xFFF1EBEE);
}

/// `.impeccable/approved/_kosai-tokens.md` の card トークン(#FFFFFF / dark #1F1B24)。
///
/// **`colorScheme.surface` は画面背景(bg)** なので、白いカード面には使えない。
/// テーマの `cardTheme.color` に card 色を入れてあるので、生の `Container` からは
/// これを通して引く。
Color kosaiCardColor(BuildContext context) {
  final theme = Theme.of(context);
  return theme.cardTheme.color ?? theme.colorScheme.surface;
}

/// パネル内の行区切り色。
Color kosaiRowDividerColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
        ? Theme.of(context).colorScheme.outlineVariant
        : KosaiPalette.rowDivider;

/// スイッチOFF・メーターOFFのトラック色。
Color kosaiTrackColor(BuildContext context) =>
    Theme.of(context).brightness == Brightness.dark
        ? Theme.of(context).colorScheme.outlineVariant
        : KosaiPalette.track;

/// パネル/カードの共通影(spec: `rgba(155,107,255,.12)` blur22 offset(0,8) spread -18)。
const List<BoxShadow> kosaiPanelShadow = [
  BoxShadow(color: Color(0x1F9B6BFF), blurRadius: 22, offset: Offset(0, 8), spreadRadius: -18),
];

/// タブ・画面のセクション見出し(comp `.sec-title.grad`)。
/// グラデ文字22dp w700 + padding 横16dp・上16dp・下8dp。
class KosaiSectionHeading extends StatelessWidget {
  const KosaiSectionHeading(this.label, {super.key, this.top = 16, this.bottom = 8, this.subtitle});

  final String label;
  final double top;
  final double bottom;

  /// 見出しの直下に出す補助文(11dp sub)。null なら出さない。
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final sub = subtitle;
    final headingStyle =
        Theme.of(context).textTheme.titleLarge?.copyWith(fontSize: 22, fontWeight: FontWeight.w700) ??
            const TextStyle(fontSize: 22, fontWeight: FontWeight.w700);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, top, 16, sub == null ? bottom : 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          GradientText(label, style: headingStyle),
          if (sub != null)
            Padding(
              padding: EdgeInsets.only(top: 2, bottom: bottom - 2 < 0 ? 0 : bottom - 2),
              child: Text(
                sub,
                style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.onSurfaceVariant),
              ),
            ),
        ],
      ),
    );
  }
}

/// 主要アクション(comp `.btn-primary-grad`)。
/// 全幅・角丸999・`badge`グラデーション・白文字17dp w800・glow影。
///
/// Flutter標準の`FilledButton`はグラデーション背景を持てず、テーマの角丸も18pxなので
/// 再現できない(spec `_kosai-tokens.md` §4)。
class KosaiPrimaryButton extends StatelessWidget {
  const KosaiPrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.busy = false,
    this.verticalPadding = 18,
    this.fontSize = 17,
    this.gradient,
    this.color,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool busy;
  final double verticalPadding;
  final double fontSize;

  /// 既定は `KosaiPalette.badge`。
  final Gradient? gradient;

  /// 単色で塗りたいとき(停止ボタンの danger など)。指定すると[gradient]より優先する。
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !busy;
    final fill = color;
    return Opacity(
      opacity: enabled ? 1 : 0.45,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: fill == null ? (gradient ?? KosaiPalette.badge) : null,
          color: fill,
          borderRadius: const BorderRadius.all(Radius.circular(999)),
          boxShadow: const [
            BoxShadow(color: Color(0x8C9B6BFF), blurRadius: 22, offset: Offset(0, 10), spreadRadius: -10),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: const BorderRadius.all(Radius.circular(999)),
          child: InkWell(
            borderRadius: const BorderRadius.all(Radius.circular(999)),
            onTap: enabled ? onPressed : null,
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: verticalPadding, horizontal: 16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (busy)
                    const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  else if (icon != null)
                    Icon(icon, size: fontSize + 3, color: Colors.white),
                  if (busy || icon != null) const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      label,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: Colors.white, fontSize: fontSize, fontWeight: FontWeight.w800),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 副次アクション(comp `.btn-secondary-outline`)。角丸999・card背景・c2の1.5dp枠。
class KosaiOutlineButton extends StatelessWidget {
  const KosaiOutlineButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.verticalPadding = 14,
    this.horizontalPadding = 16,
    this.fontSize = 15,
    this.expand = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final double verticalPadding;
  final double horizontalPadding;
  final double fontSize;

  /// false なら文字幅に合わせて縮める(設定タブの「アップグレード」など)。
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final button = Opacity(
      opacity: onPressed == null ? 0.45 : 1,
      child: Material(
        color: kosaiCardColor(context),
        shape: const StadiumBorder(side: BorderSide(color: KosaiPalette.c2, width: 1.5)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          child: Padding(
            padding: EdgeInsets.symmetric(vertical: verticalPadding, horizontal: horizontalPadding),
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: TextStyle(color: KosaiPalette.c2, fontSize: fontSize, fontWeight: FontWeight.w800),
            ),
          ),
        ),
      ),
    );
    return expand ? SizedBox(width: double.infinity, child: button) : button;
  }
}

/// 破壊的操作(comp `.btn-danger`)。角丸14dp・card背景・error色の1.5dp枠。
class KosaiDangerButton extends StatelessWidget {
  const KosaiDangerButton({super.key, required this.label, required this.onPressed});

  final String label;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final err = Theme.of(context).colorScheme.error;
    return SizedBox(
      width: double.infinity,
      child: Material(
        color: kosaiCardColor(context),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: err, width: 1.5),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onPressed,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
            child: Text(
              label,
              textAlign: TextAlign.center,
              style: TextStyle(color: err, fontSize: 14, fontWeight: FontWeight.w700),
            ),
          ),
        ),
      ),
    );
  }
}

/// 右下固定の拡張FAB(comp `.fab-ext`)。標準の`FloatingActionButton.extended`は
/// 単色しか塗れないため自前で組む。
class KosaiExtendedFab extends StatelessWidget {
  const KosaiExtendedFab({super.key, required this.label, required this.onPressed, this.dimmed = false});

  final String label;
  final VoidCallback? onPressed;

  /// ロック中・上限到達時。**押下は禁止せず**薄くするだけ(理由はタップ時に伝える)。
  final bool dimmed;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: dimmed ? 0.45 : 1,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: KosaiPalette.ring,
          borderRadius: BorderRadius.all(Radius.circular(999)),
          boxShadow: [
            BoxShadow(color: Color(0x8C9B6BFF), blurRadius: 24, offset: Offset(0, 12), spreadRadius: -8),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: const BorderRadius.all(Radius.circular(999)),
          child: InkWell(
            borderRadius: const BorderRadius.all(Radius.circular(999)),
            onTap: onPressed,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 22),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.add, size: 19, color: Colors.white),
                  const SizedBox(width: 8),
                  Text(
                    label,
                    style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w800),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// スライダーのつまみ(comp `.mini-slider .thumb`)。
/// 直径16dpの白丸に2dpのc2枠+薄い影。標準の`RoundSliderThumbShape`は枠線を
/// 描けないため専用に用意する。
class KosaiSliderThumbShape extends SliderComponentShape {
  const KosaiSliderThumbShape({this.radius = 8, this.borderWidth = 2});

  final double radius;
  final double borderWidth;

  @override
  Size getPreferredSize(bool isEnabled, bool isDiscrete) => Size.fromRadius(radius);

  @override
  void paint(
    PaintingContext context,
    Offset center, {
    required Animation<double> activationAnimation,
    required Animation<double> enableAnimation,
    required bool isDiscrete,
    required TextPainter labelPainter,
    required RenderBox parentBox,
    required SliderThemeData sliderTheme,
    required TextDirection textDirection,
    required double value,
    required double textScaleFactor,
    required Size sizeWithOverflow,
  }) {
    final canvas = context.canvas;
    canvas.drawCircle(
      center.translate(0, 1),
      radius,
      Paint()
        ..color = const Color(0x33000000)
        ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2),
    );
    canvas.drawCircle(center, radius, Paint()..color = Colors.white);
    canvas.drawCircle(
      center,
      radius - borderWidth / 2,
      Paint()
        ..color = KosaiPalette.c2
        ..style = PaintingStyle.stroke
        ..strokeWidth = borderWidth,
    );
  }
}

/// 期間フィルタ・効果音セットで共通のchip(comp `.chip`)。
/// 選択中は`badge`グラデーション、非選択はcard+1dp枠、追加系は破線枠。
class KosaiChip extends StatelessWidget {
  const KosaiChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.onLongPress,
    this.dashed = false,
    this.locked = false,
    this.dimmed = false,
    this.maxWidth,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// 「カスタム」「＋追加」のような破線枠のchip。
  final bool dashed;

  /// プラン制限で選べない。ラベルの後ろに錠アイコンを出す(押下自体は止めない)。
  final bool locked;

  final bool dimmed;
  final double? maxWidth;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fg = selected
        ? Colors.white
        : dashed
            ? scheme.onSurfaceVariant
            : scheme.onSurface;

    Widget content = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Flexible(
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: fg),
          ),
        ),
        if (locked) ...[
          const SizedBox(width: 4),
          Icon(Icons.lock_outline, size: 12, color: fg),
        ],
      ],
    );
    if (maxWidth != null) {
      content = ConstrainedBox(constraints: BoxConstraints(maxWidth: maxWidth!), child: content);
    }

    return Opacity(
      opacity: dimmed ? 0.45 : 1,
      child: GestureDetector(
        onLongPress: onLongPress,
        child: DecoratedBox(
          decoration: BoxDecoration(
            gradient: selected ? KosaiPalette.badge : null,
            color: selected ? null : kosaiCardColor(context),
            borderRadius: const BorderRadius.all(Radius.circular(999)),
            border: selected ? null : Border.all(color: scheme.outlineVariant),
          ),
          child: Material(
            color: Colors.transparent,
            borderRadius: const BorderRadius.all(Radius.circular(999)),
            child: InkWell(
              borderRadius: const BorderRadius.all(Radius.circular(999)),
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 12),
                child: content,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// 複数アバターを少しずつ重ねる(comp `.avatar-stack`)。
/// バトル履歴の陣営表示で使う。先頭[maxShown]件まで。
class KosaiAvatarStack extends StatelessWidget {
  const KosaiAvatarStack({
    super.key,
    required this.children,
    this.size = 26,
    this.borderColor,
    this.maxShown = 3,
  });

  /// 1件ぶんのアバターウィジェット(`UserAvatar`など)。
  final List<Widget> children;
  final double size;

  /// 枠の色。自陣は c2、相手陣は card 色(comp `.avatar-stack .av` の白2px枠)。
  final Color? borderColor;
  final int maxShown;

  static const double _borderWidth = 2;

  @override
  Widget build(BuildContext context) {
    final items = children.take(maxShown).toList();
    if (items.isEmpty) return SizedBox(width: size, height: size);
    final border = borderColor ?? kosaiCardColor(context);
    final overlap = size * 0.38;

    Widget wrap(Widget child) => Container(
          width: size,
          height: size,
          padding: const EdgeInsets.all(_borderWidth),
          decoration: BoxDecoration(color: border, shape: BoxShape.circle),
          child: ClipOval(child: child),
        );

    if (items.length == 1) return wrap(items.first);

    final step = size - overlap;
    return SizedBox(
      width: size + step * (items.length - 1),
      height: size,
      child: Stack(
        children: [
          for (var i = 0; i < items.length; i++) Positioned(left: step * i, child: wrap(items[i])),
        ],
      ),
    );
  }
}

/// グラデーション文字。spec.mdの「タブ見出し」「サマリーカードの合計値」で使う。
/// Flutter標準の`Text`ではグラデーション文字を表現できないため`ShaderMask`で実現する。
class GradientText extends StatelessWidget {
  const GradientText(this.text, {super.key, required this.style, this.gradient = KosaiPalette.badge});

  final String text;
  final TextStyle style;
  final Gradient gradient;

  @override
  Widget build(BuildContext context) {
    return ShaderMask(
      blendMode: BlendMode.srcIn,
      shaderCallback: (bounds) => gradient.createShader(Rect.fromLTWH(0, 0, bounds.width, bounds.height)),
      child: Text(text, style: style.copyWith(color: Colors.white)),
    );
  }
}

/// 「グラデーション2px枠+白い内側カード」の二重構造(spec.mdのサマリーカード)。
/// 単純な`border`では再現できないため、外側にグラデーション背景、内側に不透明カードを重ねる。
class GradientBorderCard extends StatelessWidget {
  const GradientBorderCard({
    super.key,
    required this.child,
    this.outerRadius = 20,
    this.innerRadius = 18,
    this.borderWidth = 2,
    this.padding = const EdgeInsets.all(16),
    this.gradient = KosaiPalette.border,
  });

  final Widget child;
  final double outerRadius;
  final double innerRadius;
  final double borderWidth;
  final EdgeInsetsGeometry padding;
  final Gradient gradient;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.all(borderWidth),
      decoration: BoxDecoration(gradient: gradient, borderRadius: BorderRadius.circular(outerRadius)),
      child: Container(
        padding: padding,
        decoration: BoxDecoration(
          color: kosaiCardColor(context),
          borderRadius: BorderRadius.circular(innerRadius),
        ),
        child: child,
      ),
    );
  }
}

/// グラデーションの円形リング(spec.mdのアバター枠)。中身は既存`UserAvatar`をそのまま渡す。
class GradientRing extends StatelessWidget {
  const GradientRing({super.key, required this.child, this.size = 30, this.ringWidth = 1.5});

  final Widget child;
  final double size;
  final double ringWidth;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      padding: EdgeInsets.all(ringWidth),
      decoration: const BoxDecoration(gradient: KosaiPalette.ring, shape: BoxShape.circle),
      child: ClipOval(child: child),
    );
  }
}

/// 1〜3位のグラデーションメダル。4位以下は呼び出し側でプレーンな数字を出す。
class GradientMedal extends StatelessWidget {
  const GradientMedal({super.key, required this.rank, this.size = 26});

  final int rank;
  final double size;

  static const _gradients = {1: KosaiPalette.rank1, 2: KosaiPalette.rank2, 3: KosaiPalette.rank3};

  @override
  Widget build(BuildContext context) {
    final gradient = _gradients[rank];
    if (gradient == null) {
      return SizedBox(
        width: size,
        child: Text('$rank', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w600)),
      );
    }
    return Opacity(
      opacity: rank == 3 ? 0.85 : 1,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(gradient: gradient, shape: BoxShape.circle),
        alignment: Alignment.center,
        child: Text(
          '$rank',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: size * 0.42),
        ),
      ),
    );
  }
}
