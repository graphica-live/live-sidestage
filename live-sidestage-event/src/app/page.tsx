import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { FORMAT_DESCRIPTIONS, FORMAT_LABELS } from "@/lib/labels";
import { EVENT_FORMATS } from "@/lib/validation";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  return (
    <main className="min-h-screen px-4 py-16">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-3xl font-bold">
          LIVE Sidestage <span className="text-brand">Event</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-400">
          TikTok Live のイベント・大会を作って運営する。参加ライバーを登録してイベントを始めると、
          期間中のギフトを自動で集計し、順位とリスナーの貢献ランキングを公開ページに出す。
        </p>

        <div className="mt-8 grid gap-3">
          {EVENT_FORMATS.map((format) => (
            <div key={format} className="card">
              <h2 className="text-sm font-semibold text-white">{FORMAT_LABELS[format]}</h2>
              <p className="mt-1 text-xs text-gray-400">{FORMAT_DESCRIPTIONS[format]}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex gap-3">
          {session ? (
            <Link href="/events" className="btn-primary">
              イベント一覧へ
            </Link>
          ) : (
            <Link href="/login" className="btn-primary">
              ログインしてはじめる
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
