import { NextRequest, NextResponse } from "next/server";
import { resolveUserByMobileToken } from "@/lib/mobile-auth";
import { prisma } from "@/lib/prisma";
import { appleConfig, revokeAppleToken } from "@/lib/apple-auth";
import { APPLE_PROVIDER } from "@/lib/apple-account";
import { deleteStripeCustomer } from "@/lib/stripe";
import { cancelSubscription as cancelGoogleSubscription } from "@/lib/google-play";

// Userごとに結果が変わる破壊的操作のため、CDN/共有キャッシュは不可。
export const dynamic = "force-dynamic";

/// モバイルアプリからのアカウント削除。Apple App Store審査ガイドライン5.1.1(v)対応。
///
/// **アカウント削除は常に受け付ける(ストア契約の解約を条件にしない)。** Appleガイドライン
/// 5.1.1(v)はアプリ内アカウント削除を必ず提供することを求めており、ストア解約を条件にした
/// 削除ブロックは審査リスクになる(Codexレビュー指摘で発見)。GOOGLE_PLAYの有効な契約は
/// サーバー側解約APIが実在するためここで実解約する。APPLEにはサーバー側解約APIが無いため、
/// 削除完了メッセージで「Appleの定期購読は別途App Storeから解約が必要」と案内するに留める。
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
      stripeCustomerLink: { select: { stripeCustomerId: true } },
      // entitlementActive:trueだけに絞ると、PAUSED/ON_HOLD等の非終端状態(現在は
      // entitlementが無いが復帰・再課金し得る)やinit後まだ確定していない購入を
      // 解約・通知対象から取りこぼす(実装後レビュー指摘)。EXPIRED/REVOKED以外の
      // GOOGLE_PLAY/APPLE行は全て対象にする(GOOGLE_PLAYのcancelはベストエフォートかつ
      // 既にキャンセル済みへ再度呼んでも実害が無い)。
      subscriptions: {
        where: {
          provider: { in: ["GOOGLE_PLAY", "APPLE"] },
          // Google: rawStatusはSubscriptionState文字列(SUBSCRIPTION_STATE_EXPIRED/_REVOKED)。
          // Apple: rawStatusはAppStore.Status数値の文字列化("2"=EXPIRED, "5"=REVOKED)。
          NOT: { rawStatus: { in: ["SUBSCRIPTION_STATE_EXPIRED", "SUBSCRIPTION_STATE_REVOKED", "2", "5"] } },
        },
        select: { provider: true, providerSubscriptionId: true, googleProductId: true },
      },
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
  if (user.stripeCustomerLink?.stripeCustomerId) {
    try {
      await deleteStripeCustomer(user.stripeCustomerLink.stripeCustomerId);
    } catch (error) {
      console.error(`[mobile/account] failed to delete stripe customer for user ${user.id}`, error);
      return NextResponse.json(
        { error: "決済情報の削除に失敗しました。しばらくしてから再度お試しください" },
        { status: 500 },
      );
    }
  }

  // Google Playの有効な契約はサーバー側APIで実解約する(fail-closedにはしない —
  // Google側の一時的な障害でアカウント削除自体ができなくなるのを避ける。次回更新まで
  // 課金が続く可能性は残るが、ユーザーには削除完了メッセージで案内する)。
  let appleSubscriptionRemains = false;
  for (const sub of user.subscriptions) {
    if (sub.provider === "GOOGLE_PLAY" && sub.providerSubscriptionId && sub.googleProductId) {
      try {
        await cancelGoogleSubscription(sub.providerSubscriptionId, sub.googleProductId);
      } catch (error) {
        console.error(`[mobile/account] failed to cancel google subscription for user ${user.id}`, error);
      }
    }
    if (sub.provider === "APPLE") {
      appleSubscriptionRemains = true;
    }
  }

  // cascadeでAccount/Session/Subscription/Streamer以下が連鎖削除される。
  // Event.ownerUserIdはFKが無いため触れずそのまま残る(上記コメント参照)。
  await prisma.user.delete({ where: { id: user.id } });

  return NextResponse.json({
    ok: true,
    ...(appleSubscriptionRemains
      ? { notice: "Appleの定期購読は別途App Storeから解約が必要です" }
      : {}),
  });
}
