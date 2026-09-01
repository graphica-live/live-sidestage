import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// リスナーのTikTokプロフィールを外部ブラウザ/アプリで開く。
/// 貢献タブ・ギフト履歴タブの両方(analytics/mobile共通)で使う。
Future<void> openTiktokProfile(BuildContext context, String uniqueId) async {
  final uri = Uri.parse('https://www.tiktok.com/@${Uri.encodeComponent(uniqueId)}');
  final messenger = ScaffoldMessenger.of(context);
  var opened = false;
  try {
    // TikTokアプリ優先。未インストール時はexternalApplicationでブラウザへfallback。
    opened = await launchUrl(uri, mode: LaunchMode.externalNonBrowserApplication);
  } catch (_) {
    opened = false;
  }
  if (opened) return;
  try {
    opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    opened = false;
  }
  if (opened) return;
  messenger.showSnackBar(SnackBar(content: Text('$uri を開けませんでした。')));
}
