import { HeartHandshake, Loader2 } from 'lucide-react';
import { useState } from 'react';

const MIN_DONATION_YEN = 100;
const MAX_DONATION_YEN = 100000;
const DONATION_STEP_YEN = 100;
type DonationPresetOption = {
  amount: number;
  label: string;
  featured?: boolean;
};

const DONATION_PRESET_OPTIONS: readonly DonationPresetOption[] = [
  { amount: 500, label: '気軽に応援' },
  { amount: 1000, label: 'いちばんおすすめ', featured: true },
  { amount: 3000, label: 'しっかり支える' },
];

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
      return `応援額は${formatYen(MIN_DONATION_YEN)}円から${formatYen(MAX_DONATION_YEN)}円までの${formatYen(DONATION_STEP_YEN)}円単位で入力してください。`;
    case 'MISSING_STRIPE_SECRET_KEY':
      return '本番環境の STRIPE_SECRET_KEY が未設定です。Cloudflare Pages の Secrets を確認してください。';
    case 'DONATION_CHECKOUT_FAILED':
      return 'Stripe 側で応援ページを作成できませんでした。設定内容と Stripe ダッシュボードを確認してください。';
    default:
      return '応援ページの起動に失敗しました。時間をおいて再度お試しください。';
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
  if (!rawText) {
    return null;
  }

  const normalized = rawText.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

export default function DonationCard({ returnPath, compact = false }: DonationCardProps) {
  const [loadingTarget, setLoadingTarget] = useState<number | 'custom' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customAmount, setCustomAmount] = useState('1000');
  const supportSuccess = new URLSearchParams(window.location.search).get('support') === 'success';

  const normalizedCustomAmount = Number(customAmount);

  const isCustomAmountValid =
    Number.isInteger(normalizedCustomAmount) &&
    normalizedCustomAmount >= MIN_DONATION_YEN &&
    normalizedCustomAmount <= MAX_DONATION_YEN &&
    normalizedCustomAmount % DONATION_STEP_YEN === 0;

  const isLoading = loadingTarget !== null;
  const supportDescription = compact
    ? 'サーバー費と改善開発のための単発サポートです。'
    : 'サーバー費と改善開発のための単発サポートです。Stripeで安全に決済されます。';

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
            return JSON.parse(responseText) as {
              error?: string;
              details?: string;
              code?: string;
            };
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
          details: sanitizeErrorText(responseText) ?? 'Checkout URL がレスポンスに含まれていません。',
          code: res.status ? `HTTP_${res.status}` : null,
        }));
      }

      window.location.href = data.url;
    } catch (error) {
      let errorCode: string | null = null;
      let detail: string | null = null;
      let stripeCode: string | null = null;

      if (error instanceof Error) {
        try {
          const parsed = JSON.parse(error.message) as { error?: string; details?: string | null; code?: string | null };
          errorCode = parsed.error ?? error.message;
          detail = parsed.details ?? null;
          stripeCode = parsed.code ?? null;
        } catch {
          errorCode = error.message;
        }
      }

      setError(getSupportErrorDetailMessage(errorCode, detail, stripeCode));
      setLoadingTarget(null);
    }
  };

  return (
    <div className={`w-full rounded-md border border-emerald-400/25 bg-[linear-gradient(135deg,rgba(16,24,16,0.92),rgba(10,48,38,0.94))] ${compact ? 'p-3.5' : 'p-4'}`}>
      <div className={`flex flex-col ${compact ? 'gap-3' : 'gap-4'}`}>
        <div className="min-w-0">
          <div className={`inline-flex items-center rounded-full border border-emerald-300/20 bg-emerald-400/10 font-bold uppercase text-emerald-200 ${compact ? 'gap-1.5 px-2.5 py-1 text-[10px] tracking-[0.16em]' : 'gap-2 px-3 py-1 text-[11px] tracking-[0.18em]'}`}>
            <HeartHandshake className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
            Support
          </div>
          <p className={`text-white ${compact ? 'mt-2 text-[13px] font-bold' : 'mt-3 text-sm font-bold'}`}>
            TikRingを続ける力になります
          </p>
          <p className={`mt-1 text-emerald-50/75 ${compact ? 'text-[11px] leading-4' : 'text-sm'}`}>
            {supportDescription}
          </p>
        </div>

        <div className={`flex flex-col ${compact ? 'gap-2.5' : 'gap-3'}`}>
          <div className={`grid grid-cols-3 ${compact ? 'gap-1.5' : 'gap-2'}`}>
            {DONATION_PRESET_OPTIONS.map((option) => (
              <button
                key={option.amount}
                type="button"
                onClick={() => void handleDonate(option.amount, option.amount)}
                disabled={isLoading}
                className={`border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${compact ? 'rounded-lg px-2.5 py-2' : 'rounded-xl px-3 py-2.5'} ${option.featured ? 'border-emerald-300/60 bg-emerald-300/12 shadow-[0_0_0_1px_rgba(110,231,183,0.15)] hover:bg-emerald-300/18' : 'border-emerald-200/20 bg-black/20 hover:border-emerald-200/40 hover:bg-black/30'}`}
              >
                <div className={`font-bold tracking-[0.04em] ${compact ? 'text-[9px]' : 'text-[10px]'} ${option.featured ? 'text-emerald-200' : 'text-emerald-100/70'}`}>{option.label}</div>
                <div className={`flex items-center justify-between ${compact ? 'mt-0.5 gap-1.5' : 'mt-1 gap-2'}`}>
                  <span className={`font-black text-white ${compact ? 'text-[13px]' : 'text-sm'}`}>{formatYen(option.amount)}円</span>
                  {loadingTarget === option.amount ? <Loader2 className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} animate-spin text-emerald-200`} /> : <HeartHandshake className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} text-emerald-200`} />}
                </div>
              </button>
            ))}
          </div>

          <div className={`flex flex-col items-start ${compact ? 'gap-1.5' : 'gap-2'}`}>
            <button
              type="button"
              onClick={() => setIsCustomMode((current) => !current)}
              disabled={isLoading}
              className={`font-bold text-emerald-200 underline decoration-emerald-200/35 underline-offset-4 transition-colors hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 ${compact ? 'text-[11px]' : 'text-xs'}`}
            >
              {isCustomMode ? '金額指定を閉じる' : '金額を指定して支援する'}
            </button>

            {isCustomMode ? (
              <div className={`w-full rounded-xl border border-emerald-200/15 bg-black/15 ${compact ? 'p-2.5' : 'p-3'}`}>
                <div className={`flex flex-col sm:flex-row sm:items-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
                  <div className={`flex items-center rounded-md border border-emerald-200/20 bg-black/20 px-3 ${compact ? 'py-1.5 sm:w-[160px]' : 'py-2 sm:w-[180px]'}`}>
                    <span className="mr-2 text-sm font-bold text-emerald-100">¥</span>
                    <input
                      type="number"
                      min={MIN_DONATION_YEN}
                      max={MAX_DONATION_YEN}
                      step={DONATION_STEP_YEN}
                      inputMode="numeric"
                      value={customAmount}
                      onChange={(event) => setCustomAmount(event.target.value)}
                      disabled={isLoading}
                      className={`w-full bg-transparent text-right font-bold text-white outline-none disabled:cursor-not-allowed ${compact ? 'text-[13px]' : 'text-sm'}`}
                      aria-label="support amount"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleDonate(normalizedCustomAmount, 'custom')}
                    disabled={isLoading}
                    className={`inline-flex items-center justify-center gap-2 rounded-md bg-emerald-400 font-black text-emerald-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 ${compact ? 'px-3.5 py-2 text-[13px]' : 'px-4 py-2.5 text-sm'}`}
                  >
                    {loadingTarget === 'custom' ? <Loader2 className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} animate-spin`} /> : <HeartHandshake className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />}
                    {loadingTarget === 'custom' ? '応援ページを開いています...' : `${isCustomAmountValid ? `${formatYen(normalizedCustomAmount)}円で応援する` : '応援する'}`}
                  </button>
                </div>

                <p className={`text-emerald-100/55 ${compact ? 'mt-1.5 text-[10px]' : 'mt-2 text-[11px]'}`}>
                  {formatYen(MIN_DONATION_YEN)}円から{formatYen(MAX_DONATION_YEN)}円まで、{formatYen(DONATION_STEP_YEN)}円単位
                </p>
              </div>
            ) : null}
          </div>

          <p className={`text-emerald-100/55 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
            単発支援です。継続課金ではありません。
          </p>
        </div>
      </div>

      {error ? (
        <p className={`text-tiktok-red ${compact ? 'mt-2 text-[11px]' : 'mt-3 text-xs'}`}>{error}</p>
      ) : null}

      {supportSuccess ? (
        <p className={`text-emerald-200 ${compact ? 'mt-2 text-[11px]' : 'mt-3 text-xs'}`}>応援ありがとうございます。Stripe で受け付けました。</p>
      ) : null}
    </div>
  );
}