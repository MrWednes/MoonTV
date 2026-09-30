/* eslint-disable no-console */

export interface OfflineCacheItem {
  key: string;
  title: string;
  episodeIndex: number;
  episodeLabel: string;
  source: string;
  contentId: string;
  cover?: string;
  sourceUrl: string;
  episodeUrl?: string;
  size: number;
  status: 'downloading' | 'ready' | 'error';
  progress: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

interface OfflineResource {
  key: string;
  itemKey: string;
  index: number;
  uri: string;
  blob: Blob;
}

interface OfflineResourceMap {
  [index: number]: string;
}

const DB_NAME = 'MoonTVOfflineCache';
const DB_VERSION = 1;
const ITEM_STORE = 'items';
const RESOURCE_STORE = 'resources';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ITEM_STORE)) {
        db.createObjectStore(ITEM_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(RESOURCE_STORE)) {
        const store = db.createObjectStore(RESOURCE_STORE, { keyPath: 'key' });
        store.createIndex('itemKey', 'itemKey', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

async function putItem(item: OfflineCacheItem) {
  const db = await openDb();
  const tx = db.transaction(ITEM_STORE, 'readwrite');
  tx.objectStore(ITEM_STORE).put(item);
  await txDone(tx);
  db.close();
}

async function putResource(resource: OfflineResource) {
  const db = await openDb();
  const tx = db.transaction(RESOURCE_STORE, 'readwrite');
  tx.objectStore(RESOURCE_STORE).put(resource);
  await txDone(tx);
  db.close();
}

export async function getOfflineItems(): Promise<OfflineCacheItem[]> {
  const db = await openDb();
  const tx = db.transaction(ITEM_STORE, 'readonly');
  const result = await requestToPromise(
    tx.objectStore(ITEM_STORE).getAll()
  );
  await txDone(tx);
  db.close();
  return (result as OfflineCacheItem[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getOfflineItem(
  key: string
): Promise<OfflineCacheItem | undefined> {
  const db = await openDb();
  const tx = db.transaction(ITEM_STORE, 'readonly');
  const result = await requestToPromise(tx.objectStore(ITEM_STORE).get(key));
  await txDone(tx);
  db.close();
  return result as OfflineCacheItem | undefined;
}

async function getResources(itemKey: string): Promise<OfflineResource[]> {
  const db = await openDb();
  const tx = db.transaction(RESOURCE_STORE, 'readonly');
  const index = tx.objectStore(RESOURCE_STORE).index('itemKey');
  const result = await requestToPromise(index.getAll(itemKey));
  await txDone(tx);
  db.close();
  return (result as OfflineResource[]).sort((a, b) => a.index - b.index);
}

export async function deleteOfflineItem(key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([ITEM_STORE, RESOURCE_STORE], 'readwrite');
  tx.objectStore(ITEM_STORE).delete(key);
  const index = tx.objectStore(RESOURCE_STORE).index('itemKey');
  const resources = await requestToPromise(index.getAll(key)) as OfflineResource[];
  resources.forEach((resource) => tx.objectStore(RESOURCE_STORE).delete(resource.key));
  await txDone(tx);
  db.close();
}

export async function clearOfflineItems(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([ITEM_STORE, RESOURCE_STORE], 'readwrite');
  tx.objectStore(ITEM_STORE).clear();
  tx.objectStore(RESOURCE_STORE).clear();
  await txDone(tx);
  db.close();
}

function absoluteUrl(uri: string, baseUrl: string): string {
  return new URL(uri, baseUrl).href;
}

function parseAttribute(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`${name}="([^"]+)"`));
  return match?.[1] || null;
}

function isPlaylistUrl(url: string): boolean {
  const clean = url.split('#')[0].split('?')[0].toLowerCase();
  return clean.endsWith('.m3u8') || clean.includes('m3u8');
}

async function fetchText(url: string): Promise<{ text: string; url: string }> {
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`下载播放列表失败 HTTP ${response.status}`);
  }
  return { text: await response.text(), url: response.url || url };
}

async function selectMediaPlaylist(
  text: string,
  baseUrl: string
): Promise<{ text: string; url: string }> {
  const lines = text.split(/\r?\n/);
  const variants: Array<{ bandwidth: number; url: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
      const bandwidth = Number(
        lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || 0
      );
      const uri = lines[i + 1]?.trim();
      if (uri && !uri.startsWith('#')) {
        variants.push({ bandwidth, url: absoluteUrl(uri, baseUrl) });
      }
    }
  }

  if (!variants.length) return { text, url: baseUrl };

  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return fetchText(variants[0].url);
}

interface DownloadContext {
  itemKey: string;
  resources: OfflineResourceMap;
  nextIndex: number;
  size: number;
}

async function downloadResource(
  uri: string,
  ctx: DownloadContext,
  onProgress: (ctx: DownloadContext) => void
): Promise<string> {
  const response = await fetch(uri, {
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`下载媒体分片失败 HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const index = ctx.nextIndex++;
  const resourceKey = `${ctx.itemKey}:${index}`;
  await putResource({
    key: resourceKey,
    itemKey: ctx.itemKey,
    index,
    uri,
    blob,
  });
  ctx.resources[index] = resourceKey;
  ctx.size += blob.size;
  onProgress(ctx);
  return `offline-resource://${index}`;
}

function rewritePlaylist(
  text: string,
  baseUrl: string,
  ctx: DownloadContext,
  onProgress: (ctx: DownloadContext) => void
): Promise<string> {
  const lines = text.split(/\r?\n/);

  const run = async () => {
    const output: string[] = [];
    for (const line of lines) {
      if (!line.trim()) {
        output.push(line);
        continue;
      }

      // HLS 加密 key
      if (line.startsWith('#EXT-X-KEY:')) {
        const uri = parseAttribute(line, 'URI');
        if (uri) {
          const localUri = await downloadResource(
            absoluteUrl(uri, baseUrl),
            ctx,
            onProgress
          );
          output.push(line.replace(`URI="${uri}"`, `URI="${localUri}"`));
        } else {
          output.push(line);
        }
        continue;
      }

      // 初始化片段
      if (line.startsWith('#EXT-X-MAP:')) {
        const uri = parseAttribute(line, 'URI');
        if (uri) {
          const localUri = await downloadResource(
            absoluteUrl(uri, baseUrl),
            ctx,
            onProgress
          );
          output.push(line.replace(`URI="${uri}"`, `URI="${localUri}"`));
        } else {
          output.push(line);
        }
        continue;
      }

      // 非注释行就是媒体分片 URI
      if (!line.startsWith('#')) {
        const localUri = await downloadResource(
          absoluteUrl(line.trim(), baseUrl),
          ctx,
          onProgress
        );
        output.push(localUri);
      } else {
        output.push(line);
      }
    }
    return output.join('\n');
  };

  return run();
}

export interface CacheDownloadOptions {
  key: string;
  title: string;
  episodeIndex: number;
  source: string;
  contentId: string;
  episodeUrl: string;
  cover?: string;
  onProgress?: (item: OfflineCacheItem) => void;
}

export async function downloadOfflineEpisode(
  options: CacheDownloadOptions
): Promise<OfflineCacheItem> {
  const existing = await getOfflineItem(options.key);
  const now = Date.now();

  let item: OfflineCacheItem = {
    key: options.key,
    title: options.title,
    episodeIndex: options.episodeIndex,
    episodeLabel: `第 ${options.episodeIndex + 1} 集`,
    source: options.source,
    contentId: options.contentId,
    cover: options.cover,
    sourceUrl: options.episodeUrl,
    episodeUrl: options.episodeUrl,
    size: 0,
    status: 'downloading',
    progress: 0,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await deleteOfflineItem(options.key).catch(() => undefined);
  await putItem(item);

  const notify = (next: OfflineCacheItem) => {
    item = { ...next, updatedAt: Date.now() };
    options.onProgress?.(item);
    void putItem(item);
  };

  try {
    const master = await fetchText(options.episodeUrl);
    const media = await selectMediaPlaylist(master.text, master.url);

    if (!media.text.includes('#EXT-X-ENDLIST')) {
      throw new Error('当前播放源是直播/动态 HLS，暂不支持离线缓存');
    }

    const totalSegments = media.text
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.startsWith('#')).length;

    if (!totalSegments) {
      throw new Error('播放列表中没有可下载的媒体分片');
    }

    const ctx: DownloadContext = {
      itemKey: options.key,
      resources: {},
      nextIndex: 0,
      size: 0,
    };

    const playlist = await rewritePlaylist(
      media.text,
      media.url,
      ctx,
      (state) => {
        const completed = state.nextIndex;
        notify({
          ...item,
          size: state.size,
          progress: Math.min(99, Math.round((completed / totalSegments) * 100)),
          status: 'downloading',
        });
      }
    );

    const playlistBlob = new Blob([playlist], {
      type: 'application/vnd.apple.mpegurl',
    });
    const playlistIndex = ctx.nextIndex++;
    await putResource({
      key: `${options.key}:${playlistIndex}`,
      itemKey: options.key,
      index: playlistIndex,
      uri: media.url,
      blob: playlistBlob,
    });

    item = {
      ...item,
      size: ctx.size + playlistBlob.size,
      progress: 100,
      status: 'ready',
      updatedAt: Date.now(),
    };

    // 记录 playlist resource index，供 createOfflineUrl 使用。
    await putItem({
      ...item,
      sourceUrl: `offline-resource://${playlistIndex}`,
      episodeUrl: options.episodeUrl,
    });

    options.onProgress?.(item);
    return item;
  } catch (error) {
    item = {
      ...item,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      updatedAt: Date.now(),
    };
    await putItem(item);
    options.onProgress?.(item);
    throw error;
  }
}

export async function createOfflineUrl(
  itemKey: string
): Promise<{ url: string; revoke: () => void } | null> {
  const item = await getOfflineItem(itemKey);
  if (!item || item.status !== 'ready') return null;

  const resources = await getResources(itemKey);
  const match = item.sourceUrl.match(/^offline-resource:\/\/(\d+)$/);
  if (!match) return null;

  const playlistIndex = Number(match[1]);
  const playlist = resources.find((resource) => resource.index === playlistIndex);
  if (!playlist) return null;

  const resourceUrls = new Map<number, string>();
  const urls: string[] = [];

  for (const resource of resources) {
    if (resource.index === playlistIndex) continue;
    const url = URL.createObjectURL(resource.blob);
    resourceUrls.set(resource.index, url);
    urls.push(url);
  }

  let playlistText = await playlist.blob.text();
  for (const [index, url] of resourceUrls) {
    playlistText = playlistText.replaceAll(
      `offline-resource://${index}`,
      url
    );
  }

  const playlistUrl = URL.createObjectURL(
    new Blob([playlistText], { type: 'application/vnd.apple.mpegurl' })
  );
  urls.push(playlistUrl);

  return {
    url: playlistUrl,
    revoke: () => urls.forEach((url) => URL.revokeObjectURL(url)),
  };
}

export function makeOfflineCacheKey(
  source: string,
  contentId: string,
  episodeIndex: number
): string {
  return `${source}::${contentId}::${episodeIndex}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export async function isOfflineCacheReady(key: string): Promise<boolean> {
  const item = await getOfflineItem(key);
  return item?.status === 'ready';
}
