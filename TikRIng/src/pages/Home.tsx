import { useState, useCallback, useEffect, useRef } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { UploadCloud, Link as LinkIcon, Check, Loader2, ChevronDown, CircleHelp } from 'lucide-react';
import CropMaskOverlay from '../components/CropMaskOverlay';
import {
  analyzeFrameTransparency,
  getEditorCropRadiusRatio,
  getFrameBackgroundTransparencySuggestion,
  getCircleAutoFit,
  getSharePreviewBlob,
  getSquareFrameOpeningMaskBlob,
  getSquareFrameBlob,
  getTikTokLiveCommentAvatarPreviewDataUrl,
  isTransparentCenterWithinCropMask,
} from '../utils/canvas';

declare const grecaptcha: any;

interface HomeProps {
  user: { id: string; display_name: string; plan: string; isAdmin: boolean; email?: string | null } | null | undefined;
}

type AutoFitNotice = {
  tone: 'success' | 'warning' | 'info';
  eyebrow: string;
  label: string;
  detail: string;
};

type BackgroundTransparencyDialogState = {
  fileName: string;
  originalUrl: string;
  suggestedUrl: string;
  suggestedCoverageRatio: number;
  suggestedColorCss: string;
};

type UploadConfirmationState = {
  preparedBlob: Blob;
  openingMaskBlob: Blob | null;
  preparedFrameUrl: string;
  openingMaskUrl: string | null;
  avatarPreviewUrl: string;
};

const updateHistory = [
  {
    date: '2026.03.26',
    title: '楕円形やフレーム外側に細かい装飾ある透過フレームに対応',
    detail: '楕円形やフレーム外周に装飾がある透過フレームでも扱えるよう対応。',
  },
  {
    date: '2026.03.26',
    title: 'フレーム保存をPNGに変更',
    detail: '配布フレームの保存形式をPNGへ統一。',
  },
  {
    date: '2026.03.25',
    title: '操作ヒントを追加',
    detail: 'ドラッグとピンチ操作のガイドを表示。',
  },
  {
    date: '2026.03.25',
    title: '切り抜きガイドを見やすく調整',
    detail: 'クロップガイドと表示バランスを改善。',
  },
  {
    date: '2026.03.25',
    title: '自動フィット精度を改善',
    detail: '初期配置が切れにくいよう判定と余白を調整。',
  },
  {
    date: '2026.03.25',
    title: 'クロップ微調整UIを改善',
    detail: '位置移動と拡大縮小の細かな調整操作を改善。',
  },
  {
    date: '2026.03.25',
    title: 'クロップ操作UIを調整',
    detail: '切り抜き操作まわりの見た目と触り心地を改善。',
  },
] as const;

const latestUpdateAt = '2026.03.26 23:07';
const OPENING_MASK_OUTPUT_SIZE = 512;

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

const COMMENT_PREVIEW_CROP_STYLE = {
  clipPath: `circle(${(getEditorCropRadiusRatio(100) * 100).toFixed(3)}% at 50% 50%)`,
};

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
  const [manualOpeningTool, setManualOpeningTool] = useState<'paint' | 'erase' | null>(null);
  const [manualOpeningBrushSize, setManualOpeningBrushSize] = useState(24);
  const [hasOpeningMask, setHasOpeningMask] = useState(false);
  const [hasManualOpeningEdits, setHasManualOpeningEdits] = useState(false);
  const [showMaskIntro, setShowMaskIntro] = useState(false);
  const [showGestureHint, setShowGestureHint] = useState(false);
  const [autoFitNotice, setAutoFitNotice] = useState<AutoFitNotice | null>(null);

  const [proOptionsOpen, setProOptionsOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [isUnlimited, setIsUnlimited] = useState(false);
  const [expiresDate, setExpiresDate] = useState(() => formatLocalDateInputValue(addDays(new Date(), 90)));
  const [password, setPassword] = useState('');

  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [preparingUploadConfirmation, setPreparingUploadConfirmation] = useState(false);
  const [uploadConfirmation, setUploadConfirmation] = useState<UploadConfirmationState | null>(null);
  const [proUpgradeOpen, setProUpgradeOpen] = useState(false);
  const [updateHistoryOpen, setUpdateHistoryOpen] = useState(false);
  const [loginOptionsOpen, setLoginOptionsOpen] = useState(false);
  const [microAdjustOpen, setMicroAdjustOpen] = useState(false);
  const [profileAreaHelpOpen, setProfileAreaHelpOpen] = useState(false);
  const [backgroundTransparencyDialog, setBackgroundTransparencyDialog] = useState<BackgroundTransparencyDialogState | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const openingMaskPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const openingMaskWorkingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const isDragging = useRef(false);
  const paintingPointerIdRef = useRef<number | null>(null);
  const lastPaintPointRef = useRef<{ x: number; y: number } | null>(null);
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
  const openingMaskRequestRef = useRef(0);
  const uploadConfirmationRef = useRef<UploadConfirmationState | null>(null);

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
      openingMaskWorkingCanvasRef.current = null;
      if (uploadConfirmationRef.current) {
        URL.revokeObjectURL(uploadConfirmationRef.current.preparedFrameUrl);
        if (uploadConfirmationRef.current.openingMaskUrl) {
          URL.revokeObjectURL(uploadConfirmationRef.current.openingMaskUrl);
        }
        uploadConfirmationRef.current = null;
      }
    };
  }, [frameImage]);

  const ensureOpeningMaskWorkingCanvas = useCallback(() => {
    if (!openingMaskWorkingCanvasRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = OPENING_MASK_OUTPUT_SIZE;
      canvas.height = OPENING_MASK_OUTPUT_SIZE;
      openingMaskWorkingCanvasRef.current = canvas;
    }

    return openingMaskWorkingCanvasRef.current;
  }, []);

  const renderOpeningMaskPreview = useCallback(() => {
    const previewCanvas = openingMaskPreviewCanvasRef.current;
    const editor = editorRef.current;
    const sourceCanvas = openingMaskWorkingCanvasRef.current;

    if (!previewCanvas || !editor) {
      return;
    }

    const ctx = previewCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const width = Math.max(1, Math.round(editor.clientWidth));
    const height = Math.max(1, Math.round(editor.clientHeight));
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    if (previewCanvas.width !== Math.round(width * dpr) || previewCanvas.height !== Math.round(height * dpr)) {
      previewCanvas.width = Math.round(width * dpr);
      previewCanvas.height = Math.round(height * dpr);
      previewCanvas.style.width = `${width}px`;
      previewCanvas.style.height = `${height}px`;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!sourceCanvas || !hasOpeningMask) {
      return;
    }

    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = microAdjustOpen ? 'rgba(255, 91, 91, 0.42)' : 'rgba(255, 91, 91, 0.26)';
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
  }, [hasOpeningMask, microAdjustOpen]);

  const loadOpeningMaskBlobIntoCanvas = useCallback(async (maskBlob: Blob | null) => {
    const workingCanvas = ensureOpeningMaskWorkingCanvas();
    const ctx = workingCanvas.getContext('2d');

    if (!ctx) {
      throw new Error('Canvas 2D context not available');
    }

    ctx.clearRect(0, 0, workingCanvas.width, workingCanvas.height);

    if (!maskBlob) {
      setHasOpeningMask(false);
      renderOpeningMaskPreview();
      return;
    }

    const objectUrl = URL.createObjectURL(maskBlob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image();
        nextImage.addEventListener('load', () => resolve(nextImage));
        nextImage.addEventListener('error', (event) => reject(event));
        nextImage.src = objectUrl;
      });

      ctx.drawImage(image, 0, 0, workingCanvas.width, workingCanvas.height);
      setHasOpeningMask(true);
      renderOpeningMaskPreview();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }, [ensureOpeningMaskWorkingCanvas, renderOpeningMaskPreview]);

  const regenerateOpeningMask = useCallback(async (
    imageUrl: string,
    nextPosition: { x: number; y: number },
    nextZoom: number
  ) => {
    const requestId = openingMaskRequestRef.current + 1;
    openingMaskRequestRef.current = requestId;

    try {
      const previewSize = editorRef.current?.clientWidth ?? OPENING_MASK_OUTPUT_SIZE;
      const maskBlob = await getSquareFrameOpeningMaskBlob(
        imageUrl,
        nextPosition,
        nextZoom,
        OPENING_MASK_OUTPUT_SIZE,
        previewSize
      );

      if (openingMaskRequestRef.current !== requestId) {
        return;
      }

      setHasManualOpeningEdits(false);
      await loadOpeningMaskBlobIntoCanvas(maskBlob);
    } catch (err) {
      console.error('Failed to regenerate opening mask:', err);
      if (openingMaskRequestRef.current === requestId) {
        setHasOpeningMask(false);
        renderOpeningMaskPreview();
      }
    }
  }, [loadOpeningMaskBlobIntoCanvas, renderOpeningMaskPreview]);

  useEffect(() => {
    if (!frameImage) {
      setHasOpeningMask(false);
      openingMaskRequestRef.current += 1;
      renderOpeningMaskPreview();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void regenerateOpeningMask(frameImage, position, zoom);
    }, 120);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [frameImage, position, zoom, regenerateOpeningMask, renderOpeningMaskPreview]);

  useEffect(() => {
    renderOpeningMaskPreview();
  }, [renderOpeningMaskPreview]);

  useEffect(() => {
    const handleResize = () => {
      renderOpeningMaskPreview();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [renderOpeningMaskPreview]);

  const showAutoFitNotice = useCallback((notice: AutoFitNotice | null) => {
    setAutoFitNotice(notice);
  }, []);

  const releaseBackgroundTransparencyDialogUrls = useCallback((
    dialog: BackgroundTransparencyDialogState | null,
    preservedUrl?: string | null
  ) => {
    if (!dialog) {
      return;
    }

    if (dialog.originalUrl !== preservedUrl) {
      URL.revokeObjectURL(dialog.originalUrl);
    }

    if (dialog.suggestedUrl !== preservedUrl) {
      URL.revokeObjectURL(dialog.suggestedUrl);
    }
  }, []);

  const releaseUploadConfirmationAssets = useCallback((confirmation: UploadConfirmationState | null) => {
    if (!confirmation) {
      return;
    }

    URL.revokeObjectURL(confirmation.preparedFrameUrl);
    if (confirmation.openingMaskUrl) {
      URL.revokeObjectURL(confirmation.openingMaskUrl);
    }
  }, []);

  const replaceUploadConfirmation = useCallback((nextConfirmation: UploadConfirmationState | null) => {
    if (uploadConfirmationRef.current) {
      releaseUploadConfirmationAssets(uploadConfirmationRef.current);
    }

    uploadConfirmationRef.current = nextConfirmation;
    setUploadConfirmation(nextConfirmation);
  }, [releaseUploadConfirmationAssets]);

  const applyAcceptedFrame = useCallback((nextFrameImage: string, nextFileName: string) => {
    if (frameImage && frameImage !== nextFrameImage) {
      URL.revokeObjectURL(frameImage);
    }

    replaceUploadConfirmation(null);
    setFrameImage(nextFrameImage);
    setFrameFileName(nextFileName.replace(/\.[^/.]+$/, '') || 'frame');
    setPosition({ x: 0, y: 0 });
    setZoom(1);
    setIsAdjusting(false);
    setHasManualOpeningEdits(false);
    setShowMaskIntro(false);
    showAutoFitNotice(null);
    setError(null);
    setShareUrl(null);
    setCopied(false);
  }, [frameImage, replaceUploadConfirmation, showAutoFitNotice]);

  const handleUseSuggestedFrame = useCallback(() => {
    if (!backgroundTransparencyDialog) {
      return;
    }

    applyAcceptedFrame(backgroundTransparencyDialog.suggestedUrl, backgroundTransparencyDialog.fileName);
    releaseBackgroundTransparencyDialogUrls(backgroundTransparencyDialog, backgroundTransparencyDialog.suggestedUrl);
    setBackgroundTransparencyDialog(null);
  }, [applyAcceptedFrame, backgroundTransparencyDialog, releaseBackgroundTransparencyDialogUrls]);

  const handleUseOriginalFrame = useCallback(() => {
    if (!backgroundTransparencyDialog) {
      return;
    }

    applyAcceptedFrame(backgroundTransparencyDialog.originalUrl, backgroundTransparencyDialog.fileName);
    releaseBackgroundTransparencyDialogUrls(backgroundTransparencyDialog, backgroundTransparencyDialog.originalUrl);
    setBackgroundTransparencyDialog(null);
  }, [applyAcceptedFrame, backgroundTransparencyDialog, releaseBackgroundTransparencyDialogUrls]);

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
      const zoomRelax = 6 / Math.max(previewSize, 1);
      const appliedZoom = Math.max(0.3, Math.min(3, next.zoom - zoomRelax));
      const appliedPosition = next.zoom > 0
        ? {
            x: next.position.x * (appliedZoom / next.zoom),
            y: next.position.y * (appliedZoom / next.zoom),
          }
        : next.position;
      const shouldRejectAutoFit = next.strategy !== 'unsupported-fill'
        ? !(await isTransparentCenterWithinCropMask(imageUrl, previewSize, {
            zoom: appliedZoom,
            position: appliedPosition,
          }))
        : false;
      const resolvedNext = shouldRejectAutoFit
        ? { zoom: 1, position: { x: 0, y: 0 }, strategy: 'unsupported-fill' as const }
        : { ...next, zoom: appliedZoom, position: appliedPosition };

      if (autoFitRequestRef.current !== requestId) {
        return;
      }

      if (resolvedNext.strategy !== 'unsupported-fill') {
        setPosition(resolvedNext.position);
        setZoom(resolvedNext.zoom);
      }
      showAutoFitNotice(
        resolvedNext.strategy === 'fill-mask'
          ? {
              tone: 'success',
              eyebrow: 'Auto Fit',
              label: 'フレーム範囲を判定して自動調整しました',
              detail: 'このままドラッグやピンチで、必要なら微調整してください',
            }
          : resolvedNext.strategy === 'unsupported-fill'
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

  const resetAdjustments = () => {
    dismissGestureHint();
    dismissAutoFitNotice();
    startTransientAdjusting();
    setPosition({ x: 0, y: 0 });
    setZoom(1);
    setHasManualOpeningEdits(false);
    if (frameImage) {
      void regenerateOpeningMask(frameImage, { x: 0, y: 0 }, 1);
    }
  };

  const resetOpeningMaskToAuto = () => {
    if (!frameImage) {
      return;
    }

    setHasManualOpeningEdits(false);
    void regenerateOpeningMask(frameImage, position, zoom);
  };

  const getOpeningMaskPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    const workingCanvas = openingMaskWorkingCanvasRef.current;
    if (!editor || !workingCanvas) {
      return null;
    }

    const rect = editor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      x: ((event.clientX - rect.left) / rect.width) * workingCanvas.width,
      y: ((event.clientY - rect.top) / rect.height) * workingCanvas.height,
    };
  };

  const drawOpeningMaskStroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const workingCanvas = openingMaskWorkingCanvasRef.current;
    if (!workingCanvas || !manualOpeningTool) {
      return;
    }

    const ctx = workingCanvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = manualOpeningBrushSize;

    if (manualOpeningTool === 'paint') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,255,255,1)';
      ctx.fillStyle = 'rgba(255,255,255,1)';
    } else {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.fillStyle = 'rgba(0,0,0,1)';
    }

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(to.x, to.y, manualOpeningBrushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    setHasOpeningMask(true);
    setHasManualOpeningEdits(true);
    renderOpeningMaskPreview();
  };

  const beginOpeningMaskPaint = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = getOpeningMaskPoint(event);
    if (!point) {
      return;
    }

    paintingPointerIdRef.current = event.pointerId;
    lastPaintPointRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawOpeningMaskStroke(point, point);
  };

  const continueOpeningMaskPaint = (event: React.PointerEvent<HTMLDivElement>) => {
    if (paintingPointerIdRef.current !== event.pointerId || !lastPaintPointRef.current) {
      return;
    }

    const point = getOpeningMaskPoint(event);
    if (!point) {
      return;
    }

    drawOpeningMaskStroke(lastPaintPointRef.current, point);
    lastPaintPointRef.current = point;
  };

  const endOpeningMaskPaint = (event: React.PointerEvent<HTMLDivElement>) => {
    if (paintingPointerIdRef.current === event.pointerId) {
      paintingPointerIdRef.current = null;
      lastPaintPointRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const getOpeningMaskBlobForUpload = async (): Promise<Blob | null> => {
    const workingCanvas = openingMaskWorkingCanvasRef.current;
    if (!workingCanvas || !hasOpeningMask) {
      return null;
    }

    return new Promise((resolve, reject) => {
      workingCanvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Opening mask export failed'));
        }
      }, 'image/png');
    });
  };

  const rerunAutoFit = () => {
    if (!frameImage) {
      return;
    }
    dismissGestureHint();
    void runAutoFit(frameImage);
  };

  const nudgePosition = (dx: number, dy: number) => {
    dismissGestureHint();
    dismissAutoFitNotice();
    setPosition((current) => ({
      x: current.x + dx,
      y: current.y + dy,
    }));
  };

  const nudgeZoom = (delta: number) => {
    dismissGestureHint();
    dismissAutoFitNotice();
    startTransientAdjusting();
    setZoom((current) => Math.max(0.3, Math.min(3, Number((current + delta).toFixed(3)))));
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
    if (!isPng) {
      setError('PNGファイルのみアップロードできます。');
      return;
    }

    releaseBackgroundTransparencyDialogUrls(backgroundTransparencyDialog);
    setBackgroundTransparencyDialog(null);

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

    try {
      const suggestion = await getFrameBackgroundTransparencySuggestion(nextFrameImage);
      if (suggestion) {
        const suggestedUrl = URL.createObjectURL(suggestion.blob);
        setBackgroundTransparencyDialog({
          fileName: file.name,
          originalUrl: nextFrameImage,
          suggestedUrl,
          suggestedCoverageRatio: suggestion.fillCoverageRatio,
          suggestedColorCss: `rgba(${suggestion.fillColor.r}, ${suggestion.fillColor.g}, ${suggestion.fillColor.b}, ${Math.max(0.2, suggestion.fillColor.a / 255)})`,
        });
        setError(null);
        setShareUrl(null);
        setCopied(false);
        return;
      }
    } catch (err) {
      console.error('Failed to prepare background transparency suggestion:', err);
    }

    applyAcceptedFrame(nextFrameImage, file.name);
  }, [applyAcceptedFrame, backgroundTransparencyDialog, releaseBackgroundTransparencyDialogUrls]);

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
    if (microAdjustOpen && manualOpeningTool) {
      beginOpeningMaskPaint(e);
      return;
    }

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
    if (microAdjustOpen && manualOpeningTool) {
      continueOpeningMaskPaint(e);
      return;
    }

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
    if (microAdjustOpen && manualOpeningTool) {
      endOpeningMaskPaint(e);
      return;
    }

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
    if (microAdjustOpen) {
      return;
    }

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
    releaseBackgroundTransparencyDialogUrls(backgroundTransparencyDialog);
    replaceUploadConfirmation(null);
    setFrameImage(null);
    setBackgroundTransparencyDialog(null);
    setPosition({ x: 0, y: 0 });
    setZoom(1);
    setIsAdjusting(false);
    setHasManualOpeningEdits(false);
    setHasOpeningMask(false);
    setShowMaskIntro(false);
    setShowGestureHint(false);
    showAutoFitNotice(null);

    setProOptionsOpen(false);
    setCustomName('');
    setIsUnlimited(false);
    setExpiresDate(formatLocalDateInputValue(addDays(new Date(), 90)));
    setPassword('');
  };

  const uploadPreparedFrame = async (
    preparedBlob: Blob,
    openingMaskBlob: Blob | null,
    recaptchaToken?: string | null
  ): Promise<boolean> => {
    const MAX_SIZE = 5 * 1024 * 1024;
    if (preparedBlob.size > MAX_SIZE) {
      setError('編集後の画像サイズが5MBを超えています。縮小して再度お試しください。');
      return false;
    }

    const uploadFile = new File([preparedBlob], `${frameFileName}.png`, { type: 'image/png' });
    const previewObjectUrl = URL.createObjectURL(preparedBlob);
    let sharePreviewBlob: Blob | null = null;
    try {
      sharePreviewBlob = await getSharePreviewBlob(previewObjectUrl);
    } finally {
      URL.revokeObjectURL(previewObjectUrl);
    }

    const formData = new FormData();
    formData.append('file', uploadFile);
    if (sharePreviewBlob) {
      formData.append('sharePreview', new File([sharePreviewBlob], `${frameFileName}-share-preview.png`, { type: 'image/png' }));
    }
    if (openingMaskBlob) {
      formData.append('openingMask', new File([openingMaskBlob], `${frameFileName}-opening-mask.png`, { type: 'image/png' }));
    }

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

  const prepareUploadConfirmation = async () => {
    if (!frameImage) return;

    setPreparingUploadConfirmation(true);
    setError(null);

    try {
      const previewSize = editorRef.current?.clientWidth ?? 1024;
      const { blob: squareBlob } = await getSquareFrameBlob(
        frameImage,
        position,
        zoom,
        1024,
        previewSize
      );
      const openingMaskBlob = await getOpeningMaskBlobForUpload();

      const preparedFrameUrl = URL.createObjectURL(squareBlob);
      const openingMaskUrl = openingMaskBlob ? URL.createObjectURL(openingMaskBlob) : null;
      try {
        const avatarPreviewUrl = await getTikTokLiveCommentAvatarPreviewDataUrl(
          preparedFrameUrl,
          openingMaskUrl,
          240
        );

        replaceUploadConfirmation({
          preparedBlob: squareBlob,
          openingMaskBlob,
          preparedFrameUrl,
          openingMaskUrl,
          avatarPreviewUrl,
        });
      } catch (previewError) {
        URL.revokeObjectURL(preparedFrameUrl);
        if (openingMaskUrl) {
          URL.revokeObjectURL(openingMaskUrl);
        }
        throw previewError;
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || '画像のアップロードに失敗しました。もう一度お試しください。');
    } finally {
      setPreparingUploadConfirmation(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadConfirmation) return;

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
      recaptchaToken = null;
    }

    setUploading(true);
    setError(null);
    setShareUrl(null);
    setCopied(false);

    try {
      await uploadPreparedFrame(uploadConfirmation.preparedBlob, uploadConfirmation.openingMaskBlob, recaptchaToken);
      replaceUploadConfirmation(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message || '画像のアップロードに失敗しました。もう一度お試しください。');
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
          ライバー・モデ用アップロード画面
      </div>

      <h1 className="text-4xl font-black mb-4 text-center tracking-tight glitch-text" data-text="TikRing">
        <a
          href="/"
          aria-label="トップへ戻る"
          className="inline-block rounded-sm hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-tiktok-cyan/50"
        >
          <span className="text-white">TikRing</span>
        </a>
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
        <div className="w-full space-y-4">
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

          {user !== undefined && user?.plan !== 'pro' ? (
            <div className="w-full rounded-md border border-tiktok-gray bg-tiktok-dark overflow-hidden">
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

          <section className="w-full rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.94),rgba(10,10,12,0.98))] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.28)] sm:p-5">
            <button
              type="button"
              onClick={() => setUpdateHistoryOpen((open) => !open)}
              className={`flex w-full items-center justify-between gap-3 text-left transition-colors ${updateHistoryOpen ? 'border-b border-white/8 pb-3' : ''}`}
            >
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-tiktok-cyan/80">Updates</p>
                <h2 className="mt-1 text-sm font-bold text-white sm:text-base">アップデート履歴</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-tiktok-cyan/25 bg-tiktok-cyan/10 px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-tiktok-cyan/80">
                  {latestUpdateAt}
                </span>
                <ChevronDown className={`h-5 w-5 text-tiktok-lightgray transition-transform ${updateHistoryOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>

            {updateHistoryOpen ? (
              <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-2.5">
                <ul className="space-y-2">
                  {updateHistory.map((item) => (
                    <li key={`${item.date}-${item.title}`} className="text-xs leading-5 text-tiktok-lightgray sm:text-[13px]">
                      <span className="mr-2 inline-block font-bold tracking-[0.16em] text-white/45">{item.date}</span>
                      <span className="font-semibold text-white">{item.title}</span>
                      <span className="mx-1.5 text-white/28">/</span>
                      <span>{item.detail}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      ) : !shareUrl && frameImage ? (
        <div className="w-full flex flex-col items-center gap-6">
          <div className="text-center space-y-2">
            <h2 className="text-xl font-bold">フレーム位置を調整</h2>
            <div className="inline-flex flex-col items-start gap-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left">
              <div className="flex items-center gap-2 text-[11px] text-tiktok-lightgray">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-tiktok-cyan/80" />
                <span>水色の領域は TikTok で表示されない範囲です</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-tiktok-lightgray">
                <span className="inline-block h-2.5 w-4 rounded-full bg-[#ff5b5b]/65" />
                <span>半透明の赤塗りがプロフ画像の表示領域です</span>
                <button
                  type="button"
                  onClick={() => setProfileAreaHelpOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={profileAreaHelpOpen}
                  aria-controls="profile-area-help-dialog"
                  className="inline-flex items-center gap-1 rounded-full border border-[#ff5b5b]/30 bg-[#ff5b5b]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ffb1b1] transition hover:border-[#ff5b5b]/45 hover:bg-[#ff5b5b]/16 hover:text-[#ffd0d0]"
                >
                  <CircleHelp className="h-3 w-3" />
                  <span>ヘルプ</span>
                </button>
              </div>
            </div>
          </div>

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
              <canvas
                ref={openingMaskPreviewCanvasRef}
                className={`pointer-events-none absolute inset-0 z-30 h-full w-full ${microAdjustOpen ? 'opacity-100' : 'opacity-95'}`}
                aria-label="Profile opening overlay"
              />
            </div>
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
            <div className="absolute inset-0 z-20 pointer-events-none flex items-center justify-center">
              <CropMaskOverlay intro={showMaskIntro} active={!showMaskIntro && isAdjusting} />
            </div>
            {!hasOpeningMask ? (
              <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center px-3 sm:top-4 sm:px-4">
                <div className="w-full max-w-[22rem] rounded-2xl border border-amber-300/35 bg-[#2A1904]/88 px-4 py-3 text-left shadow-[0_18px_50px_rgba(0,0,0,0.42)]">
                  <p className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-200">Opening Guide</p>
                  <p className="mt-1 text-sm font-bold text-white">表示可能領域の塗りを生成できませんでした</p>
                  <p className="mt-1 text-xs font-medium text-amber-50/90">この画像では自動判定の塗り領域が取れていない可能性があります。</p>
                </div>
              </div>
            ) : null}
            <div
              className={`editor-gesture-hint absolute inset-x-0 bottom-3 z-30 pointer-events-none flex justify-center px-3 sm:bottom-4 sm:px-4${showGestureHint && !microAdjustOpen ? ' editor-gesture-hint-visible' : ''}`}
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

            <div className="w-full rounded-xl border border-tiktok-cyan/30 bg-tiktok-cyan/12 overflow-hidden shadow-[0_10px_28px_rgba(37,244,238,0.10)]">
              <button
                type="button"
                onClick={() => setMicroAdjustOpen((open) => !open)}
                className="w-full px-3 py-2.5 flex items-center justify-between text-left hover:bg-tiktok-cyan/10 transition-colors"
              >
                <div className="min-w-0 flex items-center gap-2 pr-3">
                  <p className="shrink-0 text-sm font-bold text-white">微調整</p>
                  <p className="truncate text-[11px] text-tiktok-cyan/75">1px移動と細かい拡大縮小</p>
                </div>
                <ChevronDown className={`w-5 h-5 text-tiktok-cyan transition-transform ${microAdjustOpen ? 'rotate-180' : ''}`} />
              </button>

              {microAdjustOpen ? (
                <div className="px-3 pb-3 pt-2 space-y-3 border-t border-tiktok-cyan/20 bg-black/15">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-bold tracking-[0.12em] text-tiktok-cyan/75">1px移動</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={rerunAutoFit}
                        className="px-2.5 py-1.5 rounded-md border border-tiktok-cyan/35 bg-tiktok-cyan/10 text-[11px] font-bold text-tiktok-cyan hover:bg-tiktok-cyan/18 transition-colors"
                      >
                        自動フィット
                      </button>
                      <button
                        type="button"
                        onClick={resetAdjustments}
                        className="px-2.5 py-1.5 rounded-md border border-tiktok-cyan/35 bg-tiktok-cyan/10 text-[11px] font-bold text-tiktok-cyan hover:bg-tiktok-cyan/18 transition-colors"
                      >
                        リセット
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 max-w-[11rem] mx-auto">
                    <div />
                    <button
                      type="button"
                      onClick={() => nudgePosition(0, -1)}
                      className="py-1.5 rounded-md border border-tiktok-cyan/35 bg-black/25 text-sm font-black text-white hover:bg-tiktok-cyan/12 transition-colors"
                    >
                      ↑
                    </button>
                    <div />
                    <button
                      type="button"
                      onClick={() => nudgePosition(-1, 0)}
                      className="py-1.5 rounded-md border border-tiktok-cyan/35 bg-black/25 text-sm font-black text-white hover:bg-tiktok-cyan/12 transition-colors"
                    >
                      ←
                    </button>
                    <div className="flex items-center justify-center text-[10px] font-bold tracking-[0.08em] text-tiktok-lightgray">1px</div>
                    <button
                      type="button"
                      onClick={() => nudgePosition(1, 0)}
                      className="py-1.5 rounded-md border border-tiktok-cyan/35 bg-black/25 text-sm font-black text-white hover:bg-tiktok-cyan/12 transition-colors"
                    >
                      →
                    </button>
                    <div />
                    <button
                      type="button"
                      onClick={() => nudgePosition(0, 1)}
                      className="py-1.5 rounded-md border border-tiktok-cyan/35 bg-black/25 text-sm font-black text-white hover:bg-tiktok-cyan/12 transition-colors"
                    >
                      ↓
                    </button>
                    <div />
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[11px] font-bold tracking-[0.12em] text-tiktok-cyan/75">拡大縮小</p>
                    <div className="w-full flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => nudgeZoom(-0.001)}
                        className="h-8 w-8 shrink-0 rounded-md border border-tiktok-cyan/35 bg-black/25 text-base font-black text-white hover:bg-tiktok-cyan/12 transition-colors"
                        aria-label="zoom out one step"
                      >
                        -
                      </button>
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
                      <button
                        type="button"
                        onClick={() => nudgeZoom(0.001)}
                        className="h-8 w-8 shrink-0 rounded-md border border-tiktok-cyan/35 bg-black/25 text-base font-black text-white hover:bg-tiktok-cyan/12 transition-colors"
                        aria-label="zoom in one step"
                      >
                        +
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-medium text-tiktok-lightgray">
                      <span>縮小</span>
                      <span>{zoom.toFixed(3)}x</span>
                      <span>拡大</span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[#ff5b5b]/25 bg-[#2a0c0c]/55 p-3 text-left">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white">プロフ画像表示可能領域</p>
                        <p className="mt-0.5 text-[10px] leading-4 text-white/70 sm:text-[11px]">
                          半透明の赤塗りをそのまま塗って、表示領域を調整できます。
                        </p>
                      </div>
                      {microAdjustOpen ? (
                        <span className="shrink-0 rounded-full border border-[#ff5b5b]/35 bg-[#ff5b5b]/14 px-2.5 py-1 text-[10px] font-black tracking-[0.14em] text-[#ff9d9d]">
                          ON
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={resetOpeningMaskToAuto}
                        className="px-3 py-2 rounded-md border border-white/12 bg-black/25 text-[11px] font-bold text-white/80 hover:bg-white/8 transition-colors"
                      >
                        手動修正を破棄して自動判定に戻す
                      </button>
                    </div>
                    {microAdjustOpen ? (
                      <div className="mt-3 space-y-3 rounded-md border border-[#ff5b5b]/20 bg-black/20 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setManualOpeningTool((current) => (current === 'paint' ? null : 'paint'))}
                            className={`px-3 py-1.5 rounded-md border text-[11px] font-bold transition-colors ${manualOpeningTool === 'paint' ? 'border-[#ff5b5b]/45 bg-[#ff5b5b]/16 text-[#ffb3b3]' : 'border-white/12 bg-black/20 text-white/80 hover:bg-white/8'}`}
                          >
                            塗る
                          </button>
                          <button
                            type="button"
                            onClick={() => setManualOpeningTool((current) => (current === 'erase' ? null : 'erase'))}
                            className={`px-3 py-1.5 rounded-md border text-[11px] font-bold transition-colors ${manualOpeningTool === 'erase' ? 'border-[#ff5b5b]/45 bg-[#ff5b5b]/16 text-[#ffb3b3]' : 'border-white/12 bg-black/20 text-white/80 hover:bg-white/8'}`}
                          >
                            削る
                          </button>
                          {manualOpeningTool ? (
                            <span className="rounded-full border border-[#ff5b5b]/35 bg-[#ff5b5b]/10 px-2 py-1 text-[10px] font-black tracking-[0.12em] text-[#ff9d9d]">
                              {manualOpeningTool === 'paint' ? '塗りモード' : '削りモード'}
                            </span>
                          ) : (
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-black tracking-[0.12em] text-white/55">
                              ドラッグ/ピンチ
                            </span>
                          )}
                          {hasManualOpeningEdits ? (
                            <span className="rounded-full border border-[#ff5b5b]/35 bg-[#ff5b5b]/10 px-2 py-1 text-[10px] font-black tracking-[0.12em] text-[#ff9d9d]">
                              編集あり
                            </span>
                          ) : (
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-black tracking-[0.12em] text-white/45">
                              自動判定
                            </span>
                          )}
                        </div>

                        {manualOpeningTool ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-3 text-[11px] font-bold text-white/75">
                              <span>ブラシサイズ</span>
                              <span>{manualOpeningBrushSize}px</span>
                            </div>
                            <input
                              type="range"
                              min={8}
                              max={80}
                              step={1}
                              value={manualOpeningBrushSize}
                              onChange={(e) => setManualOpeningBrushSize(Number(e.target.value))}
                              className="w-full h-1.5 bg-tiktok-gray rounded-full appearance-none cursor-pointer accent-[#ff8a8a]"
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {profileAreaHelpOpen ? (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-[1px]"
                onClick={() => setProfileAreaHelpOpen(false)}
              >
                <div
                  id="profile-area-help-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="profile-area-help-title"
                  className="w-full max-w-sm rounded-2xl border border-[#ff5b5b]/20 bg-[linear-gradient(180deg,rgba(30,12,14,0.98),rgba(18,10,12,0.98))] p-5 text-left shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.24em] text-[#ff8e8e]/85">Help</p>
                      <h3 id="profile-area-help-title" className="mt-1 text-base font-bold text-white">
                        表示領域について
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setProfileAreaHelpOpen(false)}
                      className="shrink-0 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/10"
                    >
                      閉じる
                    </button>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-[#ffd6d6]">
                    半透明の赤塗り部分で示された透過部分にのみ、ユーザーのプロフィール画像が表示されます。フレームの外側など赤塗りされていない透過部分にはプロフィール画像は表示されないため、フレーム外にはみ出さず、透過部分を保ったまま調整できます。
                  </p>
                </div>
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
              onClick={prepareUploadConfirmation}
              disabled={uploading || preparingUploadConfirmation}
              className="flex-1 py-3.5 px-4 rounded-md bg-tiktok-red hover:bg-[#D92648] text-white font-bold transition-colors shadow-lg flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading || preparingUploadConfirmation ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {uploading ? 'アップロード中...' : '確認プレビューを準備中...'}
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

      {backgroundTransparencyDialog ? (
        <div
          className="fixed inset-0 z-[60] overflow-y-auto bg-black/75 px-3 py-3 backdrop-blur-[1px] sm:flex sm:items-center sm:justify-center sm:px-4 sm:py-6"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="background-transparency-dialog-title"
            className="mx-auto w-full max-w-4xl overflow-hidden rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.98),rgba(10,10,12,0.98))] p-4 text-left shadow-[0_30px_100px_rgba(0,0,0,0.55)] sm:rounded-[1.75rem] sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-tiktok-cyan/80">Suggestion</p>
                <h3 id="background-transparency-dialog-title" className="mt-1 text-base font-bold leading-6 text-white sm:text-xl">
                  背景透過の候補を見つけました
                </h3>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:mt-5 sm:gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.18)] sm:p-4">
                <div className="flex items-center justify-between gap-3 px-1 pb-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/45">Original</p>
                    <p className="mt-1 text-sm font-bold text-white">そのまま使う</p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[10px] font-black tracking-[0.14em] text-white/55">
                    現在の画像
                  </span>
                </div>
                <div className="relative aspect-square overflow-hidden rounded-[1.25rem] border border-white/8 bg-[#f8fafc] bg-[linear-gradient(45deg,#d1d5db_25%,transparent_25%),linear-gradient(-45deg,#d1d5db_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#d1d5db_75%),linear-gradient(-45deg,transparent_75%,#d1d5db_75%)] bg-[length:26px_26px] bg-[position:0_0,0_13px,13px_-13px,-13px_0px]">
                  <img
                    src={backgroundTransparencyDialog.originalUrl}
                    alt="Original frame preview"
                    className="absolute inset-0 h-full w-full object-contain"
                    draggable={false}
                  />
                </div>
                <p className="mt-3 px-1 text-[12px] leading-5 text-white/58 sm:text-xs">
                  フレーム外側の装飾をプロフィール画像内に入れない場合はこちら
                </p>
                <button
                  type="button"
                  onClick={handleUseOriginalFrame}
                  className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-white/10"
                >
                  このまま編集へ進む
                </button>
              </div>

              <div className="rounded-2xl border border-tiktok-cyan/25 bg-tiktok-cyan/[0.06] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.18)] sm:p-4">
                <div className="flex items-center justify-between gap-3 px-1 pb-3">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-tiktok-cyan/75">Transparent Background</p>
                    <p className="mt-1 text-sm font-bold text-white">背景色を透過して使う</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <div className="flex items-center gap-2 rounded-full border border-tiktok-cyan/25 bg-black/25 px-2.5 py-1 text-[10px] font-black tracking-[0.12em] text-tiktok-cyan">
                      <span className="inline-block h-2.5 w-2.5 rounded-full border border-white/20" style={{ backgroundColor: backgroundTransparencyDialog.suggestedColorCss }} />
                      背景候補色
                    </div>
                  </div>
                </div>
                <div className="relative aspect-square overflow-hidden rounded-[1.25rem] border border-tiktok-cyan/18 bg-[#f8fafc] bg-[linear-gradient(45deg,#d1d5db_25%,transparent_25%),linear-gradient(-45deg,#d1d5db_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#d1d5db_75%),linear-gradient(-45deg,transparent_75%,#d1d5db_75%)] bg-[length:26px_26px] bg-[position:0_0,0_13px,13px_-13px,-13px_0px]">
                  <img
                    src={backgroundTransparencyDialog.suggestedUrl}
                    alt="Background transparent frame preview"
                    className="absolute inset-0 h-full w-full object-contain"
                    draggable={false}
                  />
                </div>
                <p className="mt-3 px-1 text-[12px] leading-5 text-white/70 sm:text-xs">
                  フレーム外側に装飾がある場合はこちら
                </p>
                <button
                  type="button"
                  onClick={handleUseSuggestedFrame}
                  className="mt-3 w-full rounded-xl border border-tiktok-cyan/35 bg-tiktok-cyan/14 px-4 py-3.5 text-sm font-bold text-tiktok-cyan transition hover:bg-tiktok-cyan/20"
                >
                  この背景透過版で進む
                </button>
              </div>
            </div>

            <p className="mt-4 text-[12px] leading-5 text-white/62 sm:text-xs">
              どちらを選んでも、このあと位置調整と表示領域の微調整ができます。
            </p>
          </div>
        </div>
      ) : null}

      {uploadConfirmation ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-[2px]"
          onClick={() => {
            if (!uploading) {
              replaceUploadConfirmation(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-confirmation-dialog-title"
            className="max-h-[calc(100vh-2rem)] w-full max-w-3xl overflow-y-auto rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(24,24,27,0.98),rgba(10,10,12,0.98))] p-4 text-left shadow-[0_30px_100px_rgba(0,0,0,0.55)] sm:max-h-[calc(100vh-3rem)] sm:rounded-[1.75rem] sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-tiktok-cyan/80">Final Check</p>
                <h3 id="upload-confirmation-dialog-title" className="mt-1 text-lg font-bold text-white sm:text-xl">
                  コメント欄での見え方を確認してください
                </h3>
                <div className="mt-2 space-y-2 max-w-2xl text-sm leading-6 text-tiktok-lightgray">
                  <p className="text-[13px] leading-5 text-white/68 sm:text-sm sm:leading-6">
                    フレーム外側の透過をプロフィール円内に入れた場合は、このプレビューで透過の見え方が意図通りか確認してからアップロードしてください。
                  </p>
                </div>
              </div>
              <span className="shrink-0 self-start rounded-full border border-[#ff5b5b]/25 bg-[#ff5b5b]/10 px-3 py-1.5 text-[11px] font-black tracking-[0.14em] text-[#ffb1b1]">
                最終確認
              </span>
            </div>

            <div className="mt-5 overflow-hidden rounded-[1.1rem] border border-white/10 bg-[#101217] shadow-[0_18px_40px_rgba(0,0,0,0.22)] sm:rounded-[1.4rem]">
              <div className="relative px-3 py-3 sm:px-4 sm:py-4">
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: 'url(/0cd3e57f42bea2993917af7b221b3330.jpg)' }}
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(0,0,0,0.08)_40%,rgba(0,0,0,0.24)_100%)]" />

                <div className="relative flex items-start gap-2.5 sm:gap-3">
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md sm:h-14 sm:w-14">
                    <div className="absolute inset-0" style={COMMENT_PREVIEW_CROP_STYLE}>
                      <img
                        src={uploadConfirmation.avatarPreviewUrl}
                        alt="TikTok LIVE comment avatar preview"
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13px] font-black text-white sm:text-sm">@sample_listener</span>
                      <span className="text-[10px] font-black tracking-[0.1em] text-tiktok-cyan">コメント</span>
                    </div>
                    <p className="mt-1 text-[13px] leading-5 text-white/86 sm:text-sm sm:leading-6">
                      こんな感じでプロフィール画像にフレームが乗って見えます
                    </p>
                    <p className="mt-2 text-[10px] tracking-[0.08em] text-white/38 sm:text-[11px]">
                      プレビューの人物画像と文言はサンプルです
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-3 border-t border-white/8 pt-4 sm:flex-row sm:justify-end sm:pt-5">
              <button
                type="button"
                onClick={() => replaceUploadConfirmation(null)}
                disabled={uploading}
                className="rounded-md border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                調整に戻る
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-tiktok-red px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-[#D92648] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    アップロード中...
                  </>
                ) : (
                  <>
                    <UploadCloud className="h-4 w-4" />
                    この内容でアップロード
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {user !== undefined && user?.plan !== 'pro' && (!!shareUrl || !!frameImage) ? (
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
