import { useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';

export default function BrowserWarning() {
    const [copied, setCopied] = useState(false);
    const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
    const isAndroid = /Android/i.test(userAgent);
    const browserHint = isIOS
        ? 'コピーしたURLをSafariに貼り付けて開いてください'
        : isAndroid
            ? 'コピーしたURLをChromeに貼り付けて開いてください'
            : 'コピーしたURLをSafariまたはChromeに貼り付けて開いてください';
    const browserNote = isIOS
        ? 'iPhone / iPadではSafariの利用を推奨します'
        : isAndroid
            ? 'AndroidではChromeの利用を推奨します'
            : '標準ブラウザで開けない場合はSafariまたはChromeをお試しください';

    const handleCopy = async () => {
        if (!currentUrl) return;

        try {
            await navigator.clipboard.writeText(currentUrl);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    };

    return (
        <div className="min-h-screen w-full bg-gradient-to-b from-black via-gray-900 to-black text-white flex items-center justify-center px-6 relative overflow-hidden">
            <div className="w-full max-w-sm text-center animate-in fade-in duration-500 space-y-8 relative z-10">

                {/* メッセージ */}
                <div className="space-y-4">
                    <p className="text-xl font-bold text-white leading-relaxed">
                        TikTokアプリ内では<br />
                        <span className="text-tiktok-red">画像のアップロード</span>が<br />
                        できません
                    </p>
                </div>

                {/* 手順 */}
                <div className="bg-white/5 border border-white/10 rounded-2xl px-6 py-5 space-y-4 text-left relative overflow-hidden">
                    <p className="text-xs text-tiktok-lightgray text-center tracking-widest uppercase mb-2">やること</p>
                    
                    {/* ステップ連結線 */}
                    <div className="absolute left-[3.25rem] top-[4.5rem] bottom-28 w-0.5 bg-gradient-to-b from-tiktok-cyan/50 to-transparent z-0"></div>

                    <div className="flex items-center gap-4 relative z-10">
                        <div className="w-8 h-8 rounded-full bg-tiktok-cyan/20 border border-tiktok-cyan/50 flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(0,242,234,0.3)]">
                            <span className="text-tiktok-cyan text-sm font-bold">1</span>
                        </div>
                        <p className="text-white text-sm font-medium">
                            このページのURLをコピー
                            <span className="inline-flex items-center mx-1.5 px-1.5 py-1 rounded bg-white/10 border border-white/20 align-middle gap-1">
                                <Link2 className="w-4 h-4" />
                                URL
                            </span>
                            してください
                        </p>
                    </div>
                    
                    <div className="flex items-center gap-4 relative z-10 pt-2">
                        <div className="w-8 h-8 rounded-full bg-tiktok-cyan/20 border border-tiktok-cyan/50 flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(0,242,234,0.3)]">
                            <span className="text-tiktok-cyan text-sm font-bold">2</span>
                        </div>
                        <div className="space-y-1">
                            <p className="text-white text-sm font-medium">{browserHint}</p>
                            <p className="text-xs text-tiktok-lightgray">{browserNote}</p>
                        </div>
                    </div>

                    <div className="relative z-10 pt-3 space-y-3">
                        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                            <p className="text-[11px] uppercase tracking-[0.2em] text-white/40 mb-2">Current URL</p>
                            <p className="break-all text-xs leading-5 text-white/80 select-all">{currentUrl}</p>
                        </div>

                        <button
                            type="button"
                            onClick={handleCopy}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-tiktok-cyan text-black font-bold py-3 px-4 transition-colors hover:bg-[#5ffbf6]"
                        >
                            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            {copied ? 'URLをコピーしました' : 'URLをコピー'}
                        </button>
                    </div>
                </div>

                <p className="text-xs text-white/30">以上でご利用いただけます</p>
            </div>
        </div>
    );
}
