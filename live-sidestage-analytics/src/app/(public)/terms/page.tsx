import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "利用規約 | LIVE Sidestage",
  description: "LIVE Sidestage / LIVE Sidestage Analytics の利用規約",
};

const UPDATED_AT = "2026-09-03";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-strong">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-strong">利用規約</h1>
      <p className="mt-2 text-xs text-muted">最終更新日: {UPDATED_AT}</p>

      <div className="mt-8 space-y-10">
        <Section title="1. 適用">
          <p>
            本規約は、LIVE Sidestage（モバイルアプリ）および LIVE Sidestage
            Analytics（配信者向けダッシュボード、以下「本サービス」）の利用条件を定めるものです。ユーザーは本サービスを利用することにより、本規約に同意したものとみなされます。
          </p>
        </Section>

        <Section title="2. サービス内容">
          <p>
            本サービスは、TikTok LIVE配信中のギフト・コメント等のデータ集計、配信支援用オーバーレイの提供、およびイベント(大会)運営機能を提供します。サービス内容は予告なく追加・変更される場合があります。
          </p>
        </Section>

        <Section title="3. アカウント登録">
          <p>
            本サービスの一部機能は、Google または Apple アカウントによるログインが必要です。ユーザーは自己の責任においてアカウント情報を管理するものとし、第三者による不正利用について当社は責任を負いません。
          </p>
        </Section>

        <Section title="4. 禁止事項">
          <p>本サービスの利用にあたり、以下の行為を禁止します。</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>法令または公序良俗に違反する行為</li>
            <li>他のユーザーまたは第三者の権利を侵害する行為</li>
            <li>本サービスの運営を妨害する行為(不正アクセス、過度な負荷をかける行為を含む)</li>
            <li>集計データを不正に改ざん・偽装する行為</li>
            <li>その他、当社が不適切と判断する行為</li>
          </ul>
        </Section>

        <Section title="5. 知的財産権">
          <p>
            本サービスに関する著作権・商標権その他の知的財産権は、当社または正当な権利を有する第三者に帰属します。TikTokに関する商標・データは、TikTok
            Inc.またはその関連会社に帰属します。
          </p>
        </Section>

        <Section title="6. 利用制限・登録抹消">
          <p>
            当社は、ユーザーが本規約に違反したと判断した場合、事前の通知なく本サービスの利用を制限し、またはアカウント登録を抹消できるものとします。
          </p>
        </Section>

        <Section title="7. 免責事項">
          <p>
            本サービスは、TikTok LIVEから受信するデータの正確性・完全性・継続性を保証しません。TikTok側の仕様変更・障害により機能が利用できなくなる場合があります。当社は、本サービスの利用によりユーザーに生じた損害について、当社の故意または重過失による場合を除き、責任を負いません。
          </p>
        </Section>

        <Section title="8. サービス内容の変更・停止">
          <p>
            当社は、ユーザーへの事前通知なく、本サービスの内容を変更し、または提供を停止することができるものとします。これによりユーザーに生じた損害について、当社は責任を負いません。
          </p>
        </Section>

        <Section title="9. 利用規約の変更">
          <p>
            当社は、必要と判断した場合、本規約を変更できるものとします。変更後の規約は、本ページに掲載した時点から効力を生じるものとします。
          </p>
        </Section>

        <Section title="10. 準拠法・管轄">
          <p>本規約は日本法に準拠し、本サービスに関して紛争が生じた場合には、当社所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。</p>
        </Section>
      </div>
    </main>
  );
}
