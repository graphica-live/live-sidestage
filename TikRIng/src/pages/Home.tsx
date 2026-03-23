import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { UploadCloud, Link as LinkIcon, Check, Loader2, Move, ChevronDown } from 'lucide-react';
import {
  analyzeFrameTransparency,
  getCircleAutoFit,
  getSquareFrameBlob,
} from '../utils/canvas';

declare const grecaptcha: any;

interface HomeProps {
  user: { id: string; display_name: string; plan: string; isAdmin: boolean } | null | undefined;
}

type AutoFitNotice = {
  tone: 'success' | 'warning' | 'info';
  eyebrow: string;
  label: string;
  detail: string;
};

function pad2(n: number) {
  return n.toString().padStart(2, '0');
}

function formatLocalDateInputValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d: Date, days: number) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + days);
  return nd;
}

export default function Home({ user }: HomeProps) {
  const [uploading, setUploading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameImage, setFrameImage] = useState<string | null>(null);
  const [frameFileName, setFrameFileName] = useState('frame');
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [showMaskIntro, setShowMaskIntro] = useState(false);
  const [showGestureHint, setShowGestureHint] = useState(false);
  const [edgeFilledNotice, setEdgeFilledNotice] = useState(false);
  const [showEdgeTransparencyDialog, setShowEdgeTransparencyDialog] = useState(false);
  const [pendingUploadBlob, setPendingUploadBlob] = useState<Blob | null>(null);
  const [edgeChoiceLoading, setEdgeChoiceLoading] = useState(false);
  const [autoFitNotice, setAutoFitNotice] = useState<AutoFitNotice | null>(null);

  const [proOptionsOpen, setProOptionsOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [expiresDate, setExpiresDate] = useState(() => formatLocalDateInputValue(addDays(new Date(), 90)));
  const [password, setPassword] = useState('');
  const [pendingRecaptchaToken, setPendingRecaptchaToken] = useState<string | null>(null);

  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [proUpgradeOpen, setProUpgradeOpen] = useState(false);
  const [loginOptionsOpen, setLoginOptionsOpen] = useState(false);
  const [showZoomSlider, setShowZoomSlider] = useState(true);

  const editorRef = useRef<HTMLDivElement>(null);

  const isDragging = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const startPosition = useRef({ x: 0, y: 0 });
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const initialPinchDistance = useRef<number | null>(null);
  const initialPinchZoom = useRef<number>(1);
  const adjustingTimeoutRef = useRef<number | null>(null);
  const gestureHintTimeoutRef = useRef<number | null>(null);
  const autoFitNoticeTimeoutRef = useRef<number | null>(null);
  const autoFitRequestRef = useRef(0);
  const autoFittingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (frameImage) {
        URL.revokeObjectURL(frameImage);
      }
      if (adjustingTimeoutRef.current !== null) {
        window.clearTimeout(adjustingTimeoutRef.current);
      }
      if (gestureHintTimeoutRef.current !== null) {
        window.clearTimeout(gestureHintTimeoutRef.current);
      }
      if (autoFitNoticeTimeoutRef.current !== null) {
        window.clearTimeout(autoFitNoticeTimeoutRef.current);
      }
    };
  }, [frameImage]);

  const showAutoFitNotice = useCallback((notice: AutoFitNotice | null) => {
    setAutoFitNotice(notice);
  }, []);

  const dismissAutoFitNotice = useCallback(() => {
    setAutoFitNotice(null);
  }, []);

  const runAutoFit = useCallback(async (imageUrl: string) => {
    const requestId = autoFitRequestRef.current + 1;
    autoFitRequestRef.current = requestId;
    autoFittingRef.current = true;

    try {
      const previewSize = editorRef.current?.clientWidth ?? 600;
      const next = await getCircleAutoFit(imageUrl, previewSize);
      const zoomNudge = 4 / Math.max(previewSize, 1);

      if (autoFitRequestRef.current !== requestId) {
        return;
      }

      if (next.strategy !== 'unsupported-fill') {
        setPosition(next.position);
        setZoom(Math.min(3, next.zoom + zoomNudge));
      }
      showAutoFitNotice(
        next.strategy === 'fill-mask'
          ? {
              tone: 'success',
              eyebrow: 'Auto Fit',
              label: 'フレーム範囲を判定して自動調整しました',
              detail: 'このままドラッグやピンチで、必要なら微調整してください',
            }
          : next.strategy === 'unsupported-fill'
            ? {
                tone: 'warning',
                eyebrow: 'Manual Adjust',
                label: '自動調整は見送りました',
                detail: 'この画像は判定が難しいため、手動で位置と拡大率を調整してください',
              }
            : {
                tone: 'info',
                eyebrow: 'Auto Fit',
                label: '初期配置を自動で調整しました',
                detail: '必要に応じて、そのまま手動で微調整できます',
              }
      );
    } catch (err) {
      console.error('Auto fit failed:', err);
      if (autoFitRequestRef.current === requestId) {
        showAutoFitNotice(null);
      }
    } finally {
      if (autoFitRequestRef.current === requestId) {
        autoFittingRef.current = false;
      }
    }
  }, [showAutoFitNotice]);

  useEffect(() => {
    if (!frameImage) {
      autoFitRequestRef.current += 1;
      showAutoFitNotice(null);
      autoFittingRef.current = false;
      return;
    }

    void runAutoFit(frameImage);
  }, [frameImage, runAutoFit, showAutoFitNotice]);

  useEffect(() => {
    if (!frameImage || shareUrl) {
      setShowMaskIntro(false);
      setShowGestureHint(false);
      return;
    }

    setShowMaskIntro(true);
    setShowGestureHint(true);
    const timerId = window.setTimeout(() => {
      setShowMaskIntro(false);
    }, 2800);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [frameImage, shareUrl]);

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

  useEffect(() => {
    if (autoFitNoticeTimeoutRef.current !== null) {
      window.clearTimeout(autoFitNoticeTimeoutRef.current);
      autoFitNoticeTimeoutRef.current = null;
    }

    if (!autoFitNotice) {
      return;
    }

    autoFitNoticeTimeoutRef.current = window.setTimeout(() => {
      setAutoFitNotice(null);
      autoFitNoticeTimeoutRef.current = null;
    }, 5000);

    return () => {
      if (autoFitNoticeTimeoutRef.current !== null) {
        window.clearTimeout(autoFitNoticeTimeoutRef.current);
        autoFitNoticeTimeoutRef.current = null;
      }
    };
  }, [autoFitNotice]);

  useEffect(() => {
    const updateZoomSliderVisibility = () => {
      const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
      const hasTouchPoints = navigator.maxTouchPoints > 0;
      setShowZoomSlider(!(coarsePointer || hasTouchPoints));
    };

    updateZoomSliderVisibility();
    window.addEventListener('resize', updateZoomSliderVisibility);

    return () => {
      window.removeEventListener('resize', updateZoomSliderVisibility);
    };
  }, []);

  const dismissGestureHint = () => {
    setShowGestureHint(false);
  };

  const startTransientAdjusting = () => {
    setIsAdjusting(true);
    if (adjustingTimeoutRef.current !== null) {
      window.clearTimeout(adjustingTimeoutRef.current);
    }
    adjustingTimeoutRef.current = window.setTimeout(() => {
      setIsAdjusting(false);
      adjustingTimeoutRef.current = null;
    }, 650);
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
    if (!isPng) {
      setError('PNGファイルのみアップロードできます。');
      return;
    }

    const nextFrameImage = URL.createObjectURL(file);

    try {
      const analysis = await analyzeFrameTransparency(nextFrameImage);
      if (analysis.shouldBlockUpload) {
        URL.revokeObjectURL(nextFrameImage);
        setError(
          'この画像は配布用フレームとして使えません。画像選択時点で中央に十分な透過領域が必要です。'
        );
        return;
      }
    } catch (err) {
      URL.revokeObjectURL(nextFrameImage);
      console.error(err);
      setError('画像の内容を確認できませんでした。別のPNG画像を選択してください。');
      return;
    }

    if (frameImage) {
      URL.revokeObjectURL(frameImage);
    }

    setFrameImage(nextFrameImage);
    setFrameFileName(file.name.replace(/\.[^/.]+$/, '') || 'frame');
    setPosition({ x: 0, y: 0 });
    setZoom(1);
    setIsAdjusting(false);
    setShowMaskIntro(false);
    setEdgeFilledNotice(false);
    setShowEdgeTransparencyDialog(false);
    setPendingUploadBlob(null);
    showAutoFitNotice(null);
    setError(null);
    setShareUrl(null);
    setCopied(false);
  }, [frameImage, showAutoFitNotice]);

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
    setIsAdjusting(true);
    dismissGestureHint();
    dismissAutoFitNotice();
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
      setIsAdjusting(false);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    dismissGestureHint();
    dismissAutoFitNotice();
    startTransientAdjusting();
    const zoomFactor = -e.deltaY * 0.002;
    setZoom((prev) => Math.max(0.3, Math.min(3, prev + zoomFactor)));
  };

  const resetFrameEditor = () => {
    autoFitRequestRef.current += 1;
    if (frameImage) {
      URL.revokeObjectURL(frameImage);
    }
    setFrameImage(null);
    setPosition({ x: 0, y: 0 });
    setZoom(1);
    setIsAdjusting(false);
    setShowMaskIntro(false);
    setShowGestureHint(false);
    setEdgeFilledNotice(false);
    setShowEdgeTransparencyDialog(false);
    setPendingUploadBlob(null);
    showAutoFitNotice(null);

    setProOptionsOpen(false);
    setCustomName('');
    setIsUnlimited(false);
    setExpiresDate(formatLocalDateInputValue(addDays(new Date(), 90)));
    setPassword('');
    setPendingRecaptchaToken(null);
  };

  const uploadPreparedFrame = async (preparedBlob: Blob, recaptchaToken?: string | null): Promise<boolean> => {
    const MAX_SIZE = 5 * 1024 * 1024;
    if (preparedBlob.size > MAX_SIZE) {
      setError('編集後の画像サイズが5MBを超えています。縮小して再度お試しください。');
      return false;
    }

    const uploadFile = new File([preparedBlob], `${frameFileName}.png`, { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', uploadFile);

    if (recaptchaToken) {
      formData.append('recaptchaToken', recaptchaToken);
    }

    if (user?.plan === 'pro') {
      if (customName.trim()) {
        formData.append('customName', customName.trim());
      }
      if (!isUnlimited && expiresDate) {
        const expiresAtMs = new Date(`${expiresDate}T00:00:00`).getTime();
        if (!Number.isNaN(expiresAtMs)) {
          formData.append('expiresAt', String(expiresAtMs));
        }
      }
      if (password.trim()) {
        formData.append('password', password.trim());
      }
    }

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      let message: string | null = null;
      try {
        const errorData = await response.json();
        if (errorData && typeof errorData.message === 'string') {
          message = errorData.message;
        }
      } catch {
        // ignore
      }
      throw new Error(message ?? 'Upload failed');
    }

    const data = await response.json();

    let shareToken = data.id;
    if (user) {
      const shareRes = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameId: data.id }),
      });
      if (shareRes.ok) {
        const shareData = await shareRes.json();
        shareToken = shareData.token;
      }
    }

    const url = `${window.location.origin}${window.location.pathname}?f=${shareToken}&openExternalBrowser=1`;
    setShareUrl(url);
    return true;
  };

  const handleUpload = async () => {
    if (!frameImage) return;

    let recaptchaToken: string | null = null;
    try {
      const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;
      if (siteKey && typeof grecaptcha !== 'undefined' && grecaptcha?.execute) {
        recaptchaToken = await new Promise((resolve) => {
          const exec = () => {
            Promise.resolve(grecaptcha.execute(siteKey, { action: 'upload' }))
              .then((t: any) => resolve(typeof t === 'string' ? t : null))
              .catch(() => resolve(null));
          };
          if (typeof grecaptcha.ready === 'function') {
            grecaptcha.ready(exec);
          } else {
            exec();
          }
        });
      }
    } catch {
      // reCAPTCHAが原因でアップロードできない事態を避ける
      recaptchaToken = null;
    }
    setPendingRecaptchaToken(recaptchaToken);

    setUploading(true);
    setError(null);
    setShareUrl(null);
    setCopied(false);
    setEdgeFilledNotice(false);
    setShowEdgeTransparencyDialog(false);
    setPendingUploadBlob(null);

    try {
      const previewSize = editorRef.current?.clientWidth ?? 1024;
      const { blob: squareBlob, hasTransparentBorder } = await getSquareFrameBlob(
        frameImage,
        position,
        zoom,
        1024,
        previewSize,
        { fillTransparentEdges: false }
      );

      if (hasTransparentBorder) {
        setPendingUploadBlob(squareBlob);
        setShowEdgeTransparencyDialog(true);
        return;
      }

      await uploadPreparedFrame(squareBlob, recaptchaToken);
    } catch (err: any) {
      console.error(err);
      setError(err.message || '画像のアップロードに失敗しました。もう一度お試しください。');
    } finally {
      setUploading(false);
    }
  };

  const handleChooseFillEdges = async () => {
    if (!frameImage || edgeChoiceLoading) return;

    setEdgeChoiceLoading(true);
    setUploading(true);

    try {
      const previewSize = editorRef.current?.clientWidth ?? 1024;
      const { blob: filledBlob, edgeFilled } = await getSquareFrameBlob(
        frameImage,
        position,
        zoom,
        1024,
        previewSize,
        { fillTransparentEdges: true }
      );

      const ok = await uploadPreparedFrame(filledBlob, pendingRecaptchaToken);
      if (ok) {
        setEdgeFilledNotice(edgeFilled);
        setShowEdgeTransparencyDialog(false);
        setPendingUploadBlob(null);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || '画像のアップロードに失敗しました。もう一度お試しください。');
    } finally {
      setEdgeChoiceLoading(false);
      setUploading(false);
    }
  };

  const handleChooseKeepTransparent = async () => {
    if (!pendingUploadBlob || edgeChoiceLoading) return;

    setEdgeChoiceLoading(true);
    setUploading(true);

    try {
      const ok = await uploadPreparedFrame(pendingUploadBlob, pendingRecaptchaToken);
      if (ok) {
        setEdgeFilledNotice(false);
        setShowEdgeTransparencyDialog(false);
        setPendingUploadBlob(null);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || '画像のアップロードに失敗しました。もう一度お試しください。');
    } finally {
      setEdgeChoiceLoading(false);
      setUploading(false);
    }
  };

  const handleChooseReadjust = () => {
    if (edgeChoiceLoading) return;
    setShowEdgeTransparencyDialog(false);
    setPendingUploadBlob(null);
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

  const handleCheckout = async () => {
    if (!user) {
      setLoginOptionsOpen(true);
      setError('Proのアップグレードにはログインが必要です。');
      return;
    }
    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval: billingInterval }),
      });
      if (!res.ok) throw new Error('Checkout failed');
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
      } else {
        throw new Error('Missing checkout url');
      }
    } catch {
      setError('チェックアウトの開始に失敗しました。もう一度お試しください。');
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="w-full flex flex-col items-center animate-in fade-in duration-500 max-w-xl">
      {/* ログイン情報 */}
      {user ? (
        <div className="w-full flex items-center justify-between mb-6 px-1">
          <span className="text-sm text-tiktok-lightgray">
            {user.display_name}
            <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-bold ${user.plan === 'pro' ? 'bg-tiktok-cyan/20 text-tiktok-cyan' : 'bg-tiktok-gray text-tiktok-lightgray'}`}>
              {user.plan === 'pro' ? 'Pro' : '無料'}
            </span>
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                window.location.href = '/?dashboard=1';
              }}
              className="text-xs text-tiktok-lightgray hover:text-white underline"
            >
              フレーム管理
            </button>
            <form action="/api/auth/logout" method="post">
              <button type="submit" className="text-xs text-tiktok-lightgray hover:text-white underline">ログアウト</button>
            </form>
          </div>
        </div>
      ) : (
        <div className="w-full flex flex-col gap-3 mb-6">
          <div className="w-full rounded-md border border-tiktok-gray bg-tiktok-dark overflow-hidden">
            <button
              type="button"
              onClick={() => setLoginOptionsOpen((v) => !v)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-tiktok-gray/30 transition-colors"
            >
              <span className="text-xs text-tiktok-lightgray">ログインするとフレームを管理できます（任意）</span>
              <ChevronDown
                className={`w-5 h-5 text-tiktok-lightgray transition-transform ${loginOptionsOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {loginOptionsOpen ? (
              <div className="px-4 pb-4 pt-1 flex flex-col gap-2">
                <a
                  href="/api/auth/google"
                  className="w-full py-2.5 rounded-md bg-white text-black font-bold text-sm text-center hover:bg-white/90 transition-colors"
                >
                  Googleでログイン
                </a>
                <a
                  href="/api/auth/line"
                  className="w-full py-2.5 rounded-md bg-[#06C755] text-white font-bold text-sm text-center hover:bg-[#05B34C] transition-colors"
                >
                  LINEでログイン
                </a>
              </div>
            ) : null}
          </div>
        </div>
      )}

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
            {autoFitNotice ? (
              <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center px-3 sm:top-4 sm:px-4 animate-in fade-in slide-in-from-top-2 duration-300">
                <div
                  className={`w-full max-w-[22rem] rounded-2xl border px-3.5 py-3 text-center shadow-[0_14px_40px_rgba(0,0,0,0.32)] sm:max-w-[28rem] sm:px-4 ${
                    autoFitNotice.tone === 'success'
                      ? 'border-tiktok-cyan/40 bg-[#041E22]/92 text-white shadow-[0_18px_50px_rgba(0,0,0,0.42)]'
                      : autoFitNotice.tone === 'warning'
                        ? 'border-amber-300/45 bg-[#2A1904]/92 text-white shadow-[0_18px_50px_rgba(0,0,0,0.42)]'
                        : 'border-white/12 bg-black/58 text-white backdrop-blur-md'
                  }`}
                >
                  <p
                    className={`text-[11px] font-black uppercase tracking-[0.22em] ${
                      autoFitNotice.tone === 'success'
                        ? 'text-tiktok-cyan'
                        : autoFitNotice.tone === 'warning'
                          ? 'text-amber-200'
                          : 'text-white/60'
                    }`}
                  >
                    {autoFitNotice.eyebrow}
                  </p>
                  <p className="mt-1 text-sm font-bold text-white">{autoFitNotice.label}</p>
                  <p className={`mt-1 text-xs font-medium ${autoFitNotice.tone === 'warning' ? 'text-amber-50/92' : autoFitNotice.tone === 'success' ? 'text-cyan-50/92' : 'text-white/78'}`}>
                    {autoFitNotice.detail}
                  </p>
                </div>
              </div>
            ) : null}
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
              <div className={`editor-crop-mask w-[calc(100%-4px)] h-[calc(100%-4px)] rounded-full border-[2.5px] border-tiktok-cyan/95${showMaskIntro ? ' editor-crop-mask-intro' : isAdjusting ? ' editor-crop-mask-active' : ''}`} />
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
            <div className="absolute inset-0 z-20 pointer-events-none border-2 border-tiktok-cyan/70 rounded-md" />
          </div>

          <div className="-mt-2 w-full rounded-2xl border border-tiktok-cyan/30 bg-tiktok-cyan/12 px-4 py-3 text-center shadow-[0_12px_40px_rgba(37,244,238,0.12)]">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-tiktok-cyan/80">Crop Guide</p>
            <p className="mt-1 text-sm font-bold text-white">
              水色の円が、TikTokでプロフィール画像を登録する際のデフォルトの切り抜き位置の目安です。
            </p>
          </div>

          {showZoomSlider ? (
            <div className="w-full flex items-center gap-3 px-2">
              <Move className="w-4 h-4 text-tiktok-lightgray shrink-0" />
              <span className="text-xs text-tiktok-lightgray shrink-0">縮小</span>
              <input
                type="range"
                value={zoom}
                min={0.3}
                max={3}
                step={0.001}
                aria-labelledby="FrameZoom"
                onChange={(e) => {
                  dismissGestureHint();
                  dismissAutoFitNotice();
                  startTransientAdjusting();
                  setZoom(Number(e.target.value));
                }}
                className="w-full h-1.5 bg-tiktok-gray rounded-full appearance-none cursor-pointer accent-white"
              />
              <span className="text-xs text-tiktok-lightgray shrink-0 font-medium">拡大</span>
            </div>
          ) : null}

          {user?.plan === 'pro' ? (
            <div className="w-full rounded-md border border-tiktok-gray bg-tiktok-dark overflow-hidden">
              <button
                type="button"
                onClick={() => setProOptionsOpen((v) => !v)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-tiktok-gray/30 transition-colors"
              >
                <span className="text-sm font-bold text-white">Proオプション（任意）</span>
                <ChevronDown
                  className={`w-5 h-5 text-tiktok-lightgray transition-transform ${proOptionsOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {proOptionsOpen ? (
                <div className="px-4 pb-4 pt-1 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-white">フレーム名</label>
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      placeholder="例: 2025年春イベント"
                      className="w-full px-3 py-2 rounded-md bg-tiktok-black border border-tiktok-gray focus:outline-none focus:border-tiktok-cyan text-sm"
                    />
                    <p className="text-xs text-tiktok-lightgray">未入力の場合はアップロード時のファイル名を使用します</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-white">有効期限</label>
                    <div className="flex items-center gap-3">
                      <label className="inline-flex items-center gap-2 text-sm text-tiktok-lightgray shrink-0">
                        <input
                          type="checkbox"
                          checked={isUnlimited}
                          onChange={(e) => setIsUnlimited(e.target.checked)}
                          className="accent-white"
                        />
                        無期限
                      </label>
                      <input
                        type="date"
                        value={expiresDate}
                        onChange={(e) => setExpiresDate(e.target.value)}
                        min={formatLocalDateInputValue(addDays(new Date(), 1))}
                        disabled={isUnlimited}
                        className="flex-1 px-3 py-2 rounded-md bg-tiktok-black border border-tiktok-gray focus:outline-none focus:border-tiktok-cyan text-sm disabled:opacity-60"
                      />
                    </div>
                    <p className="text-xs text-tiktok-lightgray">デフォルトは90日後です（無期限も選べます）</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-bold text-white">パスワード（設定するとリスナーに入力を求めます）</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="半角英数字"
                      className="w-full px-3 py-2 rounded-md bg-tiktok-black border border-tiktok-gray focus:outline-none focus:border-tiktok-cyan text-sm"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

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

      {showEdgeTransparencyDialog && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[1px] flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-tiktok-dark p-5 shadow-2xl text-center">
            <h3 className="text-lg font-bold text-white mb-2">フレーム端に透過があります</h3>
            <p className="text-sm text-tiktok-lightgray mb-5">
              端の透過部分は、リスナー画像がはみ出して見える原因になります。どうしますか？
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleChooseFillEdges}
                disabled={edgeChoiceLoading}
                className="w-full py-3 rounded-md bg-tiktok-cyan/20 border border-tiktok-cyan/40 text-tiktok-cyan font-bold hover:bg-tiktok-cyan/25 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                埋め立てる
              </button>
              <button
                onClick={handleChooseKeepTransparent}
                disabled={edgeChoiceLoading}
                className="w-full py-3 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 text-white font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                透過のまま
              </button>
              <button
                onClick={handleChooseReadjust}
                disabled={edgeChoiceLoading}
                className="w-full py-3 rounded-md border border-tiktok-lightgray/40 text-tiktok-lightgray hover:text-white hover:border-white/40 font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                位置を調整しなおす
              </button>
            </div>
          </div>
        </div>
      )}

      {user !== undefined && user?.plan !== 'pro' ? (
        <div className="w-full mt-10 rounded-md border border-tiktok-gray bg-tiktok-dark overflow-hidden">
          <button
            type="button"
            onClick={() => setProUpgradeOpen((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-tiktok-gray/30 transition-colors"
          >
            <div className="flex flex-col">
              <span className="text-sm font-bold text-white">Pro（任意）</span>
              <span className="text-xs text-tiktok-lightgray">無料のままでOK。必要なら開いてください</span>
            </div>
            <ChevronDown
              className={`w-5 h-5 text-tiktok-lightgray transition-transform ${proUpgradeOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {proUpgradeOpen ? (
            <div className="px-4 pb-4 pt-2">
              <ul className="mb-3 text-xs text-tiktok-lightgray space-y-1 list-disc pl-5">
                <li>有効期限を自由に設定（1日〜無期限）</li>
                <li>フレームにパスワードを設定</li>
                <li>フレームに名前を付けて整理・管理しやすく</li>
              </ul>

              {!user ? (
                <div className="mb-3 rounded-md border border-tiktok-cyan/20 bg-tiktok-black px-3 py-3">
                  <p className="text-xs text-tiktok-lightgray mb-3">Proのアップグレードにはログインが必要です。ログイン後、そのまま決済へ進めます。</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <a
                      href="/api/auth/google"
                      className="w-full py-2.5 rounded-md bg-white text-black font-bold text-sm text-center hover:bg-white/90 transition-colors"
                    >
                      Googleでログイン
                    </a>
                    <a
                      href="/api/auth/line"
                      className="w-full py-2.5 rounded-md bg-[#06C755] text-white font-bold text-sm text-center hover:bg-[#05B34C] transition-colors"
                    >
                      LINEでログイン
                    </a>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <label
                  className={`rounded-md border px-3 py-2 cursor-pointer transition-colors ${billingInterval === 'monthly'
                    ? 'border-tiktok-cyan/50 bg-tiktok-cyan/10'
                    : 'border-tiktok-gray bg-tiktok-black'}
                  `}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="billingInterval"
                      value="monthly"
                      checked={billingInterval === 'monthly'}
                      onChange={() => setBillingInterval('monthly')}
                      className="accent-white"
                    />
                    <span className="text-sm font-bold text-white">月払い 380円/月</span>
                  </div>
                </label>

                <label
                  className={`rounded-md border px-3 py-2 cursor-pointer transition-colors ${billingInterval === 'yearly'
                    ? 'border-tiktok-cyan/50 bg-tiktok-cyan/10'
                    : 'border-tiktok-gray bg-tiktok-black'}
                  `}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="billingInterval"
                        value="yearly"
                        checked={billingInterval === 'yearly'}
                        onChange={() => setBillingInterval('yearly')}
                        className="accent-white"
                      />
                      <span className="text-sm font-bold text-white">年払い 3,800円/年</span>
                    </div>
                    {billingInterval === 'yearly' ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-tiktok-cyan/20 text-tiktok-cyan border border-tiktok-cyan/30 shrink-0">
                        2ヶ月分お得
                      </span>
                    ) : null}
                  </div>
                </label>
              </div>

              {user ? (
                <button
                  type="button"
                  onClick={handleCheckout}
                  disabled={checkoutLoading}
                  className="w-full mt-3 py-2.5 px-4 rounded-md bg-tiktok-red hover:bg-[#D92648] text-white font-bold transition-colors shadow-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {checkoutLoading ? 'チェックアウトを準備中...' : 'Proにアップグレードする'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
