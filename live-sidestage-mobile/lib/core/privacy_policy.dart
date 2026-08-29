import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api_client.dart';

/// プライバシーポリシーの公開URL。
///
/// Apple 5.1.1(i)はApp Store Connect登録に加えてアプリ内リンクも要求するため、
/// welcome_screen.dartとsettings_tab.dartの両方から開けるようにしてある。
final Uri privacyPolicyUri = Uri.parse('$liveAnalyticsBaseUrl/privacy');

Future<void> launchPrivacyPolicy(BuildContext context) async {
  final messenger = ScaffoldMessenger.of(context);
  var opened = false;
  try {
    opened = await launchUrl(privacyPolicyUri, mode: LaunchMode.externalApplication);
  } catch (_) {
    opened = false;
  }
  if (opened) return;
  messenger.showSnackBar(SnackBar(content: Text('$privacyPolicyUri を開けませんでした。')));
}
