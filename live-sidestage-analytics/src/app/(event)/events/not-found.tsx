import Link from "next/link";

// events サブツリーの 404 境界。
//
// これが無いと [id]/page.tsx などの notFound() がルートまで抜け、Next の既定404が
// (event)/layout.tsx の外側で描かれる = Event ヘッダーも Event の metadata も付かない。
// 削除済みイベントの残リンクを踏むのは主催者に普通に起きるので、ここで受け止める。
export default function EventNotFound() {
  return (
    <div className="card text-center">
      <p className="text-sm text-gray-400">イベントが見つからない。</p>
      <p className="mt-1 text-xs text-gray-500">削除されたか、URL が間違っている。</p>
      <Link href="/events" className="mt-3 inline-block text-sm text-brand hover:underline">
        イベント一覧へ戻る
      </Link>
    </div>
  );
}
