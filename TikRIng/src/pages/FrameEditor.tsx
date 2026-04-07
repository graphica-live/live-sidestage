import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { Download, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react';
import CropMaskOverlay from '../components/CropMaskOverlay';
import { getCroppedAndMergedImg, getFrameOpeningMaskDataUrl } from '../utils/canvas';
import DonationCard from '../components/DonationCard';
import FrameRankingAccordion from '../components/FrameRankingAccordion';

interface FrameEditorProps {
  id: string;
  user?: {
    email?: string | null;
  } | null;
}

export default function FrameEditor({ id, user }: FrameEditorProps) {
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameOpeningMaskUrl, setFrameOpeningMaskUrl] = useState<string | null>(null);
  const [hasSavedOpeningMask, setHasSavedOpeningMask] = useState(false);
  const [userImage, setUserImage] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 }); // Custom Position State
  const [showGestureHint, setShowGestureHint] = useState(false);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [isAdjusting, setIsAdjusting] = useState(false);

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
  const adjustingTimerRef = useRef<number | null>(null);
  const gestureHintTimeoutRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const returnPath = `/?f=${encodeURIComponent(id)}`;
  const canShowRanking = (user?.email ?? '').trim().toLowerCase() === 'joe.graphica@gmail.com';

  const recordWearCount = useCallback(() => {
    const wearUrl = new URL(`/api/frames/${id}`, window.location.origin);
    wearUrl.searchParams.set('wear', '1');
    if (accessToken) {
      wearUrl.searchParams.set('accessToken', accessToken);
    }

    void fetch(wearUrl.toString(), {
      method: 'POST',
      keepalive: true,
    }).catch((err) => {
      console.error('Failed to record wear count:', err);
    });
  }, [accessToken, id]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
      if (adjustingTimerRef.current !== null) {
        window.clearTimeout(adjustingTimerRef.current);
      }
      if (gestureHintTimeoutRef.current !== null) {
        window.clearTimeout(gestureHintTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!userImage) {
      setShowGestureHint(false);
      return;
    }

    setShowGestureHint(true);
  }, [userImage]);

  useEffect(() => {
    if (gestureHintTimeoutRef.current !== null) {
      window.clearTimeout(gestureHintTimeoutRef.current);
      gestureHintTimeoutRef.current = null;
    }

    if (!showGestureHint) {
      return;
    }

    gestureHintTimeoutRef.current = window.setTimeout(() => {
      setShowGestureHint(false);
      gestureHintTimeoutRef.current = null;
    }, 5000);

    return () => {
      if (gestureHintTimeoutRef.current !== null) {
        window.clearTimeout(gestureHintTimeoutRef.current);
        gestureHintTimeoutRef.current = null;
      }
    };
  }, [showGestureHint]);

  const dismissGestureHint = () => {
    setShowGestureHint(false);
  };

  const startTransientAdjusting = () => {
    setIsAdjusting(true);
    if (adjustingTimerRef.current !== null) {
      window.clearTimeout(adjustingTimerRef.current);
    }
    adjustingTimerRef.current = window.setTimeout(() => {
      setIsAdjusting(false);
      adjustingTimerRef.current = null;
    }, 650);
  };

  // 初回マウント時にR2からフレーム画像を取得
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;

    async function fetchFrame() {
      if (!id) {
        setError('無効なURLです。');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        setPasswordError(null);

        const metaUrl = new URL(`/api/frames/${id}`, window.location.origin);
        metaUrl.searchParams.set('meta', '1');
        metaUrl.searchParams.set('_t', String(Date.now()));
        if (accessToken) {
          metaUrl.searchParams.set('accessToken', accessToken);
        }

        const metaResponse = await fetch(metaUrl.toString(), {
          signal: controller.signal,
        });

        if (!metaResponse.ok) {
          if (metaResponse.status === 404) {
            throw new Error('フレームが見つかりません。URLが間違っているか、削除された可能性があります。');
          }
          if (metaResponse.status === 410) {
            throw new Error('このURLの有効期限が切れました。再度新しいURLを発行してもらってください。');
          }
          throw new Error('フレームの取得に失敗しました。');
        }

        const meta = await metaResponse.json();
        const nextRequiresPassword = Boolean(meta?.requiresPassword);
        const nextAccessGranted = Boolean(meta?.accessGranted);
        const nextHasSavedOpeningMask = Boolean(meta?.hasOpeningMask);

        setRequiresPassword(nextRequiresPassword);
        setAccessGranted(nextAccessGranted);
        setHasSavedOpeningMask(nextHasSavedOpeningMask);

        if (nextRequiresPassword && !nextAccessGranted) {
          setFrameUrl((current) => {
            if (current) {
              URL.revokeObjectURL(current);
            }
            return null;
          });
          setFrameOpeningMaskUrl(null);
          setLoading(false);
          return;
        }

        const frameUrlRequest = new URL(`/api/frames/${id}`, window.location.origin);
        frameUrlRequest.searchParams.set('_t', String(Date.now()));
        if (accessToken) {
          frameUrlRequest.searchParams.set('accessToken', accessToken);
        }

        const response = await fetch(frameUrlRequest.toString(), {
          signal: controller.signal,
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('フレームが見つかりません。URLが間違っているか、削除された可能性があります。');
          }
          if (response.status === 410) {
            throw new Error('このURLの有効期限が切れました。再度新しいURLを発行してもらってください。');
          }
          if (response.status === 401) {
            setRequiresPassword(true);
            setAccessGranted(false);
            setFrameUrl((current) => {
              if (current) {
                URL.revokeObjectURL(current);
              }
              return null;
            });
            setFrameOpeningMaskUrl(null);
            setLoading(false);
            return;
          }
          throw new Error('フレームの取得に失敗しました。');
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        setFrameUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }
          return objectUrl;
        });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        console.error(err);
        setError(err instanceof Error ? err.message : '予期せぬエラーが発生しました。');
      } finally {
        setLoading(false);
      }
    }

    fetchFrame();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [id, accessToken]);

  useEffect(() => {
    return () => {
      if (frameUrl) {
        URL.revokeObjectURL(frameUrl);
      }
    };
  }, [frameUrl]);

  useEffect(() => {
    let cancelled = false;

    if (!frameUrl) {
      setFrameOpeningMaskUrl(null);
      return;
    }

    if (hasSavedOpeningMask) {
      const maskUrl = new URL(`/api/frames/${id}`, window.location.origin);
      maskUrl.searchParams.set('mask', '1');
      maskUrl.searchParams.set('_t', String(Date.now()));
      if (accessToken) {
        maskUrl.searchParams.set('accessToken', accessToken);
      }
      setFrameOpeningMaskUrl(maskUrl.toString());
      return;
    }

    const loadOpeningMask = async () => {
      try {
        const nextMaskUrl = await getFrameOpeningMaskDataUrl(frameUrl);
        if (!cancelled) {
          setFrameOpeningMaskUrl(nextMaskUrl);
        }
      } catch (err) {
        console.error('Failed to build frame opening mask:', err);
        if (!cancelled) {
          setFrameOpeningMaskUrl(null);
        }
      }
    };

    void loadOpeningMask();

    return () => {
      cancelled = true;
    };
  }, [frameUrl, hasSavedOpeningMask, id, accessToken]);

  const handleUnlock = async () => {
    if (!password.trim()) {
      setPasswordError('パスワードを入力してください。');
      return;
    }

    try {
      setUnlocking(true);
      setPasswordError(null);

      const response = await fetch(`/api/frames/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: password.trim() }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          setPasswordError('パスワードが違います。');
          return;
        }
        if (response.status === 410) {
          setError('このURLの有効期限が切れました。再度新しいURLを発行してもらってください。');
          return;
        }
        throw new Error('パスワード確認に失敗しました。');
      }

      const data = await response.json();
      const nextAccessToken = typeof data?.accessToken === 'string' ? data.accessToken : null;
      if (!nextAccessToken) {
        throw new Error('アクセストークンの発行に失敗しました。');
      }

      setAccessToken(nextAccessToken);
      setAccessGranted(true);
      setPassword('');
    } catch (err) {
      console.error(err);
      setPasswordError('パスワード確認に失敗しました。もう一度お試しください。');
    } finally {
      setUnlocking(false);
    }
  };



  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      if (userImage) {
        URL.revokeObjectURL(userImage);
      }
      const imageUrl = URL.createObjectURL(file);
      setUserImage(imageUrl);
    }
  }, [userImage]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
    maxFiles: 1,
    multiple: false
  });

  // Custom Drag & Zoom Handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dismissGestureHint();
    startTransientAdjusting();
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
      startTransientAdjusting();
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      setPosition({
        x: startPosition.current.x + dx,
        y: startPosition.current.y + dy,
      });
    } else if (activePointers.current.size === 2 && initialPinchDistance.current !== null) {
      startTransientAdjusting();
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
    dismissGestureHint();
    const zoomFactor = -e.deltaY * 0.002;
    startTransientAdjusting();
    setZoom((prev) => Math.max(0.3, Math.min(3, prev + zoomFactor)));
  };

  const handleDownload = async () => {
    if (!userImage || !frameUrl) return;

    try {
      setDownloading(true);
      setDownloadStartedNotice(false);
      // Pass the customized parameters to our new canvas logic
      const previewSize = editorRef.current?.clientWidth ?? 600;
      const outputImage = await getCroppedAndMergedImg(
        userImage,
        position,
        zoom,
        frameUrl,
        previewSize,
        frameOpeningMaskUrl
      );

      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const randomSuffix = Math.random().toString(36).slice(2, 8);
      const filename = `TikRing-${timestamp}-${randomSuffix}.png`;
      const outputBlob = await (await fetch(outputImage)).blob();
      const outputFile = new File([outputBlob], filename, { type: 'image/png' });
      recordWearCount();
      const ua = navigator.userAgent;
      const isAndroid = /Android/i.test(ua);
      const isIOSLike = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

      const canShareFile =
        isIOSLike &&
        !isAndroid &&
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
    dismissGestureHint();
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

  if (requiresPassword && !accessGranted) {
    return (
      <div className="w-full flex flex-col items-center animate-in fade-in duration-500 max-w-md text-center">
        <div className="w-16 h-16 rounded-full bg-tiktok-cyan/15 flex items-center justify-center mb-5 border border-tiktok-cyan/25">
          <AlertCircle className="w-8 h-8 text-tiktok-cyan" />
        </div>
        <h1 className="text-3xl font-black mb-2 text-center text-white tracking-tight glitch-text" data-text="TikRing">
          <a
            href="/"
            aria-label="トップへ戻る"
            className="inline-block rounded-sm hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-tiktok-cyan/50"
          >
            TikRing
          </a>
        </h1>
        <h2 className="text-xl font-bold mb-2">パスワード保護されたフレームです</h2>
        <p className="text-tiktok-lightgray text-sm mb-6">
          配信者から共有されたパスワードを入力すると、フレームを表示できます。
        </p>
        <div className="w-full rounded-md border border-tiktok-gray bg-tiktok-dark p-5 text-left">
          <label className="block text-sm font-bold text-white mb-2">パスワード</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleUnlock();
              }
            }}
            placeholder="パスワードを入力"
            className="w-full px-3 py-2 rounded-md bg-tiktok-black border border-tiktok-gray focus:outline-none focus:border-tiktok-cyan text-sm"
          />
          {passwordError ? (
            <p className="mt-2 text-sm text-tiktok-red">{passwordError}</p>
          ) : null}
          <button
            type="button"
            onClick={() => void handleUnlock()}
            disabled={unlocking}
            className="w-full mt-4 py-3 rounded-md bg-tiktok-red hover:bg-[#D92648] text-white font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {unlocking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                確認中...
              </>
            ) : (
              'フレームを表示する'
            )}
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in">
        <AlertCircle className="w-16 h-16 text-tiktok-red mb-4" />
        <h2 className="text-xl font-bold mb-2">エラー</h2>
        <p className="text-tiktok-lightgray">{error}</p>
      </div>
    );
  }

  if (!frameUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Loader2 className="w-12 h-12 animate-spin text-tiktok-cyan mb-4" />
        <p className="text-tiktok-lightgray">フレームを読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center animate-in fade-in duration-500 max-w-xl">
      <h1 className="text-3xl font-black mb-2 text-center text-white tracking-tight glitch-text" data-text="TikRing">
        <a
          href="/"
          aria-label="トップへ戻る"
          className="inline-block rounded-sm hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-tiktok-cyan/50"
        >
          TikRing
        </a>
      </h1>
      <p className="text-tiktok-lightgray flex flex-col items-center text-center gap-1 mb-8 text-sm font-medium">
        <span>好きな画像を選んで、アイコンフレームを装着しましょう！</span>

      </p>

      {!userImage ? (
        <div className="w-full flex flex-col items-center gap-6">
          {/* 追加: 装着されるフレームのプレビュー */}
          {frameUrl && (
            <div className="relative w-48 h-48 sm:w-64 sm:h-64">
              <div className="absolute inset-0 rounded-md bg-tiktok-dark border border-tiktok-gray overflow-hidden shadow-lg">
                <div className="absolute inset-0 bg-[#f8fafc] bg-[linear-gradient(45deg,#d1d5db_25%,transparent_25%),linear-gradient(-45deg,#d1d5db_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#d1d5db_75%),linear-gradient(-45deg,transparent_75%,#d1d5db_75%)] bg-[length:28px_28px] bg-[position:0_0,0_14px,14px_-14px,-14px_0px]" />
                <div
                  className="absolute inset-0 bg-contain bg-center bg-no-repeat w-full h-full"
                  style={{ backgroundImage: `url(${frameUrl})` }}
                />
              </div>
              <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
                <CropMaskOverlay />
              </div>
            </div>
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
            ref={editorRef}
            className="relative w-full aspect-square cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
          >
            <div className="absolute inset-0 overflow-hidden rounded-md bg-tiktok-dark shadow-2xl">
              <div className="absolute inset-0 bg-[#f8fafc] bg-[linear-gradient(45deg,#d1d5db_25%,transparent_25%),linear-gradient(-45deg,#d1d5db_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#d1d5db_75%),linear-gradient(-45deg,transparent_75%,#d1d5db_75%)] bg-[length:28px_28px] bg-[position:0_0,0_14px,14px_-14px,-14px_0px]" />
              <div
                className="absolute inset-0 flex items-center justify-center z-0 overflow-visible"
                style={frameOpeningMaskUrl ? {
                  maskImage: `url(${frameOpeningMaskUrl})`,
                  maskPosition: 'center',
                  maskRepeat: 'no-repeat',
                  maskSize: '100% 100%',
                  WebkitMaskImage: `url(${frameOpeningMaskUrl})`,
                  WebkitMaskPosition: 'center',
                  WebkitMaskRepeat: 'no-repeat',
                  WebkitMaskSize: '100% 100%',
                } : undefined}
              >
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

              <div
                className="absolute inset-0 z-10 pointer-events-none bg-contain bg-center bg-no-repeat w-full h-full"
                style={{ backgroundImage: `url(${frameUrl})` }}
              />
            </div>

            <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
              <CropMaskOverlay active={isAdjusting} />
            </div>

            <div
              className={`editor-gesture-hint absolute inset-x-0 bottom-3 z-30 pointer-events-none flex justify-center px-3 sm:bottom-4 sm:px-4${showGestureHint ? ' editor-gesture-hint-visible' : ''}`}
              aria-hidden={!showGestureHint}
            >
              <div className="editor-gesture-card w-full max-w-[18rem] rounded-[1.5rem] border border-white/12 px-3.5 py-3 text-white shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-md sm:max-w-[21rem] sm:rounded-[1.75rem] sm:px-4">
                <div className="flex items-center gap-3">
                  <div className="editor-gesture-figure editor-gesture-figure-drag" aria-hidden="true">
                    <span className="editor-gesture-drag-base" />
                    <span className="editor-gesture-drag-layer" />
                    <span className="editor-gesture-drag-touch" />
                    <span className="editor-gesture-arrow editor-gesture-arrow-up" />
                    <span className="editor-gesture-arrow editor-gesture-arrow-down" />
                    <span className="editor-gesture-arrow editor-gesture-arrow-pan-left" />
                    <span className="editor-gesture-arrow editor-gesture-arrow-pan-right" />
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/55">Drag</p>
                    <p className="mt-1 text-sm font-bold leading-tight">ドラッグして位置調整</p>
                  </div>
                </div>

                <div className="mt-3 h-px bg-white/8" />

                <div className="mt-3 flex items-center gap-3">
                  <div className="editor-gesture-figure editor-gesture-figure-pinch" aria-hidden="true">
                    <span className="editor-gesture-touch editor-gesture-touch-left" />
                    <span className="editor-gesture-touch editor-gesture-touch-right" />
                    <span className="editor-gesture-arrow editor-gesture-arrow-left" />
                    <span className="editor-gesture-arrow editor-gesture-arrow-right" />
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-white/55">Pinch</p>
                    <p className="mt-1 text-sm font-bold leading-tight">ピンチして拡大縮小</p>
                  </div>
                </div>

                <p className="mt-3 text-center text-[11px] font-medium tracking-[0.08em] text-white/48">
                  約5秒後、または最初の操作で消えます
                </p>
              </div>
            </div>
          </div>

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
              onChange={(e) => {
                dismissGestureHint();
                startTransientAdjusting();
                setZoom(Number(e.target.value));
              }}
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

      <div className="w-full mt-8">
        <DonationCard returnPath={returnPath} compact />
      </div>

      {canShowRanking ? (
        <div className="w-full mt-6">
          <div className="space-y-4">
            <FrameRankingAccordion
              title="ピックアップ"
              eyebrow="Pickup"
              closedSummary="全フレームの中からランダムで10件を表示"
              rankingType="pickup"
            />
            <FrameRankingAccordion
              title="人気のアイコンフレーム"
              eyebrow="Ranking"
              closedSummary="今月の閲覧数が多いフレームTOP10を見る"
            />
            <FrameRankingAccordion
              title="グッド数の多いアイコンフレーム"
              eyebrow="Ranking"
              closedSummary="グッド数の多いフレームTOP10を見る"
              rankingType="goods"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
