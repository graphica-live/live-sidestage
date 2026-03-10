import { useState, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Cropper, { type Area } from 'react-easy-crop';
import { useDropzone } from 'react-dropzone';
import { Download, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react';
import { getCroppedAndMergedImg } from '../utils/canvas';

export default function FrameEditor() {
  const { id } = useParams<{ id: string }>();
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [userImage, setUserImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

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

  const onCropComplete = useCallback((_croppedArea: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

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

  const handleDownload = async () => {
    if (!userImage || !frameUrl || !croppedAreaPixels) return;

    try {
      setDownloading(true);
      const outputImage = await getCroppedAndMergedImg(userImage, croppedAreaPixels, frameUrl);

      // ダウンロード処理
      const link = document.createElement('a');
      link.download = 'profile-with-frame.png';
      link.href = outputImage;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
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
    setCrop({ x: 0, y: 0 });
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
      <h1 className="text-2xl font-bold mb-2 text-center">プロフィール画像の作成</h1>
      <p className="text-tiktok-lightgray flex flex-col items-center text-center gap-1 mb-8 text-sm">
        好きな背景画像を重ねて、自分だけのアイコンを作りましょう！
      </p>

      {!userImage ? (
        <div className="w-full flex flex-col items-center gap-6">
          {/* 追加: 装着されるフレームのプレビュー */}
          {frameUrl && (
            <div className="w-48 h-48 sm:w-64 sm:h-64 rounded-3xl bg-tiktok-dark border border-tiktok-gray overflow-hidden relative shadow-lg">
              <div className="absolute inset-0 bg-tiktok-gray/30 flex items-center justify-center">
                <ImageIcon className="w-12 h-12 text-tiktok-lightgray/50" />
              </div>
              <div
                className="absolute inset-0 bg-contain bg-center bg-no-repeat w-full h-full"
                style={{ backgroundImage: `url(${frameUrl})` }}
              />
            </div>
          )}

          {/* 画像アップロードUI */}
          <div
            {...getRootProps()}
            className={`w-full p-8 rounded-3xl border-2 border-dashed flex flex-col items-center justify-center transition-all cursor-pointer relative group
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
          <div className="relative w-full aspect-square rounded-3xl overflow-hidden bg-tiktok-dark border border-tiktok-gray shadow-2xl">
            {/* Cropper Container (Background) */}
            <div className="absolute inset-0 z-0">
              <Cropper
                image={userImage}
                crop={crop}
                zoom={zoom}
                minZoom={0.3} // 最低倍率を0.3まで下げて、縮小（枠より小さく）できるようにする
                aspect={1} // 正方形
                onCropChange={setCrop}
                onCropComplete={onCropComplete}
                onZoomChange={setZoom}
                showGrid={false}
                objectFit="contain" // 余白（透明）を許容する
                classes={{
                  containerClassName: 'bg-tiktok-dark',
                  mediaClassName: '',
                  cropAreaClassName: 'border-0 border-white/20' // react-easy-cropのデフォルトボーダーを薄く
                }}
              />
            </div>

            {/* Foreground Frame Overlay (フレームの透過部分から後ろが見える) */}
            {/* pointer-events-none を付与することで、フレーム越しにCropperのドラッグ操作が可能になる */}
            <div
              className="absolute inset-0 z-10 pointer-events-none bg-contain bg-center bg-no-repeat w-full h-full"
              style={{ backgroundImage: `url(${frameUrl})` }}
            />
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
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full h-2 bg-tiktok-gray rounded-lg appearance-none cursor-pointer accent-tiktok-cyan"
            />
            <span className="text-xs text-tiktok-lightgray shrink-0">拡大</span>
          </div>

          <div className="flex w-full gap-4 mt-2">
            <button
              onClick={resetImage}
              className="flex-1 py-3 px-4 rounded-xl bg-tiktok-gray hover:bg-tiktok-lightgray/40 font-bold transition-colors text-sm"
            >
              画像を選び直す
            </button>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex-1 py-3 px-4 rounded-xl bg-tiktok-red hover:bg-tiktok-red/80 text-white font-bold transition-colors shadow-lg flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  合成中...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  保存する
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
