// functions/[[path]].ts
// This is a catch-all middleware for Cloudflare Pages

interface Env {
    // If we had a KV namespace or DB to look up the specific frame's info, we would define it here.
    // For now, we just want to change the text so it doesn't say "ライバー専用" (For Creators).
}

export const onRequest: PagesFunction<Env> = async (context) => {
    // Fetch the original response (e.g., the static index.html)
    const response = await context.next();

    const url = new URL(context.request.url);
    const frameId = url.searchParams.get('f');

    // Only rewrite HTML if it's the index page AND it has the '?f=' query parameter (Listener sharing URL)
    if (frameId && response.headers.get('content-type')?.includes('text/html')) {

        // The new title and description for listeners
        const newTitle = "TikRing - アイコンを着せ替えよう！";
        const newDescription = "ライバーが作成した専用フレームをあなたのアイコンに重ねて応援しよう！";
        // We don't have a specific thumbnail for each frame yet, but we ensure it doesn't say "For Creators"

        return new HTMLRewriter()
            .on('title', {
                element(element) {
                    element.setInnerContent(newTitle);
                }
            })
            .on('head', {
                element(element) {
                    // Add Open Graph Meta Tags
                    element.append(`<meta property="og:title" content="${newTitle}" />`, { html: true });
                    element.append(`<meta property="og:description" content="${newDescription}" />`, { html: true });
                    element.append(`<meta property="og:type" content="website" />`, { html: true });
                    element.append(`<meta name="twitter:card" content="summary" />`, { html: true });
                    element.append(`<meta name="twitter:title" content="${newTitle}" />`, { html: true });
                    element.append(`<meta name="twitter:description" content="${newDescription}" />`, { html: true });
                }
            })
            .transform(response);
    }

    // Otherwise, return the normal response (which will be "TikRing - ライバー専用" as defined in index.html)
    return response;
};
