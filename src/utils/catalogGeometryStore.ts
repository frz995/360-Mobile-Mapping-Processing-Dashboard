/**
 * IndexedDB store for heavy catalog-layer geometry.
 *
 * localStorage can only hold ~5 MB and `JSON.stringify` of a 39 MB layer would
 * freeze the UI, so heavy layers are stripped out of the local cache. This store
 * gives those bytes a place that survives a page reload: IndexedDB has a much
 * larger quota, and string reads/writes never walk the object graph on the
 * main thread. A layer's `geojsonJson` is a single flat string, so storing
 * (and later rehydrating) it is cheap.
 *
 * The store is a plain key/value map:  `${userKey}::${layerId}` → geojson string.
 */

const DB_NAME = 'road-analysis-catalog';
const STORE_NAME = 'geometry';
const DB_VERSION = 1;

interface GeometryRecord {
  key: string;
  geojsonJson: string;
  updatedAt: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** Lazily open (and cache) the IndexedDB connection. Resolves null where
 *  IndexedDB is unavailable (tests redirect to jsdom, private browsing, etc.). */
function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') {
          resolve(null);
          return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

const storeKey = (userKey: string, layerId: string): string => `${userKey}::${layerId}`;

/** Layer ids whose bytes we already wrote for this user (identity dedupe).
 *  The geojsonJson string reference is stable across style edits (the layer is
 *  spread, not re-parsed), so we skip re-writing unchanged bytes on every
 *  slider commit. */
const writtenLayerIds = new Map<string, Set<string>>();

function markWritten(userKey: string, layerId: string): void {
  let set = writtenLayerIds.get(userKey);
  if (!set) {
    set = new Set();
    writtenLayerIds.set(userKey, set);
  }
  set.add(layerId);
}

function isWritten(userKey: string, layerId: string): boolean {
  return writtenLayerIds.get(userKey)?.has(layerId) ?? false;
}

/**
 * Persist heavy layer geometry (serialized `geojsonJson`) into IndexedDB.
 * Fire-and-forget: callers do not await this (persistence must never block the
 * paint path). Layers whose geometry is absent (non-heavy or stripped) are
 * skipped; stale entries for layers that were removed are deleted.
 */
export async function saveCatalogLayerGeometries(
  userKey: string,
  layers: Array<{ id: string; geojsonJson?: string; geojson?: any }> | undefined
): Promise<void> {
  const list = Array.isArray(layers) ? layers : [];
  const seen = new Set<string>();
  const writes: GeometryRecord[] = [];
  const now = new Date().toISOString();

  for (const layer of list) {
    let geojsonJson = layer.geojsonJson;
    if (!geojsonJson && layer.geojson) {
      try {
        geojsonJson = JSON.stringify(layer.geojson);
      } catch {
        geojsonJson = undefined;
      }
    }
    if (!geojsonJson || typeof geojsonJson !== 'string' || geojsonJson.length === 0) continue;
    const key = storeKey(userKey, layer.id);
    seen.add(key);
    if (isWritten(userKey, layer.id)) continue;
    writes.push({ key, geojsonJson, updatedAt: now });
  }

  const db = await openDb();
  if (!db) return;

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const record of writes) {
        store.put(record);
      }
      // Clean up entries for layers that were removed since the last write.
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        if (cursor.key.toString().startsWith(`${userKey}::`) && !seen.has(cursor.key.toString())) {
          cursor.delete();
        }
        cursor.continue();
      };
      // Only mark bytes as persisted once the transaction actually commits, so a
      // failed write can be retried on the next persist instead of being skipped.
      tx.oncomplete = () => {
        for (const record of writes) {
          markWritten(userKey, record.key.split('::')[1]);
        }
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    // Non-fatal: geometry re-import or cloud restore still works without it.
    console.warn('[RoadAnalysis] IndexedDB geometry write skipped:', err);
  }
}

/**
 * Load heavy layer geometry back from IndexedDB after a reload, keyed by
 * layer id. Layers with no stored bytes simply aren't in the returned map.
 */
export async function loadCatalogLayerGeometries(
  userKey: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const db = await openDb();
  if (!db) return result;

  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve();
          return;
        }
        const keyStr = cursor.key.toString();
        if (keyStr.startsWith(`${userKey}::`)) {
          const record = cursor.value as GeometryRecord;
          result.set(keyStr.slice(`${userKey}::`.length), record.geojsonJson);
        }
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  } catch (err) {
    console.warn('[RoadAnalysis] IndexedDB geometry read skipped:', err);
  }
  return result;
}

/** Remove a specific layer's stored geometry (used when a layer is deleted). */
export async function deleteCatalogLayerGeometry(
  userKey: string,
  layerId: string
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(storeKey(userKey, layerId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    writtenLayerIds.get(userKey)?.delete(layerId);
  } catch {
    // ignore
  }
}