import { AlertTriangle, ArrowUpRight, MoreHorizontal } from 'lucide-react';

export default function BrowserWarning() {
    return (
        <div className="min-h-screen w-full bg-gradient-to-b from-black via-gray-900 to-black text-white flex items-center justify-center px-4 relative overflow-hidden">
            <div className="absolute top-4 right-4 flex items-center gap-2 text-tiktok-cyan animate-pulse">
                <ArrowUpRight className="w-5 h-5 animate-bounce" />
                <span className="text-xs font-bold tracking-wide">ここをタップ</span>
                <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
                    <MoreHorizontal className="w-4 h-4" />
                </div>
            </div>

            <div className="w-full max-w-2xl bg-tiktok-dark/90 backdrop-blur-md border border-tiktok-gray rounded-xl p-5 sm:p-6 animate-in fade-in duration-500 shadow-lg">
                <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-tiktok-red shrink-0">
                        <AlertTriangle className="w-6 h-6" />
                    </div>
                    <div className="flex-1">
                        <p className="text-base font-semibold text-white mb-3 leading-relaxed pr-6">
                            TikTokアプリ内ブラウザでは<span className="text-tiktok-red font-bold">画像の保存・アップロードができません</span>。<br />
                            必ず <strong className="text-tiktok-cyan break-keep">Safari</strong> または <strong className="text-tiktok-cyan break-keep">Chrome</strong> で開き直してください。
                        </p>
                        <p className="text-sm text-tiktok-lightgray mb-4">
                            この画面では機能を利用できないように制限しています。
                        </p>

                        <div className="rounded-lg border border-tiktok-gray bg-black/40 p-4 text-sm text-left space-y-2">
                            <p className="text-white font-bold">開き直し手順</p>
                            <ul className="list-disc list-inside text-tiktok-lightgray space-y-1">
                                <li>右上の三点メニュー（…）をタップ</li>
                                <li>「ブラウザで開く」を選択</li>
                                <li>Safari / Chromeでこのページを開く</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
