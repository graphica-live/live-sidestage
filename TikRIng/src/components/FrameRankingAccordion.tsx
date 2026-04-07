import { ChevronDown, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

type RankingFrame = {
  id: string;
  displayName: string;
  ownerDisplayName: string;
  viewCount: number;
  thumbnailUrl: string;
};

type RankingResponse = {
  frames?: RankingFrame[];
};

interface FrameRankingAccordionProps {
  title: string;
  eyebrow?: string;
  closedSummary?: string;
  className?: string;
}

const WATERMARK_TEXT = 'TikRing';
const RANKING_ENDPOINT = '/api/frames?top=1';

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
    image.src = src;
  });
}

async function generateWatermarkedPngDataUrl(thumbnailUrl: string, watermarkText: string): Promise<string> {
  const image = await loadImage(thumbnailUrl);
  const canvas = document.createElement('canvas');
  const size = Math.max(image.width, image.height);

  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('プレビュー生成に失敗しました。');
  }

  context.clearRect(0, 0, size, size);

  const offsetX = (size - image.width) / 2;
  const offsetY = (size - image.height) / 2;
  context.drawImage(image, offsetX, offsetY, image.width, image.height);

  const gradient = context.createLinearGradient(0, 0, 0, size);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.12)');
  gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.28)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  context.save();
  context.translate(size / 2, size / 2);
  context.rotate(-Math.PI / 4);
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  const watermarkFontSize = Math.max(26, Math.round(size * 0.08));
  const spacing = Math.max(108, Math.round(size * 0.28));
  context.font = `900 ${watermarkFontSize}px Arial, sans-serif`;
  context.fillStyle = 'rgba(255, 255, 255, 0.34)';
  context.strokeStyle = 'rgba(0, 0, 0, 0.28)';
  context.lineWidth = Math.max(2, Math.round(size * 0.006));

  for (let x = -size * 1.2; x <= size * 1.2; x += spacing) {
    for (let y = -size * 1.2; y <= size * 1.2; y += spacing) {
      context.strokeText(watermarkText, x, y);
      context.fillText(watermarkText, x, y);
    }
  }

  context.restore();

  return canvas.toDataURL('image/png');
}

async function fetchRanking(endpoint: string, signal: AbortSignal) {
  const response = await fetch(endpoint, { signal });

  if (!response.ok) {
    const error = new Error('ランキングを取得できませんでした。');
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return response.json() as Promise<RankingResponse>;
}

function RankingThumbnail({
  frame,
  imageUrl,
  loading,
}: {
  frame: RankingFrame;
  imageUrl?: string;
  loading: boolean;
}) {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [imageUrl]);

  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-white/10 bg-transparent sm:h-24 sm:w-24">
      {loading ? (
        <div className="flex h-full w-full items-center justify-center bg-white/[0.03] text-tiktok-lightgray">
          <Loader2 className="h-4 w-4 animate-spin text-tiktok-cyan" />
        </div>
      ) : imageUrl && !imageError ? (
        <img
          src={imageUrl}
          alt={frame.displayName}
          loading="lazy"
          onError={() => setImageError(true)}
          className="h-full w-full object-contain"
          draggable={false}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] font-bold tracking-[0.12em] text-white/55">
          NO IMAGE
        </div>
      )}
    </div>
  );
}

function StrongWatermarkOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-[-18%] grid grid-cols-3 gap-y-10 gap-x-6 -rotate-[24deg] sm:gap-y-12 sm:gap-x-8">
        {Array.from({ length: 15 }).map((_, index) => (
          <span
            key={index}
            className="select-none text-center text-base font-black uppercase tracking-[0.34em] text-white/42 drop-shadow-[0_3px_10px_rgba(0,0,0,0.85)] sm:text-xl"
          >
            {WATERMARK_TEXT}
          </span>
        ))}
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.16),rgba(0,0,0,0.26))]" />
    </div>
  );
}

export default function FrameRankingAccordion({
  title,
  eyebrow = 'Ranking',
  closedSummary = '閲覧数TOP10を表示',
  className,
}: FrameRankingAccordionProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [frames, setFrames] = useState<RankingFrame[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedFrame, setSelectedFrame] = useState<RankingFrame | null>(null);
  const [thumbnailImageUrls, setThumbnailImageUrls] = useState<Record<string, string>>({});
  const [thumbnailImageLoadingIds, setThumbnailImageLoadingIds] = useState<Record<string, boolean>>({});
  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);
  const [modalImageLoading, setModalImageLoading] = useState(false);
  const [modalImageError, setModalImageError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loaded) {
      return;
    }

    const controller = new AbortController();

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        let data: RankingResponse;

        try {
          data = await fetchRanking(RANKING_ENDPOINT, controller.signal);
        } catch (primaryError) {
          const status = primaryError instanceof Error && 'status' in primaryError
            ? Number((primaryError as Error & { status?: number }).status)
            : null;
          const localOrigin = (import.meta.env.VITE_LOCAL_API_ORIGIN as string | undefined)?.trim() || '';
          const canFallback = Boolean(localOrigin)
            && !localOrigin.startsWith(window.location.origin)
            && (status === 401 || status === 404);

          if (!canFallback) {
            throw primaryError;
          }

          data = await fetchRanking(`${localOrigin}${RANKING_ENDPOINT}`, controller.signal);
        }

        setFrames(Array.isArray(data.frames) ? data.frames : []);
        setLoaded(true);
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
          return;
        }

        console.error(fetchError);
        if (fetchError instanceof Error && 'status' in fetchError) {
          const status = Number((fetchError as Error & { status?: number }).status);
          if (status === 401) {
            setError('ランキングAPIがまだ反映されていません。デプロイ後に表示されます。');
            return;
          }

          if (status === 404) {
            setError('ランキングAPIがまだ反映されていません。デプロイ後に表示されます。');
            return;
          }

          if (status >= 500) {
            setError('ランキングAPIでエラーが発生しました。');
            return;
          }
        }

        setError(fetchError instanceof Error ? fetchError.message : 'ランキングを読み込めませんでした。');
      } finally {
        setLoading(false);
      }
    };

    void load();

    return () => controller.abort();
  }, [loaded, open]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedFrame) {
      setModalImageUrl(null);
      setModalImageLoading(false);
      setModalImageError(null);
      return;
    }

    setModalImageLoading(true);
    setModalImageError(null);
    setModalImageUrl(null);

    void generateWatermarkedPngDataUrl(selectedFrame.thumbnailUrl, WATERMARK_TEXT)
      .then((dataUrl) => {
        if (cancelled) {
          return;
        }

        setModalImageUrl(dataUrl);
      })
      .catch((generationError) => {
        if (cancelled) {
          return;
        }

        console.error(generationError);
        setModalImageError('保護プレビューを生成できませんでした。');
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setModalImageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFrame]);

  useEffect(() => {
    if (!open || frames.length === 0) {
      return;
    }

    const pendingFrames = frames.filter((frame) => !thumbnailImageUrls[frame.id] && !thumbnailImageLoadingIds[frame.id]);
    if (pendingFrames.length === 0) {
      return;
    }

    let cancelled = false;

    setThumbnailImageLoadingIds((current) => {
      const next = { ...current };
      for (const frame of pendingFrames) {
        next[frame.id] = true;
      }
      return next;
    });

    void Promise.allSettled(
      pendingFrames.map(async (frame) => ({
        id: frame.id,
        dataUrl: await generateWatermarkedPngDataUrl(frame.thumbnailUrl, WATERMARK_TEXT),
      })),
    ).then((results) => {
      if (cancelled) {
        return;
      }

      const loadedEntries: Record<string, string> = {};
      const finishedIds: string[] = [];

      results.forEach((result, index) => {
        const frame = pendingFrames[index];
        finishedIds.push(frame.id);
        if (result.status === 'fulfilled') {
          loadedEntries[result.value.id] = result.value.dataUrl;
          return;
        }

        console.error(result.reason);
      });

      if (Object.keys(loadedEntries).length > 0) {
        setThumbnailImageUrls((current) => ({ ...current, ...loadedEntries }));
      }

      setThumbnailImageLoadingIds((current) => {
        const next = { ...current };
        for (const id of finishedIds) {
          delete next[id];
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [frames, open, thumbnailImageLoadingIds, thumbnailImageUrls]);

  const closeModal = () => {
    setSelectedFrame(null);
    setModalImageUrl(null);
    setModalImageLoading(false);
    setModalImageError(null);
  };

  const blockImageInteraction = (event: React.MouseEvent<HTMLElement> | React.DragEvent<HTMLElement>) => {
    event.preventDefault();
  };

  return (
    <>
      <section className={`w-full rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.94),rgba(10,10,12,0.98))] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.28)] sm:p-5 ${className ?? ''}`}>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className={`flex w-full items-center justify-between gap-3 text-left transition-colors ${open ? 'border-b border-white/8 pb-3' : ''}`}
        >
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-tiktok-cyan/80">{eyebrow}</p>
            <h2 className="mt-1 text-sm font-bold text-white sm:text-base">{title}</h2>
            {!open ? (
              <p className="mt-1 text-xs text-tiktok-lightgray">{closedSummary}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-tiktok-cyan/25 bg-tiktok-cyan/10 px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-tiktok-cyan/80">
              TOP 10
            </span>
            <ChevronDown className={`h-5 w-5 text-tiktok-lightgray transition-transform ${open ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {open ? (
          <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] p-3 sm:p-4">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-tiktok-lightgray">
                <Loader2 className="h-4 w-4 animate-spin text-tiktok-cyan" />
                <span>ランキングを読み込み中...</span>
              </div>
            ) : error ? (
              <div className="rounded-xl border border-tiktok-red/25 bg-tiktok-red/10 px-3 py-4 text-center text-sm text-[#ffb7c5]">
                {error}
              </div>
            ) : frames.length === 0 ? (
              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-4 text-center text-sm text-tiktok-lightgray">
                まだランキング対象のフレームがありません。
              </div>
            ) : (
              <ol className="space-y-2.5">
                {frames.map((frame, index) => (
                  <li key={frame.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedFrame(frame)}
                      className="flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-3 py-2.5 text-left transition hover:border-white/14 hover:bg-[linear-gradient(135deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))]"
                    >
                      <div className="flex w-9 shrink-0 flex-col items-center justify-center rounded-xl border border-tiktok-cyan/18 bg-tiktok-cyan/10 px-1.5 py-2 text-center">
                        <span className="text-[10px] font-black tracking-[0.18em] text-tiktok-cyan/72">#{index + 1}</span>
                      </div>
                      <RankingThumbnail
                        frame={frame}
                        imageUrl={thumbnailImageUrls[frame.id]}
                        loading={Boolean(thumbnailImageLoadingIds[frame.id])}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-white">投稿者: {frame.ownerDisplayName}</p>
                        <p className="mt-1 text-[11px] text-tiktok-lightgray">タップで拡大表示</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : null}
      </section>

      {selectedFrame ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ranking-preview-title"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-md rounded-[1.75rem] border border-white/12 bg-[linear-gradient(180deg,rgba(20,20,24,0.98),rgba(7,7,9,0.98))] p-4 shadow-[0_24px_90px_rgba(0,0,0,0.45)] sm:p-5"
            onClick={(event) => event.stopPropagation()}
            onContextMenu={blockImageInteraction}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-tiktok-cyan/80">Ranking Preview</p>
                <h3 id="ranking-preview-title" className="mt-1 text-sm font-bold text-white sm:text-base">投稿者: {selectedFrame.ownerDisplayName}</h3>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                onClick={closeModal}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-tiktok-lightgray transition hover:border-white/16 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              className="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-transparent"
              onContextMenu={blockImageInteraction}
              onDragStart={blockImageInteraction}
            >
              {modalImageLoading ? (
                <div className="flex aspect-square w-full items-center justify-center gap-2 bg-white/[0.03] text-sm text-tiktok-lightgray">
                  <Loader2 className="h-4 w-4 animate-spin text-tiktok-cyan" />
                  <span>保護プレビューを生成中...</span>
                </div>
              ) : modalImageUrl ? (
                <>
                  <img
                    src={modalImageUrl}
                    alt={selectedFrame.displayName}
                    className="aspect-square w-full object-contain"
                    draggable={false}
                    onContextMenu={blockImageInteraction}
                    onDragStart={blockImageInteraction}
                  />
                  <StrongWatermarkOverlay />
                </>
              ) : (
                <div className="flex aspect-square w-full items-center justify-center px-6 text-center text-sm text-[#ffb7c5]">
                  {modalImageError ?? '保護プレビューを生成できませんでした。'}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}