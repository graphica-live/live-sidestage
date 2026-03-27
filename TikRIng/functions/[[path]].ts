// functions/[[path]].ts
// This is a catch-all middleware for Cloudflare Pages

interface Env {
    // If we had a KV namespace or DB to look up the specific frame's info, we would define it here.
    // For now, we just want to change the text so it doesn't say "ライバー専用" (For Creators).
}

function buildListenerMeta(request: Request, frameId: string) {
    const url = new URL(request.url);
    const pageUrl = new URL(url.pathname, url.origin);
    pageUrl.searchParams.set('f', frameId);

    const imageUrl = new URL(`/api/frames/${encodeURIComponent(frameId)}`, url.origin);

    return {
        title: 'TikRing - アイコンを着せ替えよう！',
        description: 'ライバーが作成した専用フレームをあなたのアイコンに重ねて応援しよう！',
        pageUrl: pageUrl.toString(),
        imageUrl: imageUrl.toString(),
    };
}

function isDashboardRequest(request: Request, response: Response) {
    const url = new URL(request.url);
    return url.searchParams.get('dashboard') === '1'
        && response.headers.get('content-type')?.includes('text/html');
}

function applyCacheHeaders(request: Request, response: Response) {
    const headers = new Headers(response.headers);

    if (isDashboardRequest(request, response)) {
        headers.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=60');
        headers.delete('Pragma');
        headers.delete('Expires');
    } else {
        headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        headers.set('Pragma', 'no-cache');
        headers.set('Expires', '0');
        headers.delete('ETag');
        headers.delete('Last-Modified');
    }

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

export const onRequest: PagesFunction<Env> = async (context) => {
    // Fetch the original response (e.g., the static index.html)
    const response = await context.next();

    const url = new URL(context.request.url);
    const frameId = url.searchParams.get('f');

    // Only rewrite HTML if it's the index page AND it has the '?f=' query parameter (Listener sharing URL)
    if (frameId && response.headers.get('content-type')?.includes('text/html')) {

        const listenerMeta = buildListenerMeta(context.request, frameId);

        // The new title and description for listeners
        const newTitle = listenerMeta.title;
        const newDescription = listenerMeta.description;

        return applyCacheHeaders(context.request, new HTMLRewriter()
            .on('title', {
                element(element) {
                    element.setInnerContent(newTitle);
                }
            })
            .on('meta[name="description"]', {
                element(element) {
                    element.setAttribute('content', newDescription);
                }
            })
            .on('link[rel="canonical"]', {
                element(element) {
                    element.setAttribute('href', listenerMeta.pageUrl);
                }
            })
            .on('meta[property="og:title"]', {
                element(element) {
                    element.setAttribute('content', newTitle);
                }
            })
            .on('meta[property="og:description"]', {
                element(element) {
                    element.setAttribute('content', newDescription);
                }
            })
            .on('meta[property="og:url"]', {
                element(element) {
                    element.setAttribute('content', listenerMeta.pageUrl);
                }
            })
            .on('head', {
                element(element) {
                    // Add Open Graph Meta Tags
                    element.append(`<meta property="og:image" content="${listenerMeta.imageUrl}" />`, { html: true });
                    element.append(`<meta property="og:image:secure_url" content="${listenerMeta.imageUrl}" />`, { html: true });
                    element.append(`<meta name="twitter:card" content="summary_large_image" />`, { html: true });
                    element.append(`<meta name="twitter:title" content="${newTitle}" />`, { html: true });
                    element.append(`<meta name="twitter:description" content="${newDescription}" />`, { html: true });
                    element.append(`<meta name="twitter:image" content="${listenerMeta.imageUrl}" />`, { html: true });
                }
            })
            .transform(response));
    }

    // Otherwise, return the normal response (which will be "TikRing - ライバー専用" as defined in index.html)
    return applyCacheHeaders(context.request, response);
};
