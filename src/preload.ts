/**
 * Fetches clips ahead of play and keeps them as in-memory blobs, so a scene
 * change never waits on the network. Progress is reported in bytes.
 */

const cache = new Map<string, string>();
const sizes = new Map<string, number>();

export interface PreloadProgress {
  /** 0..1 across all requested clips. */
  ratio: number;
  loadedBytes: number;
  totalBytes: number;
  done: number;
  count: number;
}

/** Object URL for a clip that has been preloaded, or the original URL if not. */
export function clipUrl(src: string): string {
  return cache.get(src) ?? src;
}

export function isPreloaded(src: string): boolean {
  return cache.has(src);
}

export async function preloadClips(
  urls: string[],
  onProgress: (p: PreloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const pending = [...new Set(urls)].filter((u) => !cache.has(u));
  const count = pending.length;
  if (count === 0) {
    onProgress({ ratio: 1, loadedBytes: 0, totalBytes: 0, done: 0, count: 0 });
    return;
  }

  const loaded = new Map<string, number>();
  let done = 0;

  const report = () => {
    let loadedBytes = 0;
    let totalBytes = 0;
    let known = 0;
    for (const u of pending) {
      loadedBytes += loaded.get(u) ?? 0;
      const size = sizes.get(u);
      if (size) {
        totalBytes += size;
        known++;
      }
    }
    // Until every size is known, weight by completed files so the bar never jumps back.
    const ratio =
      known === count && totalBytes > 0
        ? loadedBytes / totalBytes
        : (done + (count - done) * 0) / count;
    onProgress({ ratio: Math.min(1, ratio), loadedBytes, totalBytes, done, count });
  };

  await Promise.all(
    pending.map(async (url) => {
      const res = await fetch(url, { signal });
      if (!res.ok || !res.body) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length) sizes.set(url, length);

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        chunks.push(value);
        received += value.byteLength;
        loaded.set(url, received);
        report();
      }
      if (!length) sizes.set(url, received);
      const type = res.headers.get("content-type") ?? "video/mp4";
      const blob = new Blob(chunks as BlobPart[], { type });
      cache.set(url, URL.createObjectURL(blob));
      done++;
      report();
    }),
  );
}
