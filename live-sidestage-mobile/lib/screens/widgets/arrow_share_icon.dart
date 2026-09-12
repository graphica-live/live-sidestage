import 'package:flutter/material.dart';

/// Web analytics の `ArrowShareIcon.tsx` と同じ SVG(512 viewBox)を描画する。
class ArrowShareIcon extends StatelessWidget {
  const ArrowShareIcon({super.key, this.size = 16, this.color});

  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final paintColor = color ?? Theme.of(context).colorScheme.onSurfaceVariant;
    return CustomPaint(
      size: Size(size, size),
      painter: _ArrowShareIconPainter(paintColor),
    );
  }
}

class _ArrowShareIconPainter extends CustomPainter {
  _ArrowShareIconPainter(this.color);

  final Color color;

  static Path _svgPath() {
    return Path()
      ..moveTo(512, 255.995)
      ..lineTo(277.045, 65.394)
      ..relativeLineTo(0, 103.574)
      ..relativeCubicTo(-17.255, 0, -36.408, 0, -57.542, 0)
      ..relativeCubicTo(-208.59, 0, -249.35, 153.44, -201.394, 266.128)
      ..relativeCubicTo(9.586, -103.098, 142.053, -100.701, 237.358, -100.701)
      ..relativeCubicTo(7.247, 0, 14.446, 0, 21.578, 0)
      ..relativeLineTo(0, 112.211)
      ..lineTo(512, 255.995)
      ..close();
  }

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.width / 512;
    canvas.save();
    canvas.scale(scale, scale);
    canvas.drawPath(
      _svgPath(),
      Paint()
        ..color = color
        ..style = PaintingStyle.fill,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _ArrowShareIconPainter oldDelegate) => oldDelegate.color != color;
}
