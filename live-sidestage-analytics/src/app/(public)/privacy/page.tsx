import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "プライバシーポリシー | LIVE Sidestage",
  description: "LIVE Sidestage / LIVE Sidestage Analytics のプライバシーポリシー",
};

const UPDATED_AT = "2026-08-29";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-neutral-300">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-white">プライバシーポリシー</h1>
      <p className="mt-2 text-xs text-neutral-500">最終更新日: {UPDATED_AT}</p>

      <div className="mt-8 space-y-10">
        <Section title="1. 取得する情報">
          <p>
            LIVE Sidestage（モバイルアプリ）および LIVE Sidestage
            Analytics（配信者向けダッシュボード）は、サービス提供のために以下の情報を取得します。
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-neutral-100">Googleアカウントでログインした場合:</strong>{" "}
              氏名、メールアドレス、プロフィール画像、Google発行のアカウント識別子(provider
              ID)を取得します。
            </li>
            <li>
              <strong className="text-neutral-100">Appleアカウントでログインした場合:</strong>{" "}
              Apple発行のアカウント識別子(sub)、メールアドレス(Appleの非公開リレーアドレスの場合を含む)、氏名を取得します。氏名やメールアドレスはApple側の設定により共有されない場合があります。
            </li>
            <li>
              <strong className="text-neutral-100">TikTok連携情報:</strong>{" "}
              配信者ご自身が登録するTikTokアカウントのIDを取得し、配信データの取得に利用します。
            </li>
            <li>
              <strong className="text-neutral-100">TikTok LIVE配信中に取得する視聴者側の情報:</strong>{" "}
              配信中にTikTok
              LIVEから受信するニックネーム、TikTokユーザーID、コメント本文、ギフトの種類・回数を取得します。これらは配信画面へのリアルタイム表示・集計を目的としたもので、視聴者自身によるアプリの利用ではありません。
            </li>
            <li>
              <strong className="text-neutral-100">イベント(大会)機能利用時の情報:</strong>{" "}
              大会への参加登録情報、対戦の公開結果、大会カバー画像を取得します。
            </li>
            <li>
              <strong className="text-neutral-100">決済情報:</strong>{" "}
              有料プランのお支払いはStripe社が処理し、カード番号などの決済情報自体は当社では保持しません。取引記録は法令に基づき保存されます。
            </li>
          </ul>
        </Section>

        <Section title="2. 情報の利用目的">
          <ul className="list-disc space-y-2 pl-5">
            <li>アカウントの認証・本人確認</li>
            <li>TikTok LIVE配信中のギフト・コメントの集計およびリアルタイム表示</li>
            <li>イベント(大会)の運営、参加者への結果表示</li>
            <li>有料プランの決済処理</li>
            <li>サービスの維持・不正利用の防止</li>
          </ul>
        </Section>

        <Section title="3. 第三者への提供・共有">
          <p>
            取得した情報は、決済処理を行うStripe社への提供を除き、法令に基づく場合を除いて第三者へ提供しません。
          </p>
          <p>
            TikTok
            LIVEの配信データ(視聴者コメント・ギフト等)は、同一TikTokアカウントを登録した複数の利用者間で共有される場合があります。これはTikTok
            LIVE配信そのものが公開情報であるためです。
          </p>
        </Section>

        <Section title="4. データの保持期間・削除">
          <p>
            アカウントに紐づく個人情報は、アプリ内の「アカウント削除」機能によりいつでも削除を申請できます。削除操作を行うと、認証情報・配信者登録情報・決済情報は速やかに削除されます。
          </p>
          <p>
            ただし、以下の情報は性質上削除の対象外です。
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-neutral-100">主催したイベント(大会):</strong>{" "}
              大会は主催者お一人の所有物ではなく、他の参加者・観戦者にとっての公開データであるため、アカウント削除後も大会ページ・参加者情報・対戦結果はそのまま閲覧可能な状態で保持されます。削除後は主催者としての編集操作ができなくなります。
            </li>
            <li>
              <strong className="text-neutral-100">TikTok LIVE配信データ:</strong>{" "}
              同一TikTokアカウントを他の利用者も登録している場合、そのTikTokアカウントの配信データ(ギフト履歴等)は削除されず、TikTok側の部屋データとして残る場合があります。
            </li>
          </ul>
        </Section>

        <Section title="5. お問い合わせ">
          <p>本ポリシーに関するお問い合わせは以下までご連絡ください。</p>
          <p className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
            運営者名・連絡先: [未確定 — 公開前に確定してください]
          </p>
        </Section>
      </div>
    </main>
  );
}
