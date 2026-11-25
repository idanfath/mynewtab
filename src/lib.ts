const ALIAS_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

function hasControlChars(value: string): boolean {
    for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        if (code <= 0x1f || code === 0x7f) return true;
    }
    return false;
}

export function isLocalOrPrivateHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    if (
        host === 'localhost'
        || host.endsWith('.localhost')
        || host.endsWith('.local')
        || host.endsWith('.internal')
        || host.endsWith('.lan')
        || host === '0.0.0.0'
        || host === '[::1]'
        || host === '[::]'
    ) {
        return true;
    }
    if (/^\[(?:fe80:|f[cd][0-9a-f]{2}:)/i.test(host)) {
        return true;
    }
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ipv4) return false;
    const [a, b, c, d] = ipv4.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return false;
    return (
        a === 127
        || a === 10
        || (a === 192 && b === 168)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 169 && b === 254)
    );
}

export function isPublicSearchableHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    if (!host || isLocalOrPrivateHost(host)) return false;
    if (host.startsWith('[')) return false;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
    const labels = host.split('.');
    if (labels.length < 2) return false;
    return !/^\d+$/.test(labels[labels.length - 1]);
}

export function isBareHostWithPort(value: string): boolean {
    const match = value.match(
        /^(\[[0-9a-f:]+\]|localhost\.?|[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?):(\d{1,5})(?:[/?#]|$)/i,
    );
    if (!match) return false;
    const port = Number(match[2]);
    return port >= 1 && port <= 65535;
}

function isValidParsedHttpUrl(parsed: URL): boolean {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname;
    if (
        !host
        || host === '.'
        || host === '..'
        || host.startsWith('.')
        || host.endsWith('..')
        || host.includes('..')
    ) {
        return false;
    }
    if (parsed.port === '0') return false;
    return true;
}

export function normalizeUrl(url: string): string {
    const value = url.trim();
    if (!value || hasControlChars(value) || /^[/\\?#]/.test(value)) return '';

    try {
        const httpMatch = value.match(/^https?:\/\/([\s\S]*)$/i);
        let parsed: URL;

        if (httpMatch) {
            const afterSlashes = httpMatch[1];
            if (!afterSlashes || /^[/\\?#]/.test(afterSlashes)) return '';
            if (afterSlashes.split(/[/?#]/, 1)[0].includes('\\')) return '';
            parsed = new URL(value);
        } else {
            if (/^[a-z][a-z\d+.-]*:/i.test(value) && !isBareHostWithPort(value)) {
                return '';
            }
            if (value.split(/[/?#]/, 1)[0].includes('\\')) return '';
            const probeHttp = new URL(`http://${value}`);
            parsed = isLocalOrPrivateHost(probeHttp.hostname)
                ? probeHttp
                : new URL(`https://${value}`);
        }

        return isValidParsedHttpUrl(parsed) ? parsed.href : '';
    } catch {
        return '';
    }
}

export function safeHostname(url: string): string {
    const normalized = normalizeUrl(url);
    if (!normalized) return '';
    try {
        return new URL(normalized).hostname;
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
    const host = safeHostname(url).replace(/\.$/, '');
    if (!host || !isPublicSearchableHost(host)) return '';
    return `https://www.google.com/s2/favicons?domain=${host}&sz=${size}`;
}

export function normalizeAlias(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const withoutBang = trimmed.startsWith('!') ? trimmed.slice(1) : trimmed;
    const candidate = withoutBang.toLowerCase();
    return ALIAS_PATTERN.test(candidate) ? candidate : '';
}

export function normalizeSearchUrl(template: string): string {
    const value = template.trim();
    if (
        !value
        || hasControlChars(value)
        || !value.includes('%s')
        || /^[/\\?#]/.test(value)
    ) {
        return '';
    }

    try {
        const httpMatch = value.match(/^https?:\/\/([\s\S]*)$/i);
        if (httpMatch) {
            const afterSlashes = httpMatch[1];
            if (!afterSlashes || /^[/\\?#]/.test(afterSlashes)) return '';
            if (afterSlashes.split(/[/?#]/, 1)[0].includes('\\')) return '';
        } else {
            if (/^[a-z][a-z\d+.-]*:/i.test(value) && !isBareHostWithPort(value)) {
                return '';
            }
            if (value.split(/[/?#]/, 1)[0].includes('\\')) return '';
        }

        // Check sentinel against both raw input and percent-decoded WHATWG href
        const dummyReplaced = value.replaceAll('%s', '0');
        const dummyHrefLower = new URL(
            httpMatch ? dummyReplaced : `http://${dummyReplaced}`,
        ).href.toLowerCase();
        const lowerValue = value.toLowerCase();

        let sentinel = 'omnibarsentinel';
        while (lowerValue.includes(sentinel) || dummyHrefLower.includes(sentinel)) {
            sentinel += '0';
        }

        const withSentinel = value.replaceAll('%s', sentinel);
        let probe: URL;
        if (httpMatch) {
            probe = new URL(withSentinel);
        } else {
            const probeHttp = new URL(`http://${withSentinel}`);
            if (probeHttp.hostname.includes(sentinel)) return '';
            probe = isLocalOrPrivateHost(probeHttp.hostname)
                ? probeHttp
                : new URL(`https://${withSentinel}`);
        }

        if (!isValidParsedHttpUrl(probe)) return '';
        if (
            probe.username.includes(sentinel)
            || probe.password.includes(sentinel)
            || probe.hostname.includes(sentinel)
            || probe.port.includes(sentinel)
        ) {
            return '';
        }

        const result = probe.href.replaceAll(sentinel, '%s');
        return result.includes('%s') ? result : '';
    } catch {
        return '';
    }
}

export function encodeSearchQuery(rawQuery: string): string {
    // ES2022-safe lone-surrogate replacement (avoids ES2024 String.prototype.toWellFormed)
    let wellFormed = '';
    for (const ch of rawQuery) {
        const code = ch.codePointAt(0)!;
        wellFormed += code >= 0xd800 && code <= 0xdfff ? '\uFFFD' : ch;
    }
    const encoded = encodeURIComponent(wellFormed);
    return encoded === '.' || encoded === '..'
        ? encoded.replaceAll('.', '%2E')
        : encoded;
}

export function buildSearchUrl(template: string, rawQuery: string): string {
    const normalized = normalizeSearchUrl(template);
    if (!normalized) return '';
    const encoded = encodeSearchQuery(rawQuery);
    const substituted = normalized.replaceAll('%s', () => encoded);
    try {
        return isValidParsedHttpUrl(new URL(substituted)) ? substituted : '';
    } catch {
        return '';
    }
}
