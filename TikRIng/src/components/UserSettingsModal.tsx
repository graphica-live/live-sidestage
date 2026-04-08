import { useEffect, useState } from 'react';
import { Loader2, Pencil, X } from 'lucide-react';

type User = {
  id: string;
  display_name: string;
  plan: string;
  isAdmin: boolean;
  email?: string | null;
  provider?: string;
};

type DisplayNameUpdateResponse = {
  error?: string;
  message?: string;
  user?: User;
};

interface UserSettingsModalProps {
  open: boolean;
  user: User;
  onClose: () => void;
  onUserChange: (user: User) => void;
}

export default function UserSettingsModal({ open, user, onClose, onUserChange }: UserSettingsModalProps) {
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState(user.display_name);
  const [displayNameEditing, setDisplayNameEditing] = useState(false);
  const [displayNameSaving, setDisplayNameSaving] = useState(false);
  const [displayNameMessage, setDisplayNameMessage] = useState<string | null>(null);
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  useEffect(() => {
    setDisplayNameInput(user.display_name);
  }, [user.display_name]);

  useEffect(() => {
    if (!open) {
      setCancelConfirm(false);
      setDisplayNameEditing(false);
      setDisplayNameError(null);
      setDisplayNameMessage(null);
      setDisplayNameInput(user.display_name);
    }
  }, [open, user.display_name]);

  const handleCancelSubscription = async () => {
    if (canceling) return;
    setCanceling(true);
    try {
      const res = await fetch('/api/checkout/cancel', { method: 'POST' });
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      if (!res.ok) throw new Error('Cancel failed');
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('Missing portal url');
    } finally {
      setCanceling(false);
    }
  };

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval: billingInterval }),
      });
      if (res.status === 401) {
        window.location.href = '/';
        return;
      }
      if (!res.ok) throw new Error('Checkout failed');
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      throw new Error('Missing checkout url');
    } catch {
      setDisplayNameError(null);
      setDisplayNameMessage('チェックアウトの開始に失敗しました。もう一度お試しください。');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleDisplayNameSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (displayNameSaving) {
      return;
    }

    const nextDisplayName = displayNameInput.trim();
    if (!nextDisplayName) {
      setDisplayNameError('ユーザー名を入力してください。');
      setDisplayNameMessage(null);
      return;
    }

    if (nextDisplayName === user.display_name) {
      setDisplayNameError(null);
      setDisplayNameMessage('現在のユーザー名と同じです。');
      return;
    }

    setDisplayNameSaving(true);
    setDisplayNameError(null);
    setDisplayNameMessage(null);

    try {
      const endpoints = ['/api/auth/me', '/api/auth/display-name'];
      let responseUser: User | null = null;
      let lastErrorCode = 'FAILED_TO_UPDATE_DISPLAY_NAME';

      for (const endpoint of endpoints) {
        let res: Response;
        try {
          res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ displayName: nextDisplayName }),
          });
        } catch {
          lastErrorCode = 'NETWORK_ERROR';
          continue;
        }

        if (res.status === 401) {
          window.location.href = '/';
          return;
        }

        let data: DisplayNameUpdateResponse | null = null;
        try {
          data = await res.json() as DisplayNameUpdateResponse;
        } catch {
          data = null;
        }

        if (res.ok && data?.user) {
          responseUser = data.user;
          break;
        }

        lastErrorCode = data?.message || data?.error || `HTTP_${res.status}`;

        if (res.status !== 404 && res.status !== 405) {
          break;
        }
      }

      if (!responseUser) {
        throw new Error(lastErrorCode);
      }

      onUserChange(responseUser);
      setDisplayNameInput(responseUser.display_name);
      setDisplayNameEditing(false);
      setDisplayNameMessage('ユーザー名を更新しました。ランキング表示にも反映されます。');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'FAILED_TO_UPDATE_DISPLAY_NAME';
      if (message === 'DISPLAY_NAME_REQUIRED') {
        setDisplayNameError('ユーザー名を入力してください。');
      } else if (message === 'NETWORK_ERROR') {
        setDisplayNameError('通信に失敗しました。時間をおいて再度お試しください。');
      } else {
        setDisplayNameError(`ユーザー名の更新に失敗しました。(${message})`);
      }
    } finally {
      setDisplayNameSaving(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-[1px] flex items-center justify-center px-4 py-6"
        onClick={onClose}
      >
        <div
          className="w-full max-w-xl rounded-2xl border border-white/15 bg-tiktok-dark p-5 shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-settings-title"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-tiktok-lightgray">Account Settings</p>
              <h2 id="dashboard-settings-title" className="mt-1 text-xl font-black text-white">設定</h2>
              <p className="mt-1 text-xs text-tiktok-lightgray">ユーザー名の変更と Pro の課金状態をここで管理できます。</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-tiktok-gray bg-tiktok-black px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-tiktok-gray/40"
            >
              閉じる
            </button>
          </div>

          <div className="mt-4 space-y-4">
            <section className="rounded-xl border border-tiktok-gray bg-tiktok-black/70 p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-tiktok-lightgray">ユーザー名</p>
                  {displayNameEditing ? (
                    <form onSubmit={handleDisplayNameSubmit} className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        value={displayNameInput}
                        onChange={(event) => {
                          setDisplayNameInput(event.target.value);
                          if (displayNameError) {
                            setDisplayNameError(null);
                          }
                          if (displayNameMessage) {
                            setDisplayNameMessage(null);
                          }
                        }}
                        placeholder="ユーザー名を入力"
                        maxLength={100}
                        autoFocus
                        className="w-full rounded-md border border-tiktok-gray bg-tiktok-black px-3 py-2.5 text-sm text-white focus:border-tiktok-cyan focus:outline-none sm:min-w-[18rem]"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={displayNameSaving}
                          className="inline-flex min-w-[110px] items-center justify-center rounded-md bg-tiktok-cyan px-4 py-2.5 text-sm font-bold text-black transition-colors hover:bg-[#53f3ff] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {displayNameSaving ? (
                            <span className="inline-flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              保存中...
                            </span>
                          ) : '保存'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (displayNameSaving) {
                              return;
                            }
                            setDisplayNameEditing(false);
                            setDisplayNameInput(user.display_name);
                            setDisplayNameError(null);
                            setDisplayNameMessage(null);
                          }}
                          disabled={displayNameSaving}
                          className="inline-flex items-center justify-center rounded-md border border-tiktok-gray bg-tiktok-black px-3 py-2.5 text-sm font-bold text-white transition-colors hover:bg-tiktok-gray/40 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label="ユーザー名編集をキャンセル"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="mt-1 flex items-center gap-2">
                      <p className="text-lg font-black text-white break-all">{user.display_name}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setDisplayNameEditing(true);
                          setDisplayNameInput(user.display_name);
                          setDisplayNameError(null);
                          setDisplayNameMessage(null);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-tiktok-gray bg-tiktok-black text-tiktok-lightgray transition-colors hover:border-tiktok-cyan hover:text-white"
                        aria-label="ユーザー名を編集"
                        title="ユーザー名を編集"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-tiktok-lightgray">変更後の名前はランキングと管理画面の表示に使われます。</p>
                </div>
              </div>
              {displayNameError ? (
                <p className="mt-3 text-sm text-tiktok-red">{displayNameError}</p>
              ) : null}
              {displayNameMessage ? (
                <p className={`mt-3 text-sm ${displayNameError ? 'text-tiktok-red' : 'text-tiktok-cyan'}`}>{displayNameMessage}</p>
              ) : null}
            </section>

            <section className="rounded-xl border border-tiktok-gray bg-tiktok-black/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-tiktok-lightgray">Pro課金</p>
                  <p className="mt-1 text-lg font-black text-white">{user.isAdmin ? '管理者権限で Pro 相当' : user.plan === 'pro' ? 'Pro 利用中' : '無料プラン'}</p>
                  <p className="mt-1 text-xs text-tiktok-lightgray">
                    {user.isAdmin
                      ? '管理者アカウントのため、課金なしで Pro 機能を利用できます。'
                      : user.plan === 'pro'
                        ? 'サブスクリプション管理ページから解約や支払い情報の確認ができます。'
                        : '有効期限設定、パスワード保護、閲覧数・装着数の確認が使えます。'}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${user.plan === 'pro' || user.isAdmin ? 'bg-tiktok-cyan/20 text-tiktok-cyan border border-tiktok-cyan/30' : 'bg-tiktok-gray text-tiktok-lightgray border border-tiktok-gray'}`}>
                  {user.plan === 'pro' || user.isAdmin ? 'Pro' : '無料'}
                </span>
              </div>

              {!user.isAdmin && user.plan !== 'pro' ? (
                <>
                  <ul className="mt-4 space-y-1 pl-5 text-xs text-tiktok-lightgray list-disc">
                    <li>有効期限を自由に設定（1日〜無期限）</li>
                    <li>フレームにパスワードを設定</li>
                    <li>閲覧数・装着数を確認</li>
                    <li>フレームに名前を付けて整理しやすく</li>
                  </ul>

                  <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label
                      className={`rounded-md border px-3 py-2 cursor-pointer transition-colors ${billingInterval === 'monthly'
                        ? 'border-tiktok-cyan/50 bg-tiktok-cyan/10'
                        : 'border-tiktok-gray bg-tiktok-black'}
                      `}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="sharedBillingInterval"
                          value="monthly"
                          checked={billingInterval === 'monthly'}
                          onChange={() => setBillingInterval('monthly')}
                          className="accent-white"
                        />
                        <span className="text-sm font-bold text-white">月払い 380円/月</span>
                      </div>
                    </label>

                    <label
                      className={`rounded-md border px-3 py-2 cursor-pointer transition-colors ${billingInterval === 'yearly'
                        ? 'border-tiktok-cyan/50 bg-tiktok-cyan/10'
                        : 'border-tiktok-gray bg-tiktok-black'}
                      `}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="sharedBillingInterval"
                            value="yearly"
                            checked={billingInterval === 'yearly'}
                            onChange={() => setBillingInterval('yearly')}
                            className="accent-white"
                          />
                          <span className="text-sm font-bold text-white">年払い 3,800円/年</span>
                        </div>
                        {billingInterval === 'yearly' ? (
                          <span className="shrink-0 rounded-full border border-tiktok-cyan/30 bg-tiktok-cyan/20 px-2 py-0.5 text-[10px] font-bold text-tiktok-cyan">
                            2ヶ月分お得
                          </span>
                        ) : null}
                      </div>
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={handleCheckout}
                    disabled={checkoutLoading}
                    className="mt-4 w-full rounded-md bg-tiktok-red px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#D92648] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {checkoutLoading ? 'チェックアウトを準備中...' : 'Proにアップグレードする'}
                  </button>
                </>
              ) : null}

              {!user.isAdmin && user.plan === 'pro' ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-tiktok-dark px-4 py-4">
                  <button
                    type="button"
                    onClick={() => setCancelConfirm(true)}
                    className="w-full rounded-md border border-tiktok-red/40 bg-tiktok-red/10 px-4 py-2.5 text-sm font-bold text-tiktok-red transition-colors hover:bg-tiktok-red/20"
                  >
                    サブスクリプションを解約する
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>

      {cancelConfirm ? (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-[1px] flex items-center justify-center px-4">
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-tiktok-dark p-5 shadow-2xl text-center">
            <p className="text-white font-bold mb-1">Stripeの管理画面へ移動しますか？</p>
            <p className="text-xs text-tiktok-lightgray mb-4">Stripeのサブスクリプション管理ページへ移動します。解約や支払い情報の確認はStripe側で行います。解約が完了すると、Pro機能は使えなくなります。</p>
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={handleCancelSubscription}
                disabled={canceling}
                className="flex-1 py-3 rounded-md bg-tiktok-red hover:bg-[#D92648] text-white font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {canceling ? '移動中...' : 'Stripeを開く'}
              </button>
              <button
                type="button"
                onClick={() => setCancelConfirm(false)}
                disabled={canceling}
                className="flex-1 py-3 rounded-md bg-tiktok-gray hover:bg-tiktok-lightgray/40 text-white font-bold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}