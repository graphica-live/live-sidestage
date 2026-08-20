export default function Expired() {
  return (
    <div className="w-full flex flex-col items-center animate-in fade-in duration-500 max-w-xl">
      <h1 className="text-4xl font-black mb-6 text-center tracking-tight glitch-text" data-text="TikRing">
        <a
          href="/"
          aria-label="トップへ戻る"
          className="inline-block rounded-sm hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-tiktok-cyan/50"
        >
          <span className="text-white">TikRing</span>
        </a>
      </h1>

      <p className="text-white text-xl sm:text-2xl font-bold text-center mb-3">
        このフレームは有効期限が切れています
      </p>
      <p className="text-tiktok-lightgray text-sm sm:text-base text-center mb-10">
        ライバーさんにフレームの再登録をお願いしてみてください
      </p>

      <button
        type="button"
        onClick={() => {
          window.location.href = '/';
        }}
        className="w-full py-3.5 px-4 rounded-md bg-tiktok-red hover:bg-[#D92648] text-white font-bold transition-colors shadow-lg flex items-center justify-center gap-2 text-sm"
      >
        TikRingでフレームを作成する
      </button>
    </div>
  );
}
