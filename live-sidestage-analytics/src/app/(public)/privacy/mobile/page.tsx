import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "プライバシーポリシー（モバイルアプリ版） | LIVE Sidestage",
  description: "LIVE Sidestage モバイルアプリのプライバシーポリシー",
};

const UPDATED_AT = "2026-08-30";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-neutral-300">{children}</div>
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-neutral-100">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export default function MobilePrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-white">プライバシーポリシー</h1>
      <p className="mt-2 text-xs text-neutral-500">最終更新日: {UPDATED_AT}</p>

      <div className="mt-8 space-y-10">
        <p className="text-sm leading-relaxed text-neutral-300">
          LIVE Sidestage（以下「本アプリ」といいます。）は、本アプリの提供にあたり、ユーザーに関する情報を以下のとおり取り扱います。
        </p>
        <p className="-mt-6 text-sm leading-relaxed text-neutral-300">
          本ポリシーは、iOS版およびAndroid版のLIVE Sidestageモバイルアプリに適用されます。
        </p>

        <Section title="1. 取得する情報">
          <p>本アプリでは、サービスの提供に必要な範囲で以下の情報を取得する場合があります。</p>

          <SubSection title="1.1 アカウント情報">
            <p>
              <strong className="text-neutral-100">Googleアカウントでログインした場合</strong>
            </p>
            <p>Googleから提供される以下の情報を取得する場合があります。</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>氏名</li>
              <li>メールアドレス</li>
              <li>プロフィール画像</li>
              <li>Googleが発行するアカウント識別子</li>
            </ul>
            <p>
              <strong className="text-neutral-100">Appleアカウントでログインした場合</strong>
            </p>
            <p>Appleから提供される以下の情報を取得する場合があります。</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Appleが発行するアカウント識別子</li>
              <li>メールアドレス</li>
              <li>氏名</li>
            </ul>
            <p>
              Appleの設定により、メールアドレスとしてAppleの非公開リレーアドレスが提供される場合や、氏名等の情報が提供されない場合があります。
            </p>
          </SubSection>

          <SubSection title="1.2 TikTokに関連する情報">
            <p>
              本アプリの配信関連機能を提供するため、ユーザーが登録したTikTokアカウントに関する以下の情報を取得する場合があります。
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>TikTokアカウントID</li>
              <li>ユーザー名、ニックネーム等の公開プロフィール情報</li>
              <li>TikTok LIVEに関連する配信情報</li>
            </ul>
            <p>また、TikTok LIVEの配信中に、配信データとして以下の情報を取得する場合があります。</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>視聴者のニックネーム</li>
              <li>TikTokユーザーID等の識別情報</li>
              <li>コメント内容</li>
              <li>ギフトの種類、数量その他ギフトに関する情報</li>
              <li>その他、TikTok LIVEから提供される配信イベント情報</li>
            </ul>
            <p>
              これらの情報は、TikTok LIVEの配信状況の表示、集計、分析その他の配信支援機能を提供する目的で利用します。
            </p>
            <p>
              なお、これらの視聴者情報は、当該視聴者が本アプリのユーザーとして登録することによって取得するものではなく、TikTok
              LIVEの配信データとして取得するものです。
            </p>
          </SubSection>

          <SubSection title="1.3 有料機能・購入に関する情報">
            <p>
              本アプリ内の有料機能またはサブスクリプションの購入は、利用しているOSに応じて以下の決済サービスを通じて処理されます。
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>iOS：Appleが提供するApp内課金</li>
              <li>Android：Google Playが提供する決済システム</li>
            </ul>
            <p>本アプリでは、クレジットカード番号等の決済手段に関する情報を直接取得または保持しません。</p>
            <p>ただし、有料機能の提供、購入状態の確認および復元等のため、以下の情報を取得または保存する場合があります。</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>購入した商品またはプラン</li>
              <li>購入状態</li>
              <li>有効期限</li>
              <li>トランザクションその他購入を識別するための情報</li>
            </ul>
          </SubSection>

          <SubSection title="1.4 サービス利用・技術情報">
            <p>本アプリの安定した提供、不具合の調査、不正利用の防止等のため、以下の情報を取得する場合があります。</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>アプリの利用状況</li>
              <li>エラー・障害に関する情報</li>
              <li>OSおよびアプリのバージョン</li>
              <li>その他、本アプリの正常な提供に必要な技術情報</li>
            </ul>
          </SubSection>
        </Section>

        <Section title="2. 情報の利用目的">
          <p>取得した情報は、以下の目的で利用します。</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>ユーザーアカウントの認証および管理</li>
            <li>本アプリの機能の提供</li>
            <li>TikTok LIVE配信情報の取得、表示、集計および分析</li>
            <li>ギフト、コメントその他配信情報のリアルタイム表示</li>
            <li>有料プランおよび有料機能の提供</li>
            <li>購入状態の確認および復元</li>
            <li>不具合・障害の調査および対応</li>
            <li>不正利用の防止</li>
            <li>サービスの維持、改善および安全性の確保</li>
            <li>ユーザーからのお問い合わせへの対応</li>
            <li>法令または利用規約に違反する行為への対応</li>
          </ul>
        </Section>

        <Section title="3. 外部サービスへの情報の送受信">
          <p>本アプリでは、サービス提供に必要な範囲で、以下の外部サービスとの間で情報を送受信する場合があります。</p>

          <SubSection title="Apple">
            <p>Appleアカウントによる認証、App内課金、購入状態の確認等に利用します。</p>
          </SubSection>
          <SubSection title="Google">
            <p>Googleアカウントによる認証、Google Playを通じた購入および購入状態の確認等に利用します。</p>
          </SubSection>
          <SubSection title="TikTok">
            <p>TikTokアカウントおよびTikTok LIVEに関連する機能の提供のために利用します。</p>
          </SubSection>

          <p>これらの外部サービスにおける情報の取扱いについては、それぞれのサービス提供者が定めるプライバシーポリシー等が適用されます。</p>
          <p>当サービスは、ユーザーの個人情報を販売することはありません。</p>
          <p>法令に基づく場合を除き、取得した情報を本ポリシーに記載した目的を超えて第三者に提供することはありません。</p>
        </Section>

        <Section title="4. 情報の保存および削除">
          <SubSection title="4.1 アカウントの削除">
            <p>ユーザーは、本アプリ内の「アカウント削除」機能から、いつでもアカウントの削除を申請できます。</p>
            <p>また、アプリを利用できない場合でも、当サービスが指定するWebページまたはお問い合わせ窓口からアカウント削除を申請できます。</p>
            <p>アカウントが削除された場合、当該アカウントに直接紐づく以下の情報を原則として削除します。</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>認証情報</li>
              <li>メールアドレス等のアカウント情報</li>
              <li>TikTokアカウントとの連携情報</li>
              <li>ユーザー固有の設定情報</li>
              <li>その他、アカウントの維持に必要な情報</li>
            </ul>
          </SubSection>

          <SubSection title="4.2 アカウント削除後も保持される場合がある情報">
            <p>
              <strong className="text-neutral-100">TikTok LIVEに関する配信データ</strong>
            </p>
            <p>
              TikTok
              LIVEから取得したコメント、ギフト履歴その他の配信データについて、同一のTikTok
              LIVEまたはTikTokアカウントに関連するデータを他のユーザーも利用している場合、当該データがサービス上に保持される場合があります。アカウント削除後は、削除されたLIVE
              Sidestageアカウントとの直接的な関連付けを可能な範囲で削除します。
            </p>
            <p>
              <strong className="text-neutral-100">法令等に基づき保存が必要な情報</strong>
            </p>
            <p>法令上の義務、不正利用の防止、紛争への対応その他正当な理由により保存が必要な情報については、必要な期間に限り保持する場合があります。</p>
          </SubSection>

          <SubSection title="4.3 App StoreまたはGoogle Playが保持する情報">
            <p>
              AppleまたはGoogleが管理する購入履歴、決済情報その他の情報については、本アプリのアカウントを削除してもAppleまたはGoogle側で保持される場合があります。これらの情報は、それぞれのサービス提供者のプライバシーポリシーに従って管理されます。
            </p>
          </SubSection>
        </Section>

        <Section title="5. 未成年者の利用">
          <p>未成年者が本アプリを利用する場合は、必要に応じて保護者等の法定代理人の同意を得た上で利用してください。</p>
        </Section>

        <Section title="6. 本ポリシーの変更">
          <p>当サービスは、法令の改正、本アプリの機能変更その他必要に応じて、本ポリシーを変更することがあります。</p>
          <p>重要な変更を行う場合は、本アプリまたは当サービスのWebサイト等を通じて適切な方法でお知らせします。</p>
        </Section>

        <Section title="7. お問い合わせ">
          <p>本ポリシーおよび個人情報の取扱いに関するお問い合わせは、以下の窓口までご連絡ください。</p>
          <p>
            サービス名：LIVE Sidestage
            <br />
            お問い合わせ：graphicatestlive@gmail.com
          </p>
          <p>事業者の氏名、所在地その他法令に基づき開示が必要な事項については、上記窓口へのご請求に応じて、法令に従い対応いたします。</p>
        </Section>
      </div>
    </main>
  );
}
