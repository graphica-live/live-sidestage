import { AlertTriangle, ArrowUpRight, MoreHorizontal } from 'lucide-react';

export default function BrowserWarning() {
    return (
        <div className="min-h-screen w-full bg-black text-white flex items-center justify-center px-4 relative overflow-hidden">
            <div className="absolute top-4 right-4 flex items-center gap-2 text-tiktok-cyan animate-pulse">
                <ArrowUpRight className="w-5 h-5 animate-bounce" />
                <span className="text-xs font-bold tracking-wide">ここをタップ</span>
                <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
                    <MoreHorizontal className="w-4 h-4" />
                </div>
            </div>

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

                        <div className="rounded-lg border border-tiktok-gray bg-black/40 p-3 text-xs text-left space-y-1.5">
                            <p className="text-white font-semibold">開き直し手順</p>
                            <p className="text-tiktok-lightgray">1. 右上の三点メニュー（…）をタップ</p>
                            <p className="text-tiktok-lightgray">2. 「ブラウザで開く」を選択</p>
                            <p className="text-tiktok-lightgray">3. Safari / Chromeでこのページを開く</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
