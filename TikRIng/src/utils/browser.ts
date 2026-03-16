export function isTikTokInAppBrowser(): boolean {
  const ua = navigator.userAgent || '';
  const uaLower = ua.toLowerCase();

  const tiktokUaSignatures = [
    'tiktok',
    'musical_ly',
    'bytedancewebview',
    'ttwebview',
    'aweme',
    'trill',
    'tiktoklite',
    'com.zhiliaoapp.musically',
  ];

  const isTikTokUa = tiktokUaSignatures.some((signature) => uaLower.includes(signature));
  if (isTikTokUa) {
    return true;
  }

  const uaData = navigator.userAgentData as { brands?: Array<{ brand: string }> } | undefined;
  const brands = uaData?.brands ?? [];
  const hasTikTokBrand = brands.some((entry) => /tiktok|bytedance|ttwebview/i.test(entry.brand));
  if (hasTikTokBrand) {
    return true;
  }

  const referrer = document.referrer || '';
  return /tiktok\.com|tiktokv\.com|musical\.ly/i.test(referrer);
}
