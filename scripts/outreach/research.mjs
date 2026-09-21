import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      ![0, 10, 127].includes(a) &&
      a < 224 &&
      !(a === 169 && b === 254) &&
      !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 192 && b === 168) &&
      !(a === 100 && b >= 64 && b <= 127)
    );
  }
  // Only global-unicast IPv6. Excludes loopback, mapped IPv4, local and multicast.
  return (
    isIP(address) === 6 &&
    /^[23]/.test(address) &&
    !address.toLowerCase().startsWith('2001:db8:')
  );
}

export async function researchSources(
  sources,
  { fetcher = fetch, resolver = lookup, now = Date.now() } = {}
) {
  if (!Array.isArray(sources) || sources.length > 20)
    throw new Error(
      'Research accepts at most 20 explicitly selected company sources'
    );
  const results = [];
  async function page(value) {
    const target = new URL(value);
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      target.port
    )
      throw new Error(
        'Research requires public HTTPS pages on the default port'
      );
    const addresses = await resolver(target.hostname, { all: true });
    if (
      !addresses.length ||
      addresses.some(({ address }) => !publicAddress(address))
    )
      throw new Error('Research refused a nonpublic address');
    const response = await fetcher(target.href, {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'text/html', 'User-Agent': 'WalletLinkResearch/1.0' },
    });
    if (
      !response.ok ||
      !(response.headers.get('content-type') || '').includes('text/html')
    )
      throw new Error('Research source is unavailable or is not HTML');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.length;
        if (size > 500_000) throw new Error('Research source exceeds 500 KB');
        chunks.push(chunk);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  for (const source of sources) {
    try {
      if (typeof source.company !== 'string' || !source.company.trim())
        throw new Error('Source needs a company name');
      const html = await page(source.sourceUrl);
      const contacts =
        source.contactSourceUrl === source.sourceUrl
          ? html
          : await page(source.contactSourceUrl);
      const publishedEmails = [
        ...new Set(
          [...contacts.matchAll(/href\s*=\s*["']mailto:([^"'?\s]+)/gi)]
            .map((match) => {
              try {
                return decodeURIComponent(match[1]).toLowerCase();
              } catch {
                return '';
              }
            })
            .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        ),
      ];
      const excerpt = html
        .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 5000);
      results.push({
        company: source.company,
        sourceUrl: source.sourceUrl,
        contactSourceUrl: source.contactSourceUrl,
        observedAt: new Date(now).toISOString(),
        publishedEmails,
        excerpt,
        status: 'needs-qualification',
      });
    } catch (error) {
      results.push({
        company: source.company,
        status: 'research-failed',
        error: error.message,
      });
    }
  }
  // Source text is evidence, never executable instructions or an automatic claim
  // about budget, intent, contact identity, or permission to send.
  return results;
}
