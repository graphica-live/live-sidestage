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

    const imageUrl = new URL(`/api/share/thumbnail/${encodeURIComponent(frameId)}.png`, url.origin);

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
            .on('meta', {
                element(element) {
                    const property = element.getAttribute('property');
                    const name = element.getAttribute('name');

                    if (name === 'description') {
                        element.remove();
                        return;
                    }

                    if (
                        property === 'og:title'
                        || property === 'og:description'
                        || property === 'og:type'
                        || property === 'og:url'
                        || property === 'og:image'
                        || property === 'og:image:url'
                        || property === 'og:image:secure_url'
                        || property === 'og:image:type'
                        || property === 'og:image:width'
                        || property === 'og:image:height'
                        || property === 'og:image:alt'
                        || property === 'og:site_name'
                        || name === 'twitter:card'
                        || name === 'twitter:title'
                        || name === 'twitter:description'
                        || name === 'twitter:image'
                    ) {
                        element.remove();
                    }
                }
            })
            .on('link', {
                element(element) {
                    if (element.getAttribute('rel') === 'canonical') {
                        element.remove();
                    }
                }
            })
            .on('head', {
                element(element) {
                    element.append(`<meta name="description" content="${newDescription}" />`, { html: true });
                    element.append(`<link rel="canonical" href="${listenerMeta.pageUrl}" />`, { html: true });
                    element.append(`<meta property="og:title" content="${newTitle}" />`, { html: true });
                    element.append(`<meta property="og:description" content="${newDescription}" />`, { html: true });
                    element.append(`<meta property="og:type" content="website" />`, { html: true });
                    element.append(`<meta property="og:url" content="${listenerMeta.pageUrl}" />`, { html: true });
                    element.append(`<meta property="og:image" content="${listenerMeta.imageUrl}" />`, { html: true });
                    element.append(`<meta property="og:image:url" content="${listenerMeta.imageUrl}" />`, { html: true });
                    element.append(`<meta property="og:image:secure_url" content="${listenerMeta.imageUrl}" />`, { html: true });
                    element.append(`<meta property="og:image:type" content="image/png" />`, { html: true });
                    element.append(`<meta property="og:image:width" content="1200" />`, { html: true });
                    element.append(`<meta property="og:image:height" content="630" />`, { html: true });
                    element.append(`<meta property="og:image:alt" content="TikRing listener frame preview" />`, { html: true });
                    element.append(`<meta property="og:site_name" content="TikRing" />`, { html: true });
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
