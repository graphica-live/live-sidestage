import { MoreHorizontal, ArrowUpRight } from 'lucide-react';

export default function BrowserWarning() {
    return (
        <div className="min-h-screen w-full bg-gradient-to-b from-black via-gray-900 to-black text-white flex items-center justify-center px-6 relative overflow-hidden">
            
            {/* 強調された右上誘導矢印 */}
            <div className="absolute top-5 right-5 flex flex-col items-center animate-bounce z-50 pointer-events-none">
                <span className="text-tiktok-cyan text-xs font-bold mb-1 tracking-widest drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">ここ！</span>
                <ArrowUpRight className="w-12 h-12 text-tiktok-cyan drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] transform rotate-6" strokeWidth={3} />
            </div>

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
                    <div className="absolute left-[3.25rem] top-[4.5rem] bottom-10 w-0.5 bg-gradient-to-b from-tiktok-cyan/50 to-transparent z-0"></div>

                    <div className="flex items-center gap-4 relative z-10">
                        <div className="w-8 h-8 rounded-full bg-tiktok-cyan/20 border border-tiktok-cyan/50 flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(0,242,234,0.3)]">
                            <span className="text-tiktok-cyan text-sm font-bold">1</span>
                        </div>
                        <p className="text-white text-sm font-medium">
                            画面右上の
                            <span className="inline-flex items-center mx-1.5 px-1.5 py-1 rounded bg-white/10 border border-white/20 align-middle">
                                <MoreHorizontal className="w-4 h-4" />
                            </span>
                            をタップ
                        </p>
                    </div>
                    
                    <div className="flex items-center gap-4 relative z-10 pt-2">
                        <div className="w-8 h-8 rounded-full bg-tiktok-cyan/20 border border-tiktok-cyan/50 flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(0,242,234,0.3)]">
                            <span className="text-tiktok-cyan text-sm font-bold">2</span>
                        </div>
                        <p className="text-white text-sm font-medium">
                            「<span className="text-tiktok-cyan font-bold border-b border-tiktok-cyan/30 pb-0.5">ブラウザで開く</span>」をタップ
                        </p>
                    </div>
                </div>

                <p className="text-xs text-white/30">以上でご利用いただけます</p>
            </div>
        </div>
    );
}
