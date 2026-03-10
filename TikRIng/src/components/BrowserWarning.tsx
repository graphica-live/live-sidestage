import { useState, useEffect } from 'react';
import { ExternalLink, Copy, CheckCircle2, AlertTriangle, X } from 'lucide-react';

export default function BrowserWarning() {
    const [copied, setCopied] = useState(false);
    const [currentUrl, setCurrentUrl] = useState('');
    const [isVisible, setIsVisible] = useState(true);

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

    const handleOpenLineExternal = () => {
        const url = new URL(currentUrl);
        url.searchParams.set('openExternalBrowser', '1');
        window.location.href = url.toString();
    };

    if (!isVisible) return null;

    return (
        <div className="w-full bg-tiktok-dark/80 backdrop-blur-md border-b border-tiktok-gray sticky top-0 z-50 animate-in slide-in-from-top-4 duration-500">
            <div className="container mx-auto px-4 py-3 pb-4 max-w-2xl relative">
                <button
                    onClick={() => setIsVisible(false)}
                    className="absolute top-2 right-2 p-1 text-tiktok-lightgray hover:text-white rounded-full transition-colors"
                    aria-label="閉じる"
                >
                    <X className="w-4 h-4" />
                </button>

                <div className="flex items-start gap-3 mt-1">
                    <div className="mt-0.5 text-tiktok-red shrink-0">
                        <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-medium text-white mb-2 leading-snug pr-6">
                            画像の保存に失敗する場合は、<strong className="text-tiktok-cyan break-keep">Safari</strong> または <strong className="text-tiktok-cyan break-keep">Chrome</strong> で開き直してください。
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

                            <button
                                onClick={handleOpenLineExternal}
                                className="flex-[1.5] py-2 px-3 bg-[#06C755] hover:bg-[#05b34c] text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5"
                            >
                                <ExternalLink className="w-4 h-4" />
                                LINEからSafari等で開く
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
