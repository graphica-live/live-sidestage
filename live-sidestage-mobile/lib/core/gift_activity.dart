import 'dart:async';

import 'package:flutter/foundation.dart';

/// ギフト受信の通知を受けたタブが取るべき行動。
enum GiftAutoReloadAction {
  /// 何もしない。
  ignore,

  /// 今は取りに行かず、次にタブが見えたとき／前面へ戻ったときに1回だけ取り直す。
  defer,

  /// すぐ取り直す。
  reload,
}

/// [GiftAutoReloadAction] の判定。**純関数**にしてあるのは、ここが一番間違えやすく、
/// widget ごと動かさないと確かめられない形にしたくないため。
///
/// - 過去の期間を見ているときは [GiftAutoReloadAction.ignore]。取り直すと
///   **過去の数字が勝手に動いたように見える**
/// - 画面が見えていない／アプリが前面に無いときは [GiftAutoReloadAction.defer]。
///   見ていない間ずっと通信し続けない
GiftAutoReloadAction giftAutoReloadAction({
  required bool active,
  required bool resumed,
  required bool containsToday,
}) {
  if (!containsToday) return GiftAutoReloadAction.ignore;
  if (!active || !resumed) return GiftAutoReloadAction.defer;
  return GiftAutoReloadAction.reload;
}

/// 「ギフトが届いた」ことだけを画面側へ伝える通知。
///
/// **数値は一切持たない。** 貢献・ギフト履歴の数字の正はサーバーの集計だけで、
/// 端末で積算してはいけない。`chat:gift` は `saveGift()` の成否に紐づかず emit され
/// （tiktok-listener.ts）、`baselineReset` のときは delta が 1 に切り詰められる
/// （chat-feed.ts の decideComboDelta）ので、**socket の値を積むと DB と恒久的にズレ、
/// しかも自己修復しない**。ここは「取りに行き直すきっかけ」に徹する。
class GiftActivityNotifier extends ChangeNotifier {
  GiftActivityNotifier({
    this.debounce = const Duration(seconds: 2),
    this.maxWait = const Duration(seconds: 6),
  });

  /// 最後のギフトから、これだけ待ってから通知する。
  ///
  /// **0 にしてはいけない。** socket の emit と DB への保存は独立・非同期で、
  /// コンボは groupId ごとに advisory lock で直列化される。通知が届いた時点では
  /// 対応する Gift 行がまだ無いのが普通なので、取りに行っても古い数字が返る。
  final Duration debounce;

  /// 連打が続いている間も、これを超えたら必ず1回通知する。
  ///
  /// debounce だけだと長いコンボの間ずっと更新されず、「即反映」にならない。
  final Duration maxWait;

  /// 通知した回数。購読側はこの値の変化を見る（値そのものに意味は無い）。
  int get revision => _revision;
  int _revision = 0;

  /// 最後のギフトから [debounce] 後に発火する。ギフトが来るたび張り直す。
  Timer? _debounceTimer;

  /// 最初のギフトから [maxWait] 後に発火する。**張り直さない。**
  Timer? _maxWaitTimer;

  bool _disposed = false;

  /// ギフトが1件届いた。連打中は何度でも呼ばれる。
  ///
  /// 経過時間は `DateTime.now()` ではなく Timer で測る。前者はテストの疑似時計が
  /// 動かせず、**この待ち時間の挙動を単体テストできない形になる**。
  void onGiftTick() {
    if (_disposed) return;

    _debounceTimer?.cancel();
    _debounceTimer = Timer(debounce, _fire);
    // 連打が続く限り debounce は延び続けるので、こちらが天井になる。
    _maxWaitTimer ??= Timer(maxWait, _fire);
  }

  void _fire() {
    _debounceTimer?.cancel();
    _debounceTimer = null;
    _maxWaitTimer?.cancel();
    _maxWaitTimer = null;
    if (_disposed) return;
    _revision++;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _debounceTimer?.cancel();
    _debounceTimer = null;
    _maxWaitTimer?.cancel();
    _maxWaitTimer = null;
    super.dispose();
  }
}
