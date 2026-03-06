const ICON_DATA_URI_PATTERN = /^data:image\/(svg\+xml|png);base64,([A-Za-z0-9+/=]+)$/i;
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const RESERVED_CATEGORY_KEY = '__none__';
export const MAX_ICON_BYTES = 8 * 1024;

export function slugifyCategoryName(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'category';
}

export function assertValidColor(color?: string): void {
  if (!color) return;
  if (!HEX_COLOR_PATTERN.test(color)) {
    throw new Error('color must be a valid #RRGGBB hex value');
  }
}

export function assertValidIconDataUri(iconDataUri?: string): void {
  if (!iconDataUri) return;

  const match = iconDataUri.match(ICON_DATA_URI_PATTERN);
  if (!match) {
    throw new Error('iconDataUri must be a base64 data URI for image/svg+xml or image/png');
  }

  const base64Payload = match[2]!;
  let bytes: number;
  try {
    bytes = Buffer.from(base64Payload, 'base64').byteLength;
  } catch {
    throw new Error('iconDataUri contains invalid base64 payload');
  }

  if (bytes > MAX_ICON_BYTES) {
    throw new Error(`iconDataUri exceeds max decoded size ${MAX_ICON_BYTES} bytes`);
  }
}
