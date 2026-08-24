import type { Env } from '../../_types';

// TikRing 単体の Pro サブスクは新規受付を停止した。
// UI 側（Home.tsx）の導線は無効化済みだが、このエンドポイントは到達可能なまま残っており、
// ログインさえあれば Stripe Checkout セッションを作れてしまう状態だったので、サーバ側でも塞ぐ。
//
// 既存契約者のために cancel / sync / webhook は残す。donate は Pro と無関係なので残す。
// 実装本体は git 履歴に残してあり、再開する場合はそこから戻す。
export const onRequestPost: PagesFunction<Env> = async () => {
  return new Response(
    JSON.stringify({ error: 'CHECKOUT_DISABLED' }),
    {
      status: 410,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
};
