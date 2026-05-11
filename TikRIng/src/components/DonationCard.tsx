import { Loader2 } from 'lucide-react';
import { useState } from 'react';

const MIN_DONATION_YEN = 100;
const MAX_DONATION_YEN = 100000;
const DONATION_STEP_YEN = 100;

const DONATION_PRESET_OPTIONS = [
  { amount: 500, label: 'ﾂ･500' },
  { amount: 1000, label: 'ﾂ･1,000' },
  { amount: 3000, label: 'ﾂ･3,000' },
] as const;

function formatYen(amount: number): string {
  return new Intl.NumberFormat('ja-JP').format(amount);
}

interface DonationCardProps {
  returnPath: string;
  compact?: boolean;
}

function getSupportErrorMessage(errorCode: string | null): string {
  switch (errorCode) {
    case 'INVALID_DONATION_AMOUNT':
      return `蠢懈抄鬘阪・${formatYen(MIN_DONATION_YEN)}蜀・°繧・{formatYen(MAX_DONATION_YEN)}蜀・∪縺ｧ縺ｮ${formatYen(DONATION_STEP_YEN)}蜀・腰菴阪〒蜈･蜉帙＠縺ｦ縺上□縺輔＞縲Ａ;
    case 'MISSING_STRIPE_SECRET_KEY':
      return '譛ｬ逡ｪ迺ｰ蠅・・ STRIPE_SECRET_KEY 縺梧悴險ｭ螳壹〒縺吶・loudflare Pages 縺ｮ Secrets 繧堤｢ｺ隱阪＠縺ｦ縺上□縺輔＞縲・;
    case 'DONATION_CHECKOUT_FAILED':
      return 'Stripe 蛛ｴ縺ｧ蠢懈抄繝壹・繧ｸ繧剃ｽ懈・縺ｧ縺阪∪縺帙ｓ縺ｧ縺励◆縲りｨｭ螳壼・螳ｹ縺ｨ Stripe 繝繝・す繝･繝懊・繝峨ｒ遒ｺ隱阪＠縺ｦ縺上□縺輔＞縲・;
    default:
      return '蠢懈抄繝壹・繧ｸ縺ｮ襍ｷ蜍輔↓螟ｱ謨励＠縺ｾ縺励◆縲よ凾髢薙ｒ縺翫＞縺ｦ蜀榊ｺｦ縺願ｩｦ縺励￥縺縺輔＞縲・;
  }
}

function getSupportErrorDetailMessage(errorCode: string | null, detail: string | null, stripeCode: string | null): string {
  if (!detail) {
    return getSupportErrorMessage(errorCode);
  }
  if (stripeCode) {
    return `${getSupportErrorMessage(errorCode)} (${stripeCode}: ${detail})`;
  }
  return `${getSupportErrorMessage(errorCode)} (${detail})`;
}

function sanitizeErrorText(rawText: string | null): string | null {
  if (!rawText) return null;
  const normalized = rawText.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

export default function DonationCard({ returnPath }: DonationCardProps) {
  const [loadingTarget, setLoadingTarget] = useState<number | 'custom' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const supportSuccess = new URLSearchParams(window.location.search).get('support') === 'success';

  const isLoading = loadingTarget !== null;
  const normalizedCustomAmount = Number(customAmount);
  const isCustomAmountValid =
    customAmount !== '' &&
    Number.isInteger(normalizedCustomAmount) &&
    normalizedCustomAmount >= MIN_DONATION_YEN &&
    normalizedCustomAmount <= MAX_DONATION_YEN &&
    normalizedCustomAmount % DONATION_STEP_YEN === 0;

  const handleDonate = async (amount: number, target: number | 'custom') => {
    if (isLoading) return;
    const isAmountValid =
      Number.isInteger(amount) &&
      amount >= MIN_DONATION_YEN &&
      amount <= MAX_DONATION_YEN &&
      amount % DONATION_STEP_YEN === 0;

    if (!isAmountValid) {
      setError(getSupportErrorMessage('INVALID_DONATION_AMOUNT'));
      return;
    }

    setLoadingTarget(target);
    setError(null);

    try {
      const res = await fetch('/api/checkout/donate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnPath, amount }),
      });

      const responseText = await res.text();

      if (!res.ok) {
        const errorData = (() => {
          try {
            return JSON.parse(responseText) as { error?: string; details?: string; code?: string };
          } catch {
            return null;
          }
        })();
        const fallbackDetail = sanitizeErrorText(responseText);
        throw new Error(JSON.stringify({
          error: errorData?.error ?? 'DONATION_CHECKOUT_FAILED',
          details: errorData?.details ?? fallbackDetail,
          code: errorData?.code ?? (res.status ? `HTTP_${res.status}` : null),
        }));
      }

      const data = (() => {
        try {
          return JSON.parse(responseText) as { url?: string };
        } catch {
          return null;
        }
      })();

      if (!data?.url) {
        throw new Error(JSON.stringify({
          error: 'DONATION_CHECKOUT_FAILED',
          details: sanitizeErrorText(responseText) ?? 'Checkout URL 縺後Ξ繧ｹ繝昴Φ繧ｹ縺ｫ蜷ｫ縺ｾ繧後※縺・∪縺帙ｓ縲・,
          code: res.status ? `HTTP_${res.status}` : null,
        }));
      }

      window.location.href = data.url;
    } catch (err) {
      let errorCode: string | null = null;
      let detail: string | null = null;
      let stripeCode: string | null = null;
      if (err instanceof Error) {
        try {
          const parsed = JSON.parse(err.message) as { error?: string; details?: string | null; code?: string | null };
          errorCode = parsed.error ?? err.message;
          detail = parsed.details ?? null;
          stripeCode = parsed.code ?? null;
        } catch {
          errorCode = err.message;
        }
      }
      setError(getSupportErrorDetailMessage(errorCode, detail, stripeCode));
      setLoadingTarget(null);
    }
  };

  return (
    <div
      className="relative w-full rounded-[18px] text-center"
      style={{
        background: 'linear-gradient(160deg, rgb(42,16,24) 0%, rgb(26,10,16) 100%)',
        padding: '32px 28px 24px',
        animation: 'donate-glow 3s ease-in-out infinite',
      }}
    >
      {/* gradient border */}
      <div
        aria-hidden
        style={{
          content: '""',
          position: 'absolute',
          inset: 0,
          borderRadius: 18,
          padding: 2,
          background: 'linear-gradient(135deg, rgb(251,146,60), rgb(244,63,94), rgb(251,146,60))',
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          pointerEvents: 'none',
        }}
      />

      <div className="text-[2.2rem] mb-2">笘・/div>

      <p
        className="text-[1.2rem] font-extrabold mb-2"
        style={{ background: 'linear-gradient(135deg, rgb(251,146,60), rgb(244,63,94))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
      >
        TikRing繧貞ｿ懈抄縺吶ｋ
      </p>

      <p className="text-[0.85rem] leading-relaxed mb-5" style={{ color: 'rgb(204,204,170)' }}>
        縺薙・繧ｵ繝ｼ繝薙せ縺ｯ螳悟・辟｡譁吶〒謠蝉ｾ帙＠縺ｦ縺・∪縺吶・br />
        豌励↓蜈･縺｣縺ｦ縺・◆縺縺代◆繧峨√●縺ｲ縺疲髪謠ｴ繧偵♀鬘倥＞縺励∪縺呻ｼ・
      </p>

      {/* preset buttons */}
      <div className="flex gap-2.5 justify-center flex-wrap mb-3">
        {DONATION_PRESET_OPTIONS.map((option) => (
          <button
            key={option.amount}
            type="button"
            onClick={() => { setSelectedPreset(option.amount); setCustomAmount(''); void handleDonate(option.amount, option.amount); }}
            disabled={isLoading}
            className="px-5 py-2.5 rounded-[10px] text-base font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: selectedPreset === option.amount ? 'linear-gradient(135deg, rgb(58,16,32), rgb(42,8,24))' : 'rgb(26,8,16)',
              border: `1.5px solid ${selectedPreset === option.amount ? 'rgb(251,146,60)' : 'rgb(107,32,48)'}`,
              color: selectedPreset === option.amount ? 'rgb(253,186,116)' : 'rgb(224,224,224)',
            }}
          >
            {loadingTarget === option.amount
              ? <Loader2 className="inline h-4 w-4 animate-spin" />
              : option.label}
          </button>
        ))}
      </div>

      {/* custom amount */}
      <div className="flex items-center gap-2 justify-center">
        <span className="text-[0.9rem]" style={{ color: 'rgb(170,170,170)' }}>ﾂ･</span>
        <input
          type="number"
          min={MIN_DONATION_YEN}
          max={MAX_DONATION_YEN}
          step={DONATION_STEP_YEN}
          inputMode="numeric"
          placeholder="驥鷹｡阪ｒ蜈･蜉・
          value={customAmount}
          onChange={(e) => { setCustomAmount(e.target.value); setSelectedPreset(null); }}
          disabled={isLoading}
          className="w-[110px] py-2 px-3 rounded-lg text-[0.9rem] font-semibold text-right text-white outline-none disabled:cursor-not-allowed"
          style={{
            background: 'rgb(15,15,24)',
            border: `1px solid ${customAmount && selectedPreset === null ? 'rgb(251,146,60)' : 'rgb(58,58,90)'}`,
          }}
          aria-label="謾ｯ謠ｴ驥鷹｡・
        />
        <button
          type="button"
          onClick={() => void handleDonate(normalizedCustomAmount, 'custom')}
          disabled={isLoading || !isCustomAmountValid}
          className="px-5 py-2 rounded-[10px] text-base font-bold text-white transition-all hover:opacity-90 disabled:opacity-35 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(135deg, rgb(251,146,60), rgb(244,63,94))' }}
        >
          {loadingTarget === 'custom' ? <Loader2 className="inline h-4 w-4 animate-spin" /> : '謾ｯ謠ｴ縺吶ｋ'}
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-xs text-tiktok-red">{error}</p>
      ) : null}

      {supportSuccess ? (
        <p className="mt-3 text-xs" style={{ color: 'rgb(74,222,128)' }}>蠢懈抄縺ゅｊ縺後→縺・＃縺悶＞縺ｾ縺吶４tripe 縺ｧ蜿励￠莉倥￠縺ｾ縺励◆縲・/p>
      ) : null}
    </div>
  );
}
