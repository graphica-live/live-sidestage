import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Download, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react';
import { getCroppedAndMergedImg } from '../utils/canvas';

interface FrameEditorProps {
  id: string;
}

export default function FrameEditor({ id }: FrameEditorProps) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [userImage, setUserImage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 }); // Custom Position State

  // Dragging & Pinching states
  const isDragging = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const startPosition = useRef({ x: 0, y: 0 });
  const activePointers = useRef<Map<number, { x: number, y: number }>>(new Map());
  const initialPinchDistance = useRef<number | null>(null);
  const initialPinchZoom = useRef<number>(1);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadStartedNotice, setDownloadStartedNotice] = useState(false);
  const [downloadNoticeText, setDownloadNoticeText] = useState('保存を開始しました');
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  // 初回マウント時にR2からフレーム画像を取得
  useEffect(() => {
    async function fetchFrame() {
      if (!id) {
        setError('無効なURLです。');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        // GET /api/frames/[id]
        const response = await fetch(`/api/frames/${id}`);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('フレームが見つかりません。URLが間違っているか、削除された可能性があります。');
          }
          if (response.status === 410) {
            throw new Error('このURLの有効期限（90日間）が切れました。再度新しいURLを発行してもらってください。');
          }
          throw new Error('フレームの取得に失敗しました。');
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setFrameUrl(url);
      } catch (err: unknown) {
        console.error(err);
        setError(err instanceof Error ? err.message : '予期せぬエラーが発生しました。');
      } finally {
        setLoading(false);
      }
    }

    fetchFrame();

    return () => {
      // クリーンアップ
      if (frameUrl) {
        URL.revokeObjectURL(frameUrl);
      }
    };
  }, [id]);



  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const imageUrl = URL.createObjectURL(file);
      setUserImage(imageUrl);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
    maxFiles: 1,
    multiple: false
  });

  // Custom Drag & Zoom Handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 1) {
      isDragging.current = true;
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      startPosition.current = { ...position };
    } else if (activePointers.current.size === 2) {
      isDragging.current = false; // Stop dragging to focus on pinch
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      initialPinchDistance.current = dist;
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
      let newZoom = initialPinchZoom.current * zoomRatio;

      newZoom = Math.max(0.3, Math.min(3, newZoom));
      setZoom(newZoom);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(e.pointerId);
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (activePointers.current.size < 2) {
      initialPinchDistance.current = null;
    }

    if (activePointers.current.size === 1) {
      // Revert to drag mode for the remaining finger
      const pts = Array.from(activePointers.current.values());
      isDragging.current = true;
      dragStartPos.current = { x: pts[0].x, y: pts[0].y };
      startPosition.current = { ...position };
    } else if (activePointers.current.size === 0) {
      isDragging.current = false;
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    // Mouse wheel zoom support
    const zoomFactor = -e.deltaY * 0.002;
    setZoom((prev) => Math.max(0.3, Math.min(3, prev + zoomFactor)));
  };

  const handleDownload = async () => {
    if (!userImage || !frameUrl) return;

    try {
      setDownloading(true);
      setDownloadStartedNotice(false);
      // Pass the customized parameters to our new canvas logic
      const outputImage = await getCroppedAndMergedImg(userImage, position, zoom, frameUrl);

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const randomSuffix = Math.random().toString(36).slice(2, 8);
      const filename = `profile-with-frame-${timestamp}-${randomSuffix}.png`;
      const outputBlob = await (await fetch(outputImage)).blob();
      const outputFile = new File([outputBlob], filename, { type: 'image/png' });

      const canShareFile =
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [outputFile] });

      if (canShareFile) {
        try {
          await navigator.share({
            files: [outputFile],
            title: 'プロフィール画像',
            text: '共有メニューで「画像を保存」を選択してください。',
          });

          setDownloadNoticeText('共有メニューを開きました。「画像を保存」を選ぶと写真アプリに保存できます');
          setDownloadStartedNotice(true);
          if (noticeTimerRef.current !== null) {
            window.clearTimeout(noticeTimerRef.current);
          }
          noticeTimerRef.current = window.setTimeout(() => {
            setDownloadStartedNotice(false);
          }, 5000);
          return;
        } catch (shareErr) {
          // ユーザーが共有をキャンセルした場合はエラー扱いにせず通常ダウンロードにフォールバック
          if (!(shareErr instanceof DOMException && shareErr.name === 'AbortError')) {
            console.error('Share failed, fallback to download:', shareErr);
          }
        }
      }

      // ダウンロード処理
      const link = document.createElement('a');
      const blobUrl = URL.createObjectURL(outputBlob);
      link.download = filename;
      link.href = blobUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);

      setDownloadNoticeText('保存を開始しました。見つからない場合は「ダウンロード」フォルダをご確認ください');
      setDownloadStartedNotice(true);
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
      noticeTimerRef.current = window.setTimeout(() => {
        setDownloadStartedNotice(false);
      }, 4000);
    } catch (err) {
      console.error(err);
      alert('画像の合成に失敗しました。');
    } finally {
      setDownloading(false);
    }
  };

  const resetImage = () => {
    if (userImage) {
      URL.revokeObjectURL(userImage);
    }
    setUserImage(null);
    setPosition({ x: 0, y: 0 });
    setZoom(1);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-12 h-12 animate-spin text-tiktok-cyan mb-4" />
        <p className="text-tiktok-lightgray">フレームを読み込み中...</p>
      </div>
    );
  }

  if (error || !frameUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in">
        <AlertCircle className="w-16 h-16 text-tiktok-red mb-4" />
        <h2 className="text-xl font-bold mb-2">エラー</h2>
        <p className="text-tiktok-lightgray">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center animate-in fade-in duration-500 max-w-xl">
      <h1 className="text-3xl font-black mb-2 text-center text-white tracking-tight glitch-text" data-text="TikRing">TikRing</h1>
      <p className="text-tiktok-lightgray flex flex-col items-center text-center gap-1 mb-8 text-sm font-medium">
        <span>好きな画像を選んで、アイコンフレームを装着しましょう！</span>
        <span className="text-xs text-tiktok-lightgray/70 mt-1">
          ※このページの有効期限は作成から約3ヶ月です
        </span>
      </p>

      {!userImage ? (
        <div className="w-full flex flex-col items-center gap-6">
          {/* 追加: 装着されるフレームのプレビュー */}
          {frameUrl && (
            <div className="w-48 h-48 sm:w-64 sm:h-64 rounded-md bg-tiktok-dark border border-tiktok-gray overflow-hidden relative shadow-lg">
              <div className="absolute inset-0 bg-tiktok-gray/30" />
              <div
                className="absolute inset-0 bg-contain bg-center bg-no-repeat w-full h-full"
                style={{ backgroundImage: `url(${frameUrl})` }}
              />
              <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
                <div className="w-[calc(100%-4px)] h-[calc(100%-4px)] rounded-full border-2 border-white/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.28)]" />
              </div>
            </div>
          )}

          {frameUrl && (
            <p className="text-xs text-tiktok-lightgray/90 text-center -mt-2">
              薄い円の内側が、TikTokプロフィール画像の表示目安です。
            </p>
          )}

          {/* 画像アップロードUI */}
          <div
            {...getRootProps()}
            className={`w-full p-8 rounded-md border-2 border-dashed flex flex-col items-center justify-center transition-all cursor-pointer relative group
              ${isDragActive ? 'border-tiktok-cyan bg-tiktok-cyan/10' : 'border-tiktok-gray bg-tiktok-dark hover:border-tiktok-lightgray/50 hover:bg-tiktok-gray/30'}
            `}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-tiktok-gray/50 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <ImageIcon className="w-8 h-8 text-tiktok-lightgray group-hover:text-white transition-colors" />
              </div>
              <div>
                <p className="text-lg font-bold mb-1 group-hover:text-tiktok-cyan transition-colors">あなたの画像を選択</p>
                <p className="text-sm text-tiktok-lightgray">カメラロールやフォルダから選ぶ</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        // 編集・クロップUI
        <div className="w-full flex flex-col items-center gap-6">
          <div
            className="relative w-full aspect-square rounded-md overflow-hidden bg-tiktok-dark shadow-2xl cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          >
            {/* User Image Layer */}
            <div className="absolute inset-0 flex items-center justify-center z-0 overflow-visible">
              <img
                src={userImage}
                alt="User content"
                draggable={false}
                style={{
                  transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                  transformOrigin: 'center center',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  objectFit: 'contain'
                }}
              />
            </div>

            {/* Foreground Frame Overlay */}
            <div
              className="absolute inset-0 z-10 pointer-events-none bg-contain bg-center bg-no-repeat w-full h-full"
              style={{ backgroundImage: `url(${frameUrl})` }}
            />

            {/* TikTok circular crop guide */}
            <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
              <div className="w-[calc(100%-4px)] h-[calc(100%-4px)] rounded-full border-2 border-white/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.28)]" />
            </div>
          </div>

          <p className="text-xs text-tiktok-lightgray/90 text-center -mt-2">
            薄い円の内側が、TikTokプロフィール画像の表示目安です。
          </p>

          {/* スライダー */}
          <div className="w-full flex items-center gap-4 px-4">
            <span className="text-xs text-tiktok-lightgray shrink-0">縮小</span>
            <input
              type="range"
              value={zoom}
              min={0.3} // 1未満の縮小を許可
              max={3}
              step={0.1}
              aria-labelledby="Zoom"
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full h-1.5 bg-tiktok-gray rounded-full appearance-none cursor-pointer accent-white"
            />
            <span className="text-xs text-tiktok-lightgray shrink-0 font-medium">拡大</span>
          </div>

          <div className="flex w-full gap-3 mt-4">
            <button
              onClick={resetImage}
              className="flex-[0.8] py-3.5 px-4 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 font-bold transition-colors text-sm"
            >
              選び直す
            </button>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex-[1.2] py-3.5 px-4 rounded-md bg-tiktok-red hover:bg-[#D92648] text-white font-bold transition-colors shadow-lg flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  画像を保存しています...
                </>
              ) : downloadStartedNotice ? (
                <>
                  <Download className="w-4 h-4" />
                  保存ガイドを表示中
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  保存する
                </>
              )}
            </button>
          </div>

          {downloadStartedNotice && !downloading && (
            <div className="w-full rounded-md border border-tiktok-cyan/35 bg-tiktok-cyan/10 p-3 text-center animate-in fade-in duration-300">
              <p className="text-sm font-bold text-tiktok-cyan">保存の案内</p>
              <p className="text-xs text-tiktok-lightgray mt-1">{downloadNoticeText}</p>
            </div>
          )}

          {downloading && (
            <div className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[1px] flex items-center justify-center px-6">
              <div className="w-full max-w-sm rounded-xl border border-white/15 bg-tiktok-dark p-6 text-center shadow-2xl">
                <Loader2 className="w-8 h-8 animate-spin text-tiktok-cyan mx-auto mb-3" />
                <p className="text-base font-bold text-white">画像を保存しています...</p>
                <p className="text-xs text-tiktok-lightgray mt-2">このまま少しお待ちください</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
