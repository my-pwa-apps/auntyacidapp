/**
 * Aunty Acid CORS Proxy Worker
 *
 * Dedicated proxy for the Aunty Acid PWA. Only the app's own origins may use it
 * and only the comic hosts in ALLOWED_HOSTS may be fetched.
 *
 * Usage: /?https://www.gocomics.com/aunty-acid/2024/01/05
 *        /?url=https%3A%2F%2Fwww.gocomics.com%2Faunty-acid%2F2024%2F01%2F05
 */

const DEFAULT_ALLOWED_HOSTS = [
    'gocomics.com',
    '*.gocomics.com',
    'assets.amuniversal.com',
    'www.arcamax.com',
    'resources.arcamax.com'
];

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_REDIRECTS = 5;

// GoComics' bot protection (Bunny Shield) rejects requests without typical
// browser headers, so fall back to these when the client didn't send them.
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const DEFAULT_ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

const STRIPPED_RESPONSE_HEADERS = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length',
    'set-cookie',
    // Upstream Link preload headers point at relative GoComics assets which the
    // browser would resolve against the wrong origin.
    'link',
    'content-security-policy',
    'content-security-policy-report-only',
    'access-control-allow-origin',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'access-control-allow-credentials',
    'access-control-expose-headers',
    'access-control-max-age',
]);

const GOCOMICS_HTML_CACHE_TTL = 300;
const IMAGE_CACHE_TTL = 86400;
const DEFAULT_CACHE_TTL = 3600;
// Short HTML responses are likely bot-challenge/error pages; never cache them.
const MIN_HTML_CACHE_BYTES = 10000;

export default {
    async fetch(request, env, ctx) {
        const allowedOrigin = resolveAllowedOrigin(request, env);
        if (allowedOrigin === false) {
            return jsonResponse({ error: 'Origin not allowed' }, 403);
        }

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: buildCorsHeaders(allowedOrigin) });
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return withCors(allowedOrigin, jsonResponse({ error: 'Method not allowed' }, 405));
        }

        const requestUrl = new URL(request.url);
        const targetUrl = extractTargetUrl(requestUrl);
        if (!targetUrl) {
            return withCors(allowedOrigin, new Response(
                'Usage: /?https://www.gocomics.com/aunty-acid/2024/01/05 or /?url=<encoded url>',
                { status: 400, headers: { 'content-type': 'text/plain; charset=UTF-8' } }
            ));
        }

        let upstreamUrl;
        try {
            upstreamUrl = new URL(targetUrl);
        } catch {
            return withCors(allowedOrigin, jsonResponse({ error: 'Invalid target URL' }, 400));
        }

        const allowedHosts = getAllowedHosts(env);
        if (!ALLOWED_PROTOCOLS.has(upstreamUrl.protocol)) {
            return withCors(allowedOrigin, jsonResponse({ error: 'Unsupported protocol' }, 400));
        }
        if (!isAllowedHost(upstreamUrl.hostname, allowedHosts)) {
            return withCors(allowedOrigin, jsonResponse({ error: 'Host not allowed' }, 403));
        }

        const cacheKey = new Request(upstreamUrl.toString(), { method: 'GET' });
        const cache = caches.default;
        const clientCacheControl = request.headers.get('cache-control') || '';
        const bypassCache = clientCacheControl.includes('no-cache') || clientCacheControl.includes('no-store');

        if (request.method === 'GET' && !bypassCache) {
            const cached = await cache.match(cacheKey);
            if (cached) return withCors(allowedOrigin, cached, true);
        }

        const upstreamRequest = new Request(upstreamUrl.toString(), {
            method: request.method,
            headers: buildUpstreamHeaders(request),
        });

        const cacheTtl = getCacheTtl(upstreamUrl);
        let upstreamResponse;
        try {
            upstreamResponse = await fetchAllowlistedFollowingRedirects(upstreamRequest, upstreamUrl, allowedHosts, {
                cacheEverything: request.method === 'GET',
                // Only cache successful responses so a transient bot-protection
                // 403 is never served to every user from the edge cache.
                cacheTtlByStatus: { '200-299': cacheTtl, '300-599': 0 },
            });
        } catch (error) {
            if (error instanceof DisallowedRedirectError) {
                return withCors(allowedOrigin, jsonResponse({ error: 'Redirect target not allowed' }, 403));
            }
            return withCors(allowedOrigin, jsonResponse({ error: 'Upstream fetch failed' }, 502));
        }

        let response = sanitizeUpstreamResponse(upstreamResponse, cacheTtl);

        if (request.method === 'GET' && upstreamResponse.ok) {
            const contentType = upstreamResponse.headers.get('content-type') || '';
            if (contentType.includes('text/html')) {
                // Buffer HTML so challenge/error pages (tiny bodies) are never cached.
                const body = await response.arrayBuffer();
                response = new Response(body, response);
                if (body.byteLength >= MIN_HTML_CACHE_BYTES) {
                    ctx.waitUntil(cache.put(cacheKey, response.clone()));
                }
            } else {
                ctx.waitUntil(cache.put(cacheKey, response.clone()));
            }
        }

        return withCors(allowedOrigin, response, false);
    },
};

class DisallowedRedirectError extends Error {}

/**
 * Follow redirects manually so every hop is re-validated against the host
 * allowlist; otherwise an open redirect upstream could turn this Worker into
 * a proxy for arbitrary destinations.
 */
async function fetchAllowlistedFollowingRedirects(initialRequest, initialUrl, allowedHosts, cfOptions) {
    let currentRequest = initialRequest;
    let currentUrl = initialUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const response = await fetch(currentRequest, { redirect: 'manual', cf: cfOptions });

        const location = response.headers.get('location');
        const isRedirect = response.status >= 300 && response.status < 400 && location;
        if (!isRedirect) return response;

        let nextUrl;
        try {
            nextUrl = new URL(location, currentUrl);
        } catch {
            throw new DisallowedRedirectError('Unparseable redirect target');
        }

        if (!ALLOWED_PROTOCOLS.has(nextUrl.protocol) || !isAllowedHost(nextUrl.hostname, allowedHosts)) {
            throw new DisallowedRedirectError(`Redirect to ${nextUrl.hostname} is not allowed`);
        }

        currentUrl = nextUrl;
        currentRequest = new Request(nextUrl.toString(), {
            method: currentRequest.method,
            headers: currentRequest.headers,
        });
    }

    throw new DisallowedRedirectError('Too many redirects');
}

function extractTargetUrl(requestUrl) {
    const explicitUrl = requestUrl.searchParams.get('url');
    if (explicitUrl && /^https?:/i.test(explicitUrl)) return explicitUrl;

    const rawQuery = requestUrl.search.startsWith('?') ? requestUrl.search.slice(1) : requestUrl.search;
    if (!rawQuery) return null;

    try { return decodeURIComponent(rawQuery); } catch { return rawQuery; }
}

function getAllowedHosts(env) {
    const rawHosts = typeof env?.ALLOWED_HOSTS === 'string' && env.ALLOWED_HOSTS.trim()
        ? env.ALLOWED_HOSTS
        : DEFAULT_ALLOWED_HOSTS.join(',');
    return rawHosts.split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
}

function isAllowedHost(hostname, allowedHosts) {
    const normalizedHost = hostname.toLowerCase();
    return allowedHosts.some(allowedHost => {
        if (allowedHost.startsWith('*.')) {
            const suffix = allowedHost.slice(1); // ".gocomics.com"
            return normalizedHost.endsWith(suffix) && normalizedHost !== suffix.slice(1);
        }
        return normalizedHost === allowedHost;
    });
}

function buildUpstreamHeaders(request) {
    const headers = new Headers();
    const userAgent = request.headers.get('user-agent') || '';
    headers.set('user-agent', userAgent.startsWith('Mozilla/') ? userAgent : DEFAULT_USER_AGENT);
    const accept = request.headers.get('accept');
    headers.set('accept', accept && accept !== '*/*' ? accept : DEFAULT_ACCEPT);
    headers.set('accept-language', request.headers.get('accept-language') || DEFAULT_ACCEPT_LANGUAGE);
    return headers;
}

function sanitizeUpstreamResponse(upstreamResponse, cacheTtl) {
    const headers = new Headers(upstreamResponse.headers);
    for (const header of STRIPPED_RESPONSE_HEADERS) headers.delete(header);
    headers.set('x-proxy-by', 'auntyacid-corsproxy');
    headers.set('cache-control', upstreamResponse.ok ? `public, max-age=${cacheTtl}` : 'no-store');
    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers,
    });
}

function getCacheTtl(targetUrl) {
    const pathname = targetUrl.pathname.toLowerCase();
    const hostname = targetUrl.hostname.toLowerCase();
    if (hostname === 'featureassets.gocomics.com' || hostname === 'assets.amuniversal.com') return IMAGE_CACHE_TTL;
    if (/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(pathname)) return IMAGE_CACHE_TTL;
    if (hostname.endsWith('gocomics.com')) return GOCOMICS_HTML_CACHE_TTL;
    return DEFAULT_CACHE_TTL;
}

/**
 * Returns the Access-Control-Allow-Origin value, or false when the origin is
 * not allowed. Requests without an Origin header (e.g. <img> tags, curl) are
 * allowed; the host allowlist still limits what can be fetched.
 */
function resolveAllowedOrigin(request, env) {
    const origin = request.headers.get('origin');
    if (!origin) return '*';

    let parsed;
    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }
    if (parsed.username || parsed.password) return false;

    const { protocol, hostname } = parsed;
    const extraOrigins = typeof env?.EXTRA_ALLOWED_ORIGINS === 'string'
        ? env.EXTRA_ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
        : [];

    if (extraOrigins.includes(parsed.origin)) return origin;
    if (protocol === 'https:' && hostname === 'my-pwa-apps.github.io') return origin;
    if (protocol === 'https:' && hostname === 'auntyacidapp.pages.dev') return origin;
    if (protocol === 'https:' && hostname.endsWith('.auntyacidapp.pages.dev')) return origin;
    if (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')) return origin;
    return false;
}

function withCors(allowedOrigin, response, cacheHit = false) {
    const headers = new Headers(response.headers);
    for (const [key, value] of buildCorsHeaders(allowedOrigin).entries()) {
        headers.set(key, value);
    }
    headers.set('x-proxy-cache', cacheHit ? 'HIT' : 'MISS');
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function buildCorsHeaders(allowedOrigin) {
    return new Headers({
        'access-control-allow-origin': allowedOrigin,
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': 'Content-Type, Accept, Accept-Language',
        'access-control-max-age': '86400',
        'vary': 'Origin',
    });
}

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}
