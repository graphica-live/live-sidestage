import { HeartHandshake, Loader2 } from 'lucide-react';
import { useState } from 'react';

const MIN_DONATION_YEN = 100;
const MAX_DONATION_YEN = 100000;
const DONATION_STEP_YEN = 100;

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('500');
  const supportSuccess = new URLSearchParams(window.location.search).get('support') === 'success';

  const normalizedAmount = Number(amount);

  const isAmountValid =
    Number.isInteger(normalizedAmount) &&
    normalizedAmount >= MIN_DONATION_YEN &&
    normalizedAmount <= MAX_DONATION_YEN &&
    normalizedAmount % DONATION_STEP_YEN === 0;

  const handleDonate = async () => {
    if (loading) return;
    if (!isAmountValid) {
      setError(getSupportErrorMessage('INVALID_DONATION_AMOUNT'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/checkout/donate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnPath, amount: normalizedAmount }),
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
      setLoading(false);
    }
  };

  return (
    <div className={`w-full rounded-md border border-emerald-400/25 bg-[linear-gradient(135deg,rgba(16,24,16,0.92),rgba(10,48,38,0.94))] ${compact ? 'p-4' : 'p-5'}`}>
      <div className={`flex ${compact ? 'flex-col gap-3 sm:flex-row sm:items-center sm:justify-between' : 'flex-col gap-4'}`}>
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-bold tracking-[0.18em] text-emerald-200 uppercase">
            <HeartHandshake className="h-3.5 w-3.5" />
            Support
          </div>
          <p className={`mt-3 text-white ${compact ? 'text-sm font-bold' : 'text-base font-bold'}`}>
            TikRingの運営を応援できます
          </p>
          <p className={`mt-1 text-emerald-50/75 ${compact ? 'text-xs' : 'text-sm'}`}>
            Stripeで安全に単発応援できます。金額は自由入力で、支援は保守と改善に使います。
          </p>
        </div>

        <div className={`flex ${compact ? 'w-full flex-col gap-2 sm:w-auto' : 'flex-col gap-2'} ${compact ? 'sm:items-end' : ''}`}>
          <label className="flex flex-col gap-1 text-left">
            <span className="text-[11px] font-bold tracking-[0.08em] text-emerald-100/80">応援金額</span>
            <div className="flex items-center rounded-md border border-emerald-200/20 bg-black/20 px-3 py-2">
              <input
                type="number"
                min={MIN_DONATION_YEN}
                max={MAX_DONATION_YEN}
                step={DONATION_STEP_YEN}
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={loading}
                className="w-28 bg-transparent text-right text-sm font-bold text-white outline-none disabled:cursor-not-allowed"
                aria-label="support amount"
              />
              <span className="ml-2 text-sm font-bold text-emerald-100">円</span>
            </div>
          </label>

          <p className="text-[11px] text-emerald-100/65">
            {formatYen(MIN_DONATION_YEN)}円から{formatYen(MAX_DONATION_YEN)}円まで、{formatYen(DONATION_STEP_YEN)}円単位
          </p>

          <button
            type="button"
            onClick={handleDonate}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-400 px-4 py-2.5 text-sm font-black text-emerald-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <HeartHandshake className="h-4 w-4" />}
            {loading ? '応援ページを開いています...' : `${isAmountValid ? `${formatYen(normalizedAmount)}円で応援する` : '応援する'}`}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-xs text-tiktok-red">{error}</p>
      ) : null}

      {supportSuccess ? (
        <p className="mt-3 text-xs text-emerald-200">応援ありがとうございます。Stripe で受け付けました。</p>
      ) : null}
    </div>
  );
}