// イベント管理画面だけのコンテナ。
//
// 統合前は event 側の (dashboard)/layout.tsx がこの <main> を持っていたが、
// analytics の (dashboard)/layout.tsx は children をそのまま描くだけで、
// 余白と最大幅は各ページが自前で持つ規約になっている。
// events/ 配下のページは裸の <div> 始まりなので、ここでラッパーを補う。
export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-4xl px-4 py-8">{children}</main>;
}
