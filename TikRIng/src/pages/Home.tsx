import { useState, useCallback } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { UploadCloud, Link as LinkIcon, Check, Loader2 } from 'lucide-react';

export default function Home() {
  const [uploading, setUploading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    setShareUrl(null);
    setCopied(false);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();

      // 生成されたIDを使って、アプリ内のリスナー用共有URLを作成する
      // HashRouterを使用しているため /#/f/{id} の形にする
      const url = `${window.location.origin}${window.location.pathname}#/f/${data.id}`;
      setShareUrl(url);
    } catch (err) {
      console.error(err);
      setError('画像のアップロードに失敗しました。もう一度お試しください。');
    } finally {
      setUploading(false);
    }
  }, []);

  const onDropRejected = useCallback((fileRejections: FileRejection[]) => {
    const rejection = fileRejections[0];
    if (rejection.errors[0]?.code === 'file-too-large') {
      setError('ファイルサイズが大きすぎます。5MB以下の画像を選択してください。');
    } else {
      setError('無効なファイルです。PNG等の画像を選択してください。');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp']
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
      </p>

      {/* ドロップゾーン */}
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
                またはクリックしてファイルを選択<br />
                <span className="text-xs opacity-70 mt-2 block">(PNG形式推奨: 中央が透過されていること)</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="mt-6 w-full p-4 rounded-xl bg-tiktok-red/20 border border-tiktok-red/30 text-tiktok-red text-sm text-center">
          {error}
        </div>
      )}

      {/* 共有URL表示 */}
      {shareUrl && (
        <div className="mt-8 w-full animate-in slide-in-from-bottom-4 fade-in duration-500">
          <h3 className="text-sm font-bold text-tiktok-lightgray mb-2 ml-1">リスナーに共有するURL</h3>
          <div className="flex items-center gap-2 p-1.5 pl-4 bg-tiktok-dark rounded-md border border-tiktok-gray focus-within:border-tiktok-cyan transition-colors">
            <LinkIcon className="w-5 h-5 text-tiktok-lightgray shrink-0" />
            <input
              type="text"
              readOnly
              value={shareUrl}
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
          <p className="text-xs text-tiktok-lightgray mt-3 text-center">
            このURLをSNS等でリスナーに共有してください。
          </p>
        </div>
      )}
    </div>
  );
}
