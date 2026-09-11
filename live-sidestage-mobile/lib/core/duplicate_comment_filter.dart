import 'package:live_sidestage_mobile/models/comment.dart';

/// 重複するコメント投稿を検知し、読み上げ抑制を判定するフィルタ。
///
/// 同一配信者からの同じ内容のコメント投稿が短時間（detectionWindow以内）に
/// 複数回来た場合、2回目以降の投稿は読み上げを抑制する。
///
/// ⚠️ **重要**: 1コメントにつき `shouldSuppress()` を**1回だけ**呼ぶこと。
/// 複数回呼ぶと判定が狂う。
class DuplicateCommentFilter {
  /// 重複判定の時間窓（この期間内に同じ内容が複数来たら「重複」と見なす）
  final Duration detectionWindow;

  /// 重複判定された場合の抑制期間（この期間中は3回目以降の投稿を読み上げない）
  final Duration suppressionDuration;

  /// 各キーの直前出現時刻。キー: `'$streamerId|$speechText'`
  final Map<String, DateTime> _lastSeenAt = {};

  /// 各キーの抑制終了時刻。キー: `'$streamerId|$speechText'`
  final Map<String, DateTime> _suppressUntil = {};

  DuplicateCommentFilter({
    this.detectionWindow = const Duration(minutes: 10),
    this.suppressionDuration = const Duration(minutes: 10),
  });

  /// このコメントが読み上げ抑制対象かどうかを判定する。
  ///
  /// 副作用あり: 呼び出すたびに内部履歴が更新される。
  ///
  /// - **1回目**: false を返す（読み上げる）
  /// - **2回目（detectionWindow内）**: false を返す。ただし抑制カウンタを開始
  /// - **3回目以降（detectionWindow内かつ抑制期間中）**: true を返す（読み上げない）
  /// - **抑制期間満了後**: false を返す。カウンタをリセット
  ///
  /// パラメータ [now] を指定しない場合は `DateTime.now()` を使用。
  /// テスト以外では指定不要。
  bool shouldSuppress(Comment comment, {DateTime? now}) {
    now ??= DateTime.now();

    final key = _buildKey(comment);

    // 期限切れのエントリを掃除
    _cleanup(now);

    // 現在も抑制中なら true
    if (_suppressUntil.containsKey(key)) {
      final suppressUntilTime = _suppressUntil[key]!;
      if (now.isBefore(suppressUntilTime)) {
        return true;
      }
      // 抑制期間が終わったので、クリア
      _suppressUntil.remove(key);
      _lastSeenAt.remove(key);
    }

    // 直前出現を記録
    final previousTime = _lastSeenAt[key];
    _lastSeenAt[key] = now;

    // 直前出現がなければ1回目 → false
    if (previousTime == null) {
      return false;
    }

    // 直前出現からの経過時間がdetectionWindow以内か
    final elapsed = now.difference(previousTime);
    if (elapsed.abs() <= detectionWindow) {
      // 2回目の投稿。次から抑制開始
      _suppressUntil[key] = now.add(suppressionDuration);
      return false;
    }

    // detectionWindow を超えたので新規サイクル扱い → false
    return false;
  }

  /// 内部状態をリセット（テスト用）。
  void reset() {
    _lastSeenAt.clear();
    _suppressUntil.clear();
  }

  /// 判定キーを生成。
  String _buildKey(Comment comment) {
    return '${comment.streamerId}|${comment.speechText}';
  }

  /// 期限切れのエントリを削除。
  ///
  /// - _lastSeenAt: detectionWindow 超過分
  /// - _suppressUntil: 期限超過分
  void _cleanup(DateTime now) {
    // _lastSeenAt から古い出現を削除
    _lastSeenAt.removeWhere((key, time) {
      return now.difference(time).abs() > detectionWindow;
    });

    // _suppressUntil から期限切れを削除
    _suppressUntil.removeWhere((key, suppressUntilTime) {
      return now.isAfter(suppressUntilTime) || now.isAtSameMomentAs(suppressUntilTime);
    });
  }
}
