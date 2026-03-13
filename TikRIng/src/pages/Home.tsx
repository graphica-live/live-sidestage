import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { UploadCloud, Link as LinkIcon, Check, Loader2, Move } from 'lucide-react';
import { getSquareFrameBlob, hasTransparentPixelsInCenter, getTransparentCentroidHint } from '../utils/canvas';

export default function Home() {
  const [uploading, setUploading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameImage, setFrameImage] = useState<string | null>(null);
  const [frameFileName, setFrameFileName] = useState('frame');
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [autoCenteredNotice, setAutoCenteredNotice] = useState(false);
  const [centering, setCentering] = useState(false);
  const [edgeFilledNotice, setEdgeFilledNotice] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);

  const isDragging = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const startPosition = useRef({ x: 0, y: 0 });
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const initialPinchDistance = useRef<number | null>(null);
  const initialPinchZoom = useRef<number>(1);

  useEffect(() => {
    return () => {
      if (frameImage) {
        URL.revokeObjectURL(frameImage);
      }
    };
  }, [frameImage]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
    if (!isPng) {
      setError('PNGファイルのみアップロードできます。');
      return;
    }

    if (frameImage) {
      URL.revokeObjectURL(frameImage);
    }

    setFrameImage(URL.createObjectURL(file));
    setFrameFileName(file.name.replace(/\.[^/.]+$/, '') || 'frame');
    setPosition({ x: 0, y: 0 });
    setZoom(1);
    setAutoCenteredNotice(false);
    setEdgeFilledNotice(false);
    setError(null);
    setShareUrl(null);
    setCopied(false);
  }, [frameImage]);

  const onDropRejected = useCallback((fileRejections: FileRejection[]) => {
    const rejection = fileRejections[0];
    if (rejection.errors[0]?.code === 'file-too-large') {
      setError('ファイルサイズが大きすぎます。5MB以下の画像を選択してください。');
    } else if (rejection.errors[0]?.code === 'file-invalid-type') {
      setError('PNGファイルのみアップロードできます。');
    } else {
      setError('無効なファイルです。PNG画像を選択してください。');
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 1) {
      isDragging.current = true;
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      startPosition.current = { ...position };
    } else if (activePointers.current.size === 2) {
      isDragging.current = false;
      const pts = Array.from(activePointers.current.values());
      initialPinchDistance.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      initialPinchZoom.current = zoom;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointers.current.has(e.pointerId)) {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (activePointers.current.size === 1 && isDragging.current) {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      setPosition({
        x: startPosition.current.x + dx,
        y: startPosition.current.y + dy,
      });
    } else if (activePointers.current.size === 2 && initialPinchDistance.current !== null) {
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const zoomRatio = dist / initialPinchDistance.current;
      setZoom(Math.max(0.3, Math.min(3, initialPinchZoom.current * zoomRatio)));
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(e.pointerId);
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (activePointers.current.size < 2) {
      initialPinchDistance.current = null;
    }

    if (activePointers.current.size === 1) {
      const pts = Array.from(activePointers.current.values());
      isDragging.current = true;
      dragStartPos.current = { x: pts[0].x, y: pts[0].y };
      startPosition.current = { ...position };
    } else if (activePointers.current.size === 0) {
      isDragging.current = false;
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const zoomFactor = -e.deltaY * 0.002;
    setZoom((prev) => Math.max(0.3, Math.min(3, prev + zoomFactor)));
  };

  const resetFrameEditor = () => {
    if (frameImage) {
      URL.revokeObjectURL(frameImage);
    }
    setFrameImage(null);
    setPosition({ x: 0, y: 0 });
    setZoom(1);
    setAutoCenteredNotice(false);
    setEdgeFilledNotice(false);
  };

  const handleAlignTransparentCenter = async () => {
    if (!frameImage || centering) return;

    setCentering(true);
    setAutoCenteredNotice(false);

    try {
      const hint = await getTransparentCentroidHint(frameImage);
      if (!hint.point) {
        setError('中央付近に透過領域が見つかりませんでした。手動で位置を調整してください。');
        return;
      }

      let previewSize = editorRef.current?.clientWidth ?? 0;
      for (let i = 0; i < 6 && previewSize <= 0; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        previewSize = editorRef.current?.clientWidth ?? 0;
      }

      if (previewSize <= 0) return;

      const baseScale = Math.min(previewSize / hint.width, previewSize / hint.height);
      const dx = (hint.point.x - hint.width / 2) * baseScale;
      const dy = (hint.point.y - hint.height / 2) * baseScale;

      setPosition({ x: -dx, y: -dy });
      setAutoCenteredNotice(true);
      setError(null);
    } catch (err) {
      console.error('Manual centering failed:', err);
      setError('透過領域の位置合わせに失敗しました。もう一度お試しください。');
    } finally {
      setCentering(false);
    }
  };

  const handleUpload = async () => {
    if (!frameImage) return;

    setUploading(true);
    setError(null);
    setShareUrl(null);
    setCopied(false);
    setEdgeFilledNotice(false);

    try {
      const previewSize = editorRef.current?.clientWidth ?? 1024;
      const { blob: squareBlob, edgeFilled } = await getSquareFrameBlob(frameImage, position, zoom, 1024, previewSize);
      setEdgeFilledNotice(edgeFilled);

      const squareBlobUrl = URL.createObjectURL(squareBlob);
      try {
        const hasTransparentCenter = await hasTransparentPixelsInCenter(squareBlobUrl);
        if (!hasTransparentCenter) {
          setError('中央に透過領域がありません。中央が透過されるように画像位置を調整してください。');
          return;
        }
      } finally {
        URL.revokeObjectURL(squareBlobUrl);
      }

      const MAX_SIZE = 5 * 1024 * 1024;
      if (squareBlob.size > MAX_SIZE) {
        setError('編集後の画像サイズが5MBを超えています。縮小して再度お試しください。');
        return;
      }

      const uploadFile = new File([squareBlob], `${frameFileName}.png`, { type: 'image/png' });
      const formData = new FormData();
      formData.append('file', uploadFile);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      const url = `${window.location.origin}${window.location.pathname}?f=${data.id}&openExternalBrowser=1`;
      setShareUrl(url);
    } catch (err) {
      console.error(err);
      setError('画像のアップロードに失敗しました。もう一度お試しください。');
    } finally {
      setUploading(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: {
      'image/png': ['.png']
    },
    maxSize: 5 * 1024 * 1024, // 5MB Limit
    maxFiles: 1,
    multiple: false
  });

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <div className="w-full flex flex-col items-center animate-in fade-in duration-500 max-w-xl">
      {/* ライバー専用バッジ */}
      <div className="mb-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-tiktok-cyan/20 text-tiktok-cyan border border-tiktok-cyan/30 text-xs font-bold tracking-wider">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-tiktok-cyan opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-tiktok-cyan"></span>
        </span>
        ライバー専用アップロード画面
      </div>

      <h1 className="text-4xl font-black mb-4 text-center tracking-tight glitch-text" data-text="TikRing">
        <span className="text-white">TikRing</span>
      </h1>

      <p className="text-tiktok-lightgray flex flex-col items-center text-center gap-1 mb-10 text-sm sm:text-base">
        <span>配布したい透過フレームをアップロードして、</span>
        <span>リスナー用の着せ替えURLを発行しましょう。</span>
        <span className="text-xs text-tiktok-red/80 mt-2 bg-tiktok-red/10 px-3 py-1 rounded-full">
          ※アップロードしたフレームの有効期限は約3ヶ月です
        </span>
      </p>

      {/* エラー表示 */}
      {error && (
        <div className="mt-6 w-full p-4 rounded-xl bg-tiktok-red/20 border border-tiktok-red/30 text-tiktok-red text-sm text-center">
          {error}
        </div>
      )}

      {/* アップロード前 or アップロード中 (URL未発行時) */}
      {!shareUrl && !frameImage ? (
        <div
          {...getRootProps()}
          className={`w-full aspect-square sm:aspect-video rounded-md border-2 border-dashed flex flex-col items-center justify-center p-8 transition-all cursor-pointer relative overflow-hidden group
            ${isDragActive ? 'border-tiktok-cyan bg-tiktok-cyan/10' : 'border-tiktok-gray bg-tiktok-dark hover:border-tiktok-lightgray/50 hover:bg-tiktok-gray/30'}
            ${uploading ? 'pointer-events-none opacity-80' : ''}
          `}
        >
          <input {...getInputProps()} />

          {uploading ? (
            <div className="flex flex-col items-center gap-4 text-tiktok-cyan">
              <Loader2 className="w-12 h-12 animate-spin" />
              <p className="font-medium animate-pulse">アップロード中...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-tiktok-gray/50 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <UploadCloud className="w-8 h-8 text-tiktok-lightgray group-hover:text-white transition-colors" />
              </div>
              <div>
                <p className="text-lg font-bold mb-1 group-hover:text-tiktok-cyan transition-colors">フレーム画像をドロップ</p>
                <p className="text-sm text-tiktok-lightgray text-balance">
                  またはクリックしてファイルを選択
                  <br />
                  <span className="text-xs opacity-70 mt-2 block">(PNGのみ / 正方形でなくてもOK: 次の画面で位置と拡大率を調整)</span>
                </p>
              </div>
            </div>
          )}
        </div>
      ) : !shareUrl && frameImage ? (
        <div className="w-full flex flex-col items-center gap-6">
          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold">フレーム位置を調整</h2>
            <p className="text-sm text-tiktok-lightgray">
              画像をドラッグして位置調整、ピンチ/ホイール/スライダーで拡大縮小できます。
            </p>
            {autoCenteredNotice && (
              <p className="text-xs text-tiktok-cyan/90 bg-tiktok-cyan/10 border border-tiktok-cyan/25 rounded-full px-3 py-1 inline-block">
                透過領域の中心が中央に来るよう、位置を自動調整しました。
              </p>
            )}
            {edgeFilledNotice && (
              <p className="text-xs text-amber-300/95 bg-amber-500/10 border border-amber-500/30 rounded-full px-3 py-1 inline-block">
                フレーム端の透過部分を、平均色で自動補正しました。
              </p>
            )}
          </div>

          <div
            ref={editorRef}
            className="relative w-full aspect-square rounded-md overflow-hidden bg-tiktok-dark shadow-2xl cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          >
            <div className="absolute inset-0 bg-[linear-gradient(45deg,#202020_25%,transparent_25%),linear-gradient(-45deg,#202020_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#202020_75%),linear-gradient(-45deg,transparent_75%,#202020_75%)] bg-[length:28px_28px] bg-[position:0_0,0_14px,14px_-14px,-14px_0px]" />
            <div className="absolute inset-0 flex items-center justify-center z-10 overflow-visible">
              <img
                src={frameImage}
                alt="Frame preview"
                draggable={false}
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                  transformOrigin: 'center center',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain',
                }}
              />
            </div>
            <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
              <div className="w-[calc(100%-4px)] h-[calc(100%-4px)] rounded-full border-2 border-white/65 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
            <div className="absolute inset-0 z-20 pointer-events-none border-2 border-tiktok-cyan/70 rounded-md" />
          </div>

          <p className="text-xs text-tiktok-lightgray/90 text-center -mt-2">
            薄い円の内側が、TikTokでのプロフィール画像表示の目安です。
          </p>

          <div className="w-full flex items-center gap-3 px-2">
            <Move className="w-4 h-4 text-tiktok-lightgray shrink-0" />
            <span className="text-xs text-tiktok-lightgray shrink-0">縮小</span>
            <input
              type="range"
              value={zoom}
              min={0.3}
              max={3}
              step={0.1}
              aria-labelledby="FrameZoom"
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full h-1.5 bg-tiktok-gray rounded-full appearance-none cursor-pointer accent-white"
            />
            <span className="text-xs text-tiktok-lightgray shrink-0 font-medium">拡大</span>
          </div>

          <button
            onClick={handleAlignTransparentCenter}
            disabled={centering}
            className="w-full py-2.5 px-4 rounded-md border border-tiktok-cyan/35 bg-tiktok-cyan/10 hover:bg-tiktok-cyan/15 text-tiktok-cyan font-bold transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {centering ? '透過中心に合わせています...' : '透過領域の中心を中央に合わせる'}
          </button>

          <div className="flex w-full gap-3 mt-1">
            <button
              onClick={resetFrameEditor}
              className="flex-1 py-3.5 px-4 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 font-bold transition-colors text-sm"
            >
              画像を選び直す
            </button>
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="flex-1 py-3.5 px-4 rounded-md bg-tiktok-red hover:bg-[#D92648] text-white font-bold transition-colors shadow-lg flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  アップロード中...
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  この内容でアップロード
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* 共有URL表示 (アップロード完了後) */
        <div className="w-full flex flex-col items-center animate-in slide-in-from-bottom-4 fade-in duration-500 bg-tiktok-dark border border-tiktok-gray p-6 rounded-md shadow-xl text-center">
          <div className="w-16 h-16 rounded-full bg-tiktok-cyan/20 flex items-center justify-center mb-4">
            <Check className="w-8 h-8 text-tiktok-cyan" />
          </div>
          <h2 className="text-xl font-bold mb-2">アップロード完了！</h2>
          <p className="text-sm text-tiktok-lightgray mb-6">
            以下のURLをSNS等でリスナーに共有してください。<br />
            (※有効期限: 約3ヶ月)
          </p>

          <div className="w-full flex flex-col gap-2">
            <h3 className="text-sm font-bold text-tiktok-lightgray text-left ml-1">リスナー用 着せ替えURL</h3>
            <div className="flex items-center gap-2 p-1.5 pl-4 bg-tiktok-black rounded-md border border-tiktok-gray focus-within:border-tiktok-cyan transition-colors w-full">
              <LinkIcon className="w-5 h-5 text-tiktok-lightgray shrink-0" />
              <input
                type="text"
                readOnly
                value={shareUrl ?? ''}
                className="flex-1 bg-transparent border-none outline-none text-sm text-white truncate"
              />
              <button
                onClick={handleCopy}
                className={`shrink-0 flex items-center gap-1.5 px-6 py-2.5 rounded-md text-sm font-bold transition-all
                  ${copied
                    ? 'bg-tiktok-gray text-white'
                    : 'bg-tiktok-red text-white hover:bg-tiktok-red/80'}
                `}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    コピー完了
                  </>
                ) : (
                  'コピー'
                )}
              </button>
            </div>
          </div>

          <button
            onClick={() => {
              setShareUrl(null);
              setCopied(false);
              setError(null);
              resetFrameEditor();
            }}
            className="mt-8 text-sm text-tiktok-lightgray hover:text-white underline transition-colors"
          >
            別のフレームを新しくアップロードする
          </button>
        </div>
      )}
    </div>
  );
}
