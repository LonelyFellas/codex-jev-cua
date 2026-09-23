/** Preserve whole lines and UTF-8 boundaries. Shared by host-independent native tools. */
export function truncateHead(text: string, options: { maxBytes: number; maxLines: number }) {
  const lines = text.split("\n");
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const size = Buffer.byteLength(line) + (kept.length ? 1 : 0);
    if (kept.length >= options.maxLines || bytes + size > options.maxBytes) break;
    kept.push(line); bytes += size;
  }
  return { content: kept.join("\n"), truncated: kept.length < lines.length };
}
