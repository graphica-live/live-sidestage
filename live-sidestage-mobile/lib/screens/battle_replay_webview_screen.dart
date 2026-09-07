import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// バトル再生画面。web版の公開共有ページ`/b/[token]`をそのまま表示するだけで、
/// スコア曲線・ギフト演出等の再生UIロジックはDartへ移植しない(クライアントJS依存)。
class BattleReplayWebViewScreen extends StatefulWidget {
  const BattleReplayWebViewScreen({super.key, required this.url});

  final String url;

  @override
  State<BattleReplayWebViewScreen> createState() => _BattleReplayWebViewScreenState();
}

class _BattleReplayWebViewScreenState extends State<BattleReplayWebViewScreen> {
  late final WebViewController _controller;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      // 公開ページ(PublicBattleClient.tsx)はuseStateを使うClient Componentで、
      // 再生/一時停止・シークバー等の操作がクライアントJavaScriptに依存するため必須。
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..loadRequest(Uri.parse(widget.url));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: WebViewWidget(controller: _controller),
    );
  }
}
