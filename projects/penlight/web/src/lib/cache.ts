/** 节拍识别结果按文件指纹缓存在 IndexedDB 里，同一首歌再打开不用重新分析。 */
const DB = 'penlight';
const STORE = 'analysis';

/** 分析流程有变化时加一，旧的缓存就不再使用。 */
export const CACHE_VERSION = 2;

export interface CachedAnalysis {
  version: number;
  ticks: number[];
  /** 前 90 秒的拍点。整首分析完之后也留着，用来对齐拍子级别。 */
  quickTicks?: number[];
  bpm: number;
  confidence: number;
  /** 是否已经分析过整首歌。 */
  full: boolean;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheGet(key: string): Promise<CachedAnalysis | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => {
        const r = req.result as CachedAnalysis | undefined;
        resolve(r && r.version === CACHE_VERSION ? r : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function cachePut(key: string, value: CachedAnalysis): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // 存不下也不影响使用，只是下次要重新分析
  }
}

/** 文件指纹。非 HTTPS 页面拿不到 crypto.subtle 时退回用文件名和大小。 */
export async function fingerprint(data: ArrayBuffer, name: string): Promise<string> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `${name}:${data.byteLength}`;
  }
}
