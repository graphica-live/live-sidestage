import { NextRequest, NextResponse } from "next/server";
import { resolveUserByMobileToken } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { appleConfig, revokeAppleToken } from "@/lib/apple-auth";
import { APPLE_PROVIDER } from "@/lib/apple-account";
import { deleteStripeCustomer } from "@/lib/stripe";

// Userごとに結果が変わる破壊的操作のため、CDN/共有キャッシュは不可。
export const dynamic = "force-dynamic";

/// モバイルアプリからのアカウント削除。Apple App Store審査ガイドライン5.1.1(v)対応。
///
/// **`Event.ownerUserId`には触れない。** FKなしの論理参照で、Eventは主催者1人の
/// 持ち物ではなく他の参加者・観戦者にとっての公開データのため、削除後は
/// 「誰にも編集できないイベントとして残る」だけにする(自動削除も409拒否もしない)。
/// 保持理由は /privacy に明記してある。
export async function DELETE(req: NextRequest) {
  // resolveActiveMobileUser() は「署名が無効」と「署名は有効だがUserが既に居ない」を
  // どちらもnullに畳んでしまい、401にすべきか200(冪等)にすべきか区別できない。
  // ここでは署名検証だけ先に済ませ、DB照会は自前で行う。
  const payload = resolveUserByMobileToken(req);
  if (!payload) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      accounts: {
        where: { provider: APPLE_PROVIDER },
        select: { refresh_token: true, appleClientId: true },
      },
      subscription: { select: { stripeCustomerId: true } },
    },
  });

  // 署名は有効だがUserが既に存在しない = 削除リクエストの再送
  // (クライアントは応答喪失後タイムアウトで再送し得る)。冪等に成功扱いする。
  if (!user) {
    return NextResponse.json({ ok: true });
  }

  // Appleの認可取り消し。ベストエフォート — 失敗してもアカウント削除自体は続行する
  // (Apple側の障害・移行前ユーザーのrefresh_token欠如で退会自体ができなくなるのを避ける)。
  const appleAccount = user.accounts[0];
  if (appleAccount?.refresh_token && appleAccount.appleClientId) {
    const config = appleConfig();
    if (config) {
      try {
        await revokeAppleToken(config, {
          refreshToken: appleAccount.refresh_token,
          clientId: appleAccount.appleClientId,
        });
      } catch (error) {
        console.error(`[mobile/account] failed to revoke apple token for user ${user.id}`, error);
      }
    }
  }

  // Stripeの解約は fail-closed。課金を残したままアカウントだけ消えるのを避けるため、
  // ここが失敗したら削除全体を中断する(Apple revokeとは逆にベストエフォートにしない)。
  if (user.subscription?.stripeCustomerId) {
    try {
      await deleteStripeCustomer(user.subscription.stripeCustomerId);
    } catch (error) {
      console.error(`[mobile/account] failed to delete stripe customer for user ${user.id}`, error);
      return NextResponse.json(
        { error: "決済情報の削除に失敗しました。しばらくしてから再度お試しください" },
        { status: 500 },
      );
    }
  }

  // cascadeでAccount/Session/Subscription/Streamer以下が連鎖削除される。
  // Event.ownerUserIdはFKが無いため触れずそのまま残る(上記コメント参照)。
  await prisma.user.delete({ where: { id: user.id } });

  return NextResponse.json({ ok: true });
}
