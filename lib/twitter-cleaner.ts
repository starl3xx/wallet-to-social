export function cleanTwitterHandle(handle: string | null | undefined): string | null {
  if (!handle) return null;

  let clean = handle.toLowerCase().trim();

  // Remove @ prefix
  clean = clean.replace(/^@/, '');

  // Remove Twitter/X URLs
  clean = clean.replace(/https?:\/\/(twitter|x)\.com\//, '');

  // Remove any trailing path or query params
  clean = clean.split('/')[0].split('?')[0];

  // Remove invalid characters
  clean = clean.replace(/[^a-z0-9_]/g, '');

  // Validate length (Twitter handles are 1-15 characters)
  if (clean.length < 1 || clean.length > 15) return null;

  return clean;
}

export function formatTwitterUrl(handle: string | null): string | null {
  if (!handle) return null;
  const cleaned = cleanTwitterHandle(handle);
  if (!cleaned) return null;
  return `https://x.com/${cleaned}`;
}
