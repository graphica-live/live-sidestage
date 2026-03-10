import { useEffect, useState } from 'react';
import { ExternalLink, Copy, CheckCircle2 } from 'lucide-react';

type BrowserType = 'line' | 'tiktok' | 'instagram' | 'twitter' | 'facebook' | 'other_inapp' | 'none';

export default function InAppBrowserPrompt() {
    const [browserType, setBrowserType] = useState<BrowserType>('none');
    const [copied, setCopied] = useState(false);
    const [currentUrl, setCurrentUrl] = useState('');
    const [debugUa, setDebugUa] = useState('');

    useEffect(() => {
        setCurrentUrl(window.location.href);

        const ua = navigator.userAgent || navigator.vendor || (window as any).opera;
        const uaLower = ua.toLowerCase();

        setDebugUa(uaLower);

        // Check for specific in-app browsers
        if (uaLower.includes('line')) {
            setBrowserType('line');
        } else if (uaLower.includes('tiktok') || uaLower.includes('bytedance')) {
            setBrowserType('tiktok');
        } else if (uaLower.includes('instagram')) {
            setBrowserType('instagram');
        } else if (uaLower.includes('twitter') || uaLower.includes('t-vfs')) {
            setBrowserType('twitter');
        } else if (uaLower.includes('fban') || uaLower.includes('fbav')) {
            setBrowserType('facebook');
        } else if (
            // Generic check for common WebViews (often missing standard browser features)
            (uaLower.includes('wv') && uaLower.includes('android')) ||
            (uaLower.includes('iphone') && !uaLower.includes('safari'))
        ) {
            // NOTE: Be careful with generic checks, but usually if it's an iPhone without 'safari' it's a webview
            setBrowserType('other_inapp');
        }
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

    if (browserType === 'none') {
        return null; // Not an in-app browser, render nothing
    }

    return (
        <div className="fixed inset-0 z-[9999] bg-black/95 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
            <div className="bg-tiktok-dark border border-tiktok-gray p-8 rounded-3xl max-w-sm w-full shadow-2xl flex flex-col items-center">
                <div className="w-16 h-16 bg-tiktok-red/20 rounded-full flex items-center justify-center mb-6">
                    <ExternalLink className="w-8 h-8 text-tiktok-red" />
                </div>

                <h2 className="text-xl font-bold mb-4">ブラウザを切り替えてください</h2>

                <div className="text-tiktok-lightgray text-sm space-y-4 mb-8">
                    <p>
                        現在のアプリ内ブラウザでは、<strong>画像の保存機能が正常に動作しません</strong>。
                    </p>

                    {browserType === 'line' ? (
                        <p className="text-white font-medium bg-white/10 p-3 rounded-xl border border-white/20">
                            下のボタンが反応しない場合は、画面右上の<strong className="text-tiktok-cyan">「･･･」</strong>から<strong className="text-tiktok-cyan">「他のブラウザで開く」</strong>を選択してください。
                        </p>
                    ) : (
                        <div className="bg-white/10 p-4 rounded-xl border border-white/20 flex flex-col items-center gap-2">
                            <p className="text-white font-medium">
                                画面右上の <strong className="text-tiktok-cyan">「･･･」</strong> または <strong className="text-tiktok-cyan">「共有」</strong> アイコンをタップし、
                            </p>
                            <p className="text-white font-bold bg-tiktok-cyan/20 px-3 py-1 rounded-lg">
                                「Safariで開く」
                                <br />
                                「ブラウザで開く」
                            </p>
                            <p className="text-white font-medium">
                                を選択してください。
                            </p>
                        </div>
                    )}
                </div>

                <div className="w-full space-y-3">
                    {browserType === 'line' && (
                        <button
                            onClick={handleOpenLineExternal}
                            className="w-full py-3.5 px-4 bg-[#06C755] hover:bg-[#05b34c] text-white font-bold rounded-xl transition-colors shadow-lg flex items-center justify-center gap-2"
                        >
                            <ExternalLink className="w-5 h-5" />
                            Safari / Chrome で開く
                        </button>
                    )}

                    <button
                        onClick={handleCopyUrl}
                        className={`w-full py-3.5 px-4 font-bold rounded-xl transition-all flex items-center justify-center gap-2 border ${copied
                            ? 'bg-green-500/20 text-green-400 border-green-500/50'
                            : 'bg-transparent text-white border-tiktok-gray hover:bg-tiktok-gray/30'
                            }`}
                    >
                        {copied ? (
                            <>
                                <CheckCircle2 className="w-5 h-5" />
                                コピーしました！
                            </>
                        ) : (
                            <>
                                <Copy className="w-5 h-5" />
                                URLをコピーする
                            </>
                        )}
                    </button>
                </div>
            </div>
            {/* 開発時・検証用のデバッグ表示（後で消せます） */}
            <div className="fixed bottom-2 left-2 right-2 text-[10px] text-gray-500 break-all opacity-50 pointer-events-none text-left">
                UA: {debugUa}
            </div>
        </div>
    );
}
