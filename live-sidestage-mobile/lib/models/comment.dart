/// コメントに含まれるエモート(絵文字スタンプ)1件。
///
/// [imageUrl] が null でも捨てないこと。**idさえあれば「エモート」と表示できる。**
/// [placeInComment] は将来インライン画像を出すときのための保持で、今は使っていない。
class CommentEmote {
  final String emoteId;
  final String? imageUrl;
  final int? placeInComment;

  const CommentEmote({
    required this.emoteId,
    this.imageUrl,
    this.placeInComment,
  });

  /// 1件だけ壊れていても、その1件を捨てて残りを活かす。
  static CommentEmote? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final emoteId = raw['emoteId'];
    if (emoteId is! String || emoteId.isEmpty) return null;
    final place = raw['placeInComment'];
    return CommentEmote(
      emoteId: emoteId,
      imageUrl: raw['imageUrl'] as String?,
      placeInComment: place is int ? place : null,
    );
  }

  Map<String, Object?> toMap() => {
        'emoteId': emoteId,
        'imageUrl': imageUrl,
        'placeInComment': placeInComment,
      };
}

class Comment {
  final String streamerId;
  final String uniqueId;
  final String nickname;
  final String? profilePictureUrl;

  /// TikTokが送ってきた**生の本文**。エモートの印は混ざっていない。
  /// 読み上げにはこちらを使う（[displayText] ではない）。
  final String comment;
  final DateTime receivedAt;

  /// 本文に含まれるエモート。サーバーが送ってこなければ空。
  final List<CommentEmote> emotes;

  Comment({
    required this.streamerId,
    required this.uniqueId,
    required this.nickname,
    required this.profilePictureUrl,
    required this.comment,
    required this.receivedAt,
    this.emotes = const [],
  });

  /// 画面に出す文字列。
  ///
  /// エモートだけのコメントは [comment] が空で届くので、そのまま出すと
  /// **画面に何も表示されない**。せめてエモートが来たことは見せる。
  /// 画像表示を作るときはここを差し替える（[CommentEmote.placeInComment] を保持済み）。
  String get displayText {
    if (emotes.isEmpty) return comment;
    final label = emotes.length > 1 ? '[エモート×${emotes.length}]' : '[エモート]';
    return comment.isEmpty ? label : '$comment $label';
  }

  /// 解析できない場合は null を返す。
  ///
  /// 以前は必須フィールドを直接castしていたため、想定外の型が1件混ざるだけで
  /// socketの購読callbackが例外で落ち、以降のコメントを受け取れなくなっていた。
  /// 不正な1件だけ捨てて受信を継続する。
  ///
  /// **emotes の解析失敗でコメントごと捨てないこと。** エモートは付加情報で、
  /// 本文が読めているなら表示・読み上げは成立する。
  static Comment? tryParse(Map<String, dynamic> json) {
    final streamerId = json['streamerId'];
    final uniqueId = json['uniqueId'];
    if (streamerId is! String || uniqueId is! String) return null;

    final rawEmotes = json['emotes'];
    final emotes = rawEmotes is List
        ? rawEmotes.map(CommentEmote.tryParse).whereType<CommentEmote>().toList(growable: false)
        : const <CommentEmote>[];

    return Comment(
      streamerId: streamerId,
      uniqueId: uniqueId,
      nickname: json['nickname'] as String? ?? uniqueId,
      profilePictureUrl: json['profilePictureUrl'] as String?,
      comment: json['comment'] as String? ?? '',
      receivedAt: DateTime.tryParse(json['receivedAt'] as String? ?? '') ?? DateTime.now(),
      emotes: emotes,
    );
  }

  /// バックグラウンドisolate → メインisolate の中継用。
  ///
  /// `sendDataToMain` はプリミティブと List/Map しか運べないので Map へ落とす。
  /// **[Comment.tryParse] が読める形と対称に保つこと** — 片方だけ変えると、
  /// メインisolate側でエモートが静かに消える。
  List<Map<String, Object?>> emotesToMaps() =>
      emotes.map((e) => e.toMap()).toList(growable: false);
}
