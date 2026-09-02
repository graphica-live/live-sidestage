"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ALLOWED_COVER_CONTENT_TYPES, MAX_COVER_IMAGE_BYTES } from "@/event/cover-key";

/**
 * イベントのカバー画像(公開ページheroの「イベントPOP」)。編集ページ上部専用。
 * presigned URL方式: サーバーからPUT用URLだけもらい、ブラウザが直接バケットへ送る。
 */
export function EventCoverUpload({
  eventId,
  initialImageUrl,
  uploadEnabled,
}: {
  eventId: string;
  initialImageUrl: string | null;
  uploadEnabled: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState(initialImageUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);

    if (!ALLOWED_COVER_CONTENT_TYPES.includes(file.type)) {
      setError("画像形式はJPEG/PNG/WebPのみ対応している。");
      return;
    }
    if (file.size > MAX_COVER_IMAGE_BYTES) {
      setError(`画像サイズは${MAX_COVER_IMAGE_BYTES / 1024 / 1024}MB以内にしてください。`);
      return;
    }

    setBusy(true);
    try {
      const issueRes = await fetch(`/api/events/${eventId}/cover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      });
      const issued = await issueRes.json().catch(() => null);
      if (!issueRes.ok) {
        setError(issued?.error ?? "アップロードURLの発行に失敗した。");
        return;
      }

      const putRes = await fetch(issued.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) {
        setError("画像のアップロードに失敗した。");
        return;
      }

      const confirmRes = await fetch(`/api/events/${eventId}/cover`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: issued.key }),
      });
      const confirmed = await confirmRes.json().catch(() => null);
      if (!confirmRes.ok) {
        setError(confirmed?.error ?? "アップロードの確定に失敗した。");
        return;
      }

      setPreviewUrl(URL.createObjectURL(file));
      router.refresh();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/events/${eventId}/cover`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "削除に失敗した。");
      return;
    }
    setPreviewUrl(null);
    router.refresh();
  }

  return (
    <div className="card">
      <span className="label">イベントPOP(カバー画像)</span>
      <p className="mb-3 text-xs text-muted">
        公開ページのheroに表示される。JPEG/PNG/WebP、{MAX_COVER_IMAGE_BYTES / 1024 / 1024}MBまで。
      </p>

      {!uploadEnabled ? (
        <p className="text-xs text-amber-400">画像アップロードは現在利用できない。</p>
      ) : (
        <>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt=""
              className="mb-3 max-h-56 w-full rounded-lg border border-border object-contain"
            />
          )}

          {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={ALLOWED_COVER_CONTENT_TYPES.join(",")}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
              className="text-xs text-muted file:mr-3 file:rounded-lg file:border file:border-border file:bg-panel file:px-3 file:py-1.5 file:text-xs file:text-strong"
            />
            {previewUrl && (
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={busy}
                onClick={handleRemove}
              >
                画像を外す
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
