export function normalizeUrl(url: string): string {
    const value = url.trim();
    if (!value) return '';

    try {
        const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
        if (hasScheme && !/^https?:\/\//i.test(value)) return '';

        const candidate = hasScheme ? value : `https://${value}`;
        const parsed = new URL(candidate);

        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
            ? parsed.href
            : '';
    } catch {
        return '';
    }
}

// Identity key for duplicate detection: lowercase host, strip default
// ports, drop trailing slash (except root), sort query. Fragment stays:
// hash-routed pages and doc anchors are different destinations.
export function urlIdentity(url: string): string {
    const normalized = normalizeUrl(url);
    if (!normalized) return '';

    try {
        const parsed = new URL(normalized);
        const host = parsed.hostname.toLowerCase();
        const isDefaultPort = (parsed.protocol === 'http:' && parsed.port === '80')
            || (parsed.protocol === 'https:' && parsed.port === '443');
        const port = !parsed.port || isDefaultPort ? '' : `:${parsed.port}`;
        const path = parsed.pathname.replace(/\/+$/, '') || '/';
        const params = new URLSearchParams(parsed.search);
        params.sort();
        const query = [...params].length ? `?${params}` : '';

        return `${parsed.protocol}//${host}${port}${path}${query}${parsed.hash}`;
    } catch {
        return normalized;
    }
}

export function getFaviconUrl(url: string, size = 64): string {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) return '';

    return `https://www.google.com/s2/favicons?domain=${new URL(normalizedUrl).hostname}&sz=${size}`;
}
