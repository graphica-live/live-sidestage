import { useState, useEffect } from 'react';
import { Copy, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function BrowserWarning() {
    const [copied, setCopied] = useState(false);
    const [currentUrl, setCurrentUrl] = useState('');

    useEffect(() => {
        setCurrentUrl(window.location.href);
    }, []);

    const handleCopyUrl = async () => {
        try {
            await navigator.clipboard.writeText(currentUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy textual URL', err);
        }
    };

    return (
        <div className="min-h-screen w-full bg-black text-white flex items-center justify-center px-4">
            <div className="w-full max-w-2xl bg-tiktok-dark/90 backdrop-blur-md border border-tiktok-gray rounded-xl p-5 sm:p-6 animate-in fade-in duration-500">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-tiktok-red shrink-0">
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-medium text-white mb-2 leading-snug pr-6">
                            TikTokアプリ内ブラウザでは<span className="text-tiktok-red font-bold">画像の保存・アップロードができません</span>。<br />
                            必ず <strong className="text-tiktok-cyan break-keep">Safari</strong> または <strong className="text-tiktok-cyan break-keep">Chrome</strong> で開き直してください。
                        </p>
                        <p className="text-xs text-tiktok-lightgray mb-3">
                            この画面では機能を利用できないように制限しています。
                        </p>

                        <div className="flex flex-col sm:flex-row gap-2">
                            <button
                                onClick={handleCopyUrl}
                                className={`flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 border ${copied
                                    ? 'bg-green-500/20 text-green-400 border-green-500/50'
                                    : 'bg-black/50 text-white border-tiktok-gray hover:bg-tiktok-gray/50'
                                    }`}
                            >
                                {copied ? (
                                    <>
                                        <CheckCircle2 className="w-4 h-4" />
                                        コピー完了
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-4 h-4" />
                                        URLをコピー
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
