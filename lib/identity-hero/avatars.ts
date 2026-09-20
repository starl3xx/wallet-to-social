import sharp from 'sharp';
import { isConfigured, resolverHeaders, resolverUrl } from '@/lib/x-resolver';

/** Pin the numeric X id so a recycled handle cannot substitute another face. */
export async function refreshPortrait(
  handle: string,
  userId: string,
  fallback: string | null
): Promise<string | null> {
  if (!isConfigured()) return fallback;
  try {
    const response = await fetch(
      resolverUrl(`/twitter/user/info?userName=${encodeURIComponent(handle)}`),
      {
        headers: resolverHeaders(),
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
        cache: 'no-store',
      }
    );
    if (!response.ok) return fallback;
    const { data } = await response.json();
    if (
      !data ||
      String(data.id) !== userId ||
      String(data.userName).toLowerCase() !== handle.toLowerCase()
    )
      return null;
    const url = new URL(data.profilePicture);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'pbs.twimg.com' ||
      url.port ||
      url.username ||
      url.password
    )
      return fallback;
    const image = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
      cache: 'no-store',
    });
    if (
      !image.ok ||
      !/^image\/(jpeg|png|webp)(;|$)/i.test(
        image.headers.get('content-type') || ''
      )
    )
      return fallback;
    const reader = image.body?.getReader();
    if (!reader) return fallback;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) {
          await reader.cancel();
          return fallback;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = await sharp(Buffer.concat(chunks), {
      limitInputPixels: 20_000_000,
    })
      .rotate()
      .resize(160, 160, { fit: 'cover' })
      .webp({ quality: 78 })
      .toBuffer();
    if (bytes.length > 30000) return fallback;
    return `data:image/webp;base64,${bytes.toString('base64')}`;
  } catch {
    return fallback;
  }
}
