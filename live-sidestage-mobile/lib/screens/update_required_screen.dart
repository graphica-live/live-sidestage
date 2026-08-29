import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/account_deletion.dart';
import '../core/session_controller.dart';

/// 現在のアプリバージョンが `mobileMinSupportedVersion` を下回るときに、
/// 通常画面へ進ませずに表示するブロッキング画面。
///
/// **これはUI上の案内であって権限の最終防衛線ではない。** 有料機能そのものの
/// 可否判定は必ずサーバー側(requireFeature)で行う — この画面は「明らかに古い
/// クライアントで事故らせない」ための一次的な案内に過ぎない。
class UpdateRequiredScreen extends StatelessWidget {
  const UpdateRequiredScreen({super.key, required this.currentVersion});

  final String currentVersion;

  Future<void> _openStore(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    // AndroidのStoreリスティング。iOS版はこのリポジトリに存在しないため未対応
    // (defaultTargetPlatformで単純に分岐できる形にはしてあるので、iOS版を
    // 出すときはここへ App Store の URL を足せばよい)。
    final uri = Uri.parse(
      'https://play.google.com/store/apps/details?id=$androidPackageName',
    );
    var opened = false;
    try {
      opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
    if (opened) return;
    messenger.showSnackBar(SnackBar(content: Text('$uri を開けませんでした。')));
  }

  @override
  Widget build(BuildContext context) {
    final canOpenStore = defaultTargetPlatform == TargetPlatform.android;

    return Scaffold(
      // 強制アップデート待ちのままではアプリ内に他の脱出経路が無いため、
      // アカウント削除だけはこの画面からも実行できるようにしてある
      // (Apple 5.1.1(v): アプリ内のどの状態からでも削除できる必要がある)。
      appBar: AppBar(
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_forever),
            tooltip: 'アカウント削除',
            onPressed: () => confirmAndDeleteAccount(context),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.system_update, size: 48, color: Colors.grey),
                const SizedBox(height: 16),
                const Text(
                  '最新版へのアップデートが必要です',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  'このバージョン($currentVersion)は現在サポートされていません。'
                  'ストアから最新版に更新してください。',
                  style: const TextStyle(color: Colors.grey),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 32),
                if (canOpenStore)
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: FilledButton(
                      onPressed: () => _openStore(context),
                      child: const Text('ストアを開く'),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
