export function isTikTokInAppBrowser(): boolean {
  const ua = navigator.userAgent || '';
  return /TikTok|musical_ly|BytedanceWebview|aweme/i.test(ua);
}
