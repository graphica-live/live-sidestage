/// LIVE Sidestage Analytics の Worker が持っている TikTok Live 接続の状態。
///
/// アプリ ↔ サーバー間の socket 接続とは別物。socket が繋がっていても、
/// 配信者が配信を始めていなければ [live] は false になる。
///
/// 取得経路は2つあり、どちらも同じ形に落とす:
///
///  - push: socket の `chat:listener`（状態が変わった瞬間に届く）
///  - poll: `GET /api/mobile/listener-status`（push が落ちても必ず収束させる保険）
///
/// **新旧の判定は `(roomId, revision)` で行う。壁時計を比較しない。**
/// revision はサーバーが採番する単調増加値で、複数の Worker プロセスにまたがっても
/// 順序が保証される（DB採番の世代 × プロセス内連番）。
class ListenerStatus {
  /// この状態がどの TiktokRoom のものか。
  ///
  /// TikTok ID を変更した直後の最大60秒間、サーバー側の購読者集合の更新が追いつかず、
  /// **旧 room の Worker が同じ socket ルームへ状態を送れてしまう**。roomId が
  /// 変わったら revision の大小に関係なく作り直す。
  final String roomId;

  /// 単調増加の順序キー。bigint なので文字列で受け、比較用に [revisionValue] を持つ。
  final String revision;

  /// TikTok Live へ実際に接続できている（= 配信中）。
  final bool live;

  /// 値が古い/欠落していて、現在の状態として扱えない。
  final bool stale;

  /// `live` / `offline` / `unknown`。
  final String activity;

  /// `ok` / `connecting` / `error`。
  final String health;

  /// scheduleReconnect の reason。問い合わせ時の切り分け用。
  final String? reason;

  /// そのままユーザーへ出せる日本語。
  final String? message;

  const ListenerStatus({
    required this.roomId,
    required this.revision,
    required this.live,
    required this.stale,
    required this.activity,
    required this.health,
    this.reason,
    this.message,
  });

  /// 比較用の数値。桁が大きいので [BigInt] のまま扱う。壊れた値は 0 とみなす
  /// （0 は初期値なので、必ず「より新しい観測」に負ける）。
  BigInt get revisionValue => BigInt.tryParse(revision) ?? BigInt.zero;

  /// TikTok 側の障害としてユーザーへ見せるべき内容。無ければ null。
  ///
  /// **stale な値では出さない。** Worker が落ちて更新が止まっただけの古いエラーを
  /// 現在の障害として表示すると、永久に消えない。
  String? get problem {
    if (stale || health != 'error') return null;
    final text = message;
    return (text == null || text.isEmpty) ? 'TikTokへの接続に問題が発生しています' : text;
  }

  /// [other] がこの観測より新しいか。
  ///
  /// room が変わっていれば revision は比較できない（別の採番系ではないが、
  /// 旧 room の古い状態が新 room より大きい revision を持ちうる）ので常に採用する。
  bool isSupersededBy(ListenerStatus other) {
    if (other.roomId != roomId) return true;
    return other.revisionValue > revisionValue;
  }

  static ListenerStatus? tryParse(Map<String, dynamic> json) {
    final roomId = json['roomId'];
    if (roomId is! String || roomId.isEmpty) return null;

    final revision = json['revision'];
    if (revision is! String || BigInt.tryParse(revision) == null) return null;

    final activity = json['activity'];
    final health = json['health'];
    if (activity is! String || health is! String) return null;

    return ListenerStatus(
      roomId: roomId,
      revision: revision,
      // push には live/stale が無い（Worker のメモリ上の値なので常に「今」）。
      // その場合は activity から導く。
      live: json['live'] as bool? ?? activity == 'live',
      stale: json['stale'] as bool? ?? false,
      activity: activity,
      health: health,
      reason: json['reason'] as String?,
      message: json['message'] as String?,
    );
  }
}
