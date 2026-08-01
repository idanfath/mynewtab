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

export function getFaviconUrl(url: string, size = 64): string {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) return '';

    return `https://www.google.com/s2/favicons?domain=${new URL(normalizedUrl).hostname}&sz=${size}`;
}
