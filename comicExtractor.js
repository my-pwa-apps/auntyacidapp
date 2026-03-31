/**
 * ArcaMax Comic Extractor for Aunty Acid
 * Fetches comic strips from arcamax.com using CORS proxy fallback.
 */

const CORS_PROXIES = [
    'https://corsproxy.garfieldapp.workers.dev/?',
    'https://api.codetabs.com/v1/proxy?quest=',
    'https://api.allorigins.win/raw?url='
];

const FETCH_TIMEOUT = 15000;

let workingProxyIndex = 0;
const proxyFailureCount = new Array(CORS_PROXIES.length).fill(0);
const proxyResponseTimes = new Array(CORS_PROXIES.length).fill(0);

function getBestProxyIndex() {
    let bestIndex = workingProxyIndex;
    let bestScore = -Infinity;

    for (let i = 0; i < CORS_PROXIES.length; i++) {
        const failurePenalty = proxyFailureCount[i] * 2000;
        const avgTime = proxyResponseTimes[i] || 1500;
        const score = 10000 / (avgTime + failurePenalty + 1);

        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }

    return bestIndex;
}

function updateProxyStats(proxyIndex, success, responseTime) {
    if (!success) {
        proxyFailureCount[proxyIndex]++;
    } else {
        const currentAvg = proxyResponseTimes[proxyIndex] || responseTime;
        proxyResponseTimes[proxyIndex] = (currentAvg + responseTime) / 2;
        workingProxyIndex = proxyIndex;
        proxyFailureCount[proxyIndex] = Math.max(0, proxyFailureCount[proxyIndex] - 1);
    }
}

async function tryProxy(url, proxyIndex, startTime) {
    const proxyUrl = CORS_PROXIES[proxyIndex];

    try {
        const fullUrl = `${proxyUrl}${encodeURIComponent(url)}`;
        const response = await fetch(fullUrl, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT),
            mode: 'cors',
            credentials: 'omit',
            cache: 'no-cache'
        });

        if (!response.ok) {
            updateProxyStats(proxyIndex, false, 0);
            throw new Error(`HTTP ${response.status}`);
        }

        const responseTime = Date.now() - startTime;
        updateProxyStats(proxyIndex, true, responseTime);

        return await response.text();
    } catch (error) {
        updateProxyStats(proxyIndex, false, 0);
        throw error;
    }
}

async function fetchWithProxyFallback(url) {
    const startTime = Date.now();
    const bestProxy = getBestProxyIndex();

    try {
        return await tryProxy(url, bestProxy, startTime);
    } catch (firstError) {
        const otherProxies = CORS_PROXIES.map((_, i) => i).filter(i => i !== bestProxy);
        const promises = otherProxies.map(i => tryProxy(url, i, Date.now()));

        try {
            return await Promise.any(promises);
        } catch (allError) {
            throw new Error('All proxies failed');
        }
    }
}

/**
 * Fetches an Aunty Acid comic from ArcaMax.
 *
 * @param {string} articleIdOrLatest - article ID "s-XXXXXXX" or "latest"
 * @returns {Promise<{success: boolean, imageUrl: string|null,
 *                    articleId: string|null, prevArticleId: string|null,
 *                    nextArticleId: string|null, stripDate: Date|null}>}
 */
export async function getAuthenticatedComic(articleIdOrLatest = 'latest') {
    const normalizedTarget = normalizeArticleTarget(articleIdOrLatest);
    if (!normalizedTarget) {
        return { success: false, imageUrl: null, articleId: null, prevArticleId: null, nextArticleId: null, stripDate: null };
    }

    const isLatest = normalizedTarget === 'latest';
    const url = isLatest
        ? 'https://www.arcamax.com/thefunnies/auntyacid/'
        : `https://www.arcamax.com/thefunnies/auntyacid/${normalizedTarget}`;

    try {
        const html = await fetchWithProxyFallback(url);

        if (html.includes('404: Page Not Found') || html.includes('Page Not Found')) {
            return { success: false, imageUrl: null, articleId: null, prevArticleId: null, nextArticleId: null, stripDate: null };
        }

        if (!isLikelyArcaMaxComicPage(html)) {
            console.warn(`Unexpected ArcaMax response (HTML length: ${html.length})`);
            return { success: false, imageUrl: null, articleId: null, prevArticleId: null, nextArticleId: null, stripDate: null };
        }

        const imageUrl = extractImageFromHTML(html);
        if (!imageUrl) {
            console.warn(`No image extracted from ArcaMax (HTML length: ${html.length})`);
            return { success: false, imageUrl: null, articleId: null, prevArticleId: null, nextArticleId: null, stripDate: null };
        }

        const articleId = extractArticleId(html, isLatest ? null : normalizedTarget);
        const { prevArticleId, nextArticleId } = extractNavIds(html);
        const stripDate = extractStripDate(html);

        return { success: true, imageUrl, articleId, prevArticleId, nextArticleId, stripDate };
    } catch (error) {
        console.error('Comic fetch failed:', error);
        return { success: false, imageUrl: null, articleId: null, prevArticleId: null, nextArticleId: null, stripDate: null };
    }
}

function normalizeArticleTarget(articleIdOrLatest) {
    if (articleIdOrLatest === 'latest') return 'latest';
    if (typeof articleIdOrLatest !== 'string') return null;

    const trimmed = articleIdOrLatest.trim().toLowerCase();
    if (trimmed === 'latest') return 'latest';

    return /^s-\d+$/.test(trimmed) ? trimmed : null;
}

function isLikelyArcaMaxComicPage(html) {
    return html.includes('resources.arcamax.com/newspics') ||
        html.includes('Aunty Acid for') ||
        html.includes('/thefunnies/auntyacid/');
}

function extractImageFromHTML(html) {
    let match = html.match(/https:\/\/resources\.arcamax\.com\/newspics\/[^"'\s<>]+/i);
    if (match) return match[0];

    match = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);
    if (match && match[1] && match[1].includes('resources.arcamax.com/newspics')) {
        return match[1];
    }

    match = html.match(/(?:data-src|src)="(https:\/\/resources\.arcamax\.com\/newspics\/[^"\s<>]+)"/i);
    if (match) return match[1];

    return null;
}

function extractArticleId(html, knownId) {
    if (knownId) return knownId;
    const encodedMatch = html.match(/auntyacid%2F(s-\d+)/i);
    if (encodedMatch) return encodedMatch[1];
    const match = html.match(/\/thefunnies\/auntyacid\/(s-\d+)/);
    return match ? match[1] : null;
}

function extractNavIds(html) {
    const anchorTags = [...html.matchAll(/<a\b[^>]*href="(?:https?:\/\/[^/"]*)?\/thefunnies\/auntyacid\/(s-\d+)"[^>]*>/gi)];
    let prevArticleId = null;
    let nextArticleId = null;

    for (const match of anchorTags) {
        const anchorTag = match[0];
        const articleId = match[1];
        const classMatch = anchorTag.match(/class="([^"]+)"/i);
        const classNames = classMatch ? classMatch[1].split(/\s+/) : [];

        if (classNames.includes('prev') && !prevArticleId) {
            prevArticleId = articleId;
        }

        if (classNames.includes('next') && !nextArticleId) {
            nextArticleId = articleId;
        }
    }

    return { prevArticleId, nextArticleId };
}

function extractStripDate(html) {
    let match = html.match(/h=Aunty\+Acid\+for\+([^"&]+)/);
    if (match) {
        const d = new Date(decodeURIComponent(match[1].replace(/\+/g, ' ')));
        if (!isNaN(d)) return d;
    }
    match = html.match(/alt="Aunty\s+Acid\s+for\s+(\d{1,2}\/\d{1,2}\/\d{4})"/i);
    if (match) {
        const d = new Date(match[1]);
        if (!isNaN(d)) return d;
    }
    return null;
}
