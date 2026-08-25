import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:url_launcher/url_launcher.dart';

/// VOICEVOX 本体（ソフトウェア）の利用規約。
const String voicevoxTermsUrl = 'https://voicevox.hiroshiba.jp/term/';

/// キャラクターごとの規約は配布元がばらばらで、1枚のページにまとまっていない。
/// 公式サイトのキャラクター一覧が各規約への入口なので、そのセクションへ直接送る。
const String voicevoxCharacterTermsUrl = 'https://voicevox.hiroshiba.jp/#characters';

const String voicevoxQaUrl = 'https://voicevox.hiroshiba.jp/qa/';

/// 「利用条件をすでに提示したか」の記録。
///
/// 設定と違って背景 Isolate は参照しないが、保存先は [FlutterForegroundTask] の
/// ストレージに揃える（このアプリの永続化はすべてここに集約されている）。
const String voicevoxTermsAckStorageKey = 'voicevoxTermsAcknowledged';

/// VOICEVOX 音声を二次利用するときの注意とリンクを出す。
///
/// [dismissible] を false にすると OK を押すまで閉じられない。初回提示で使う。
Future<void> showVoicevoxTermsDialog(BuildContext context, {bool dismissible = true}) {
  return showDialog<void>(
    context: context,
    barrierDismissible: dismissible,
    builder: (context) => AlertDialog(
      title: const Text('VOICEVOX音声の利用について'),
      // 小さい画面・大きい文字設定でも本文とリンクが切れないようスクロールさせる。
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: const [
            Text(
              '本アプリで生成・再生されるVOICEVOX音声を配信、動画、その他のコンテンツで'
              '利用する場合は、VOICEVOXおよび使用する各キャラクターの利用規約を'
              '遵守してください。',
            ),
            SizedBox(height: 12),
            // 3本を横一列にすると端末幅で折り返し、区切り記号だけが行末に残って
            // 読みにくい。1行1リンクで縦に積む。
            _TermsLink(label: 'VOICEVOX利用規約', url: voicevoxTermsUrl),
            _TermsLink(label: '使用キャラクターの利用規約', url: voicevoxCharacterTermsUrl),
            _TermsLink(label: 'VOICEVOX Q&A', url: voicevoxQaUrl),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('OK'),
        ),
      ],
    ),
  );
}

/// 初回だけ [showVoicevoxTermsDialog] を出す。2回目以降は何もしない。
///
/// 表示できたことを確認してから記録する（提示前にアプリが落ちたら次回また出す）。
Future<void> showVoicevoxTermsDialogOnce(BuildContext context) async {
  final acknowledged =
      await FlutterForegroundTask.getData<bool>(key: voicevoxTermsAckStorageKey) ?? false;
  if (acknowledged || !context.mounted) return;

  await showVoicevoxTermsDialog(context, dismissible: false);
  await FlutterForegroundTask.saveData(key: voicevoxTermsAckStorageKey, value: true);
}

class _TermsLink extends StatelessWidget {
  const _TermsLink({required this.label, required this.url});

  final String label;
  final String url;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.primary;
    return InkWell(
      onTap: () => _openUrl(context, url),
      child: Padding(
        // 文字のままだとタップ領域が細すぎるので少しだけ広げる。
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                label,
                style: TextStyle(
                  color: color,
                  decoration: TextDecoration.underline,
                  decorationColor: color,
                ),
              ),
            ),
            const SizedBox(width: 6),
            // 外部ブラウザで開くことを示す。
            Icon(Icons.open_in_new, size: 16, color: color),
          ],
        ),
      ),
    );
  }
}

Future<void> _openUrl(BuildContext context, String url) async {
  // await をまたいで context を触らないよう、先に取っておく。
  final messenger = ScaffoldMessenger.of(context);
  final uri = Uri.parse(url);
  var opened = false;
  try {
    // アプリ内 WebView にはしない（規約は元サイトで読んでもらう）。
    opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    opened = false;
  }
  if (opened) return;
  messenger.showSnackBar(SnackBar(content: Text('$uri を開けませんでした。')));
}
