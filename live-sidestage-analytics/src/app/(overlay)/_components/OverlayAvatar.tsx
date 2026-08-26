"use client";

// リスナーのプロフィール画像。TikTok の CDN URL は期限切れで 404 になることがあるので、
// 失敗したら黙って消す(枠だけ残るより自然)。フォールバックは頭文字。
export default function OverlayAvatar({
  src,
  alt,
  size = 32,
}: {
  src: string | null;
  alt: string;
  size?: number;
}) {
  const style = { width: size, height: size };

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        style={style}
        className="rounded-full object-cover shrink-0 border-2 border-white/80"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }

  return (
    <div
      style={style}
      className="rounded-full bg-surface border-2 border-white/80 flex items-center justify-center text-white text-xs font-bold shrink-0"
    >
      {alt.charAt(0).toUpperCase()}
    </div>
  );
}
