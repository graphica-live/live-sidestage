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
          color: Theme.of(context).colorScheme.surface,
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
