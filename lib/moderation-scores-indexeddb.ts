/**
 * 5指標（1行目・2行目）のクライアント永続化。localStorage に加え IndexedDB にも保存し、
 * 容量・ブラウザ再起動後の欠損に強くする。DB スキーマは変更しない。
 */
import type { DevScoresById } from "@/lib/dev-scores-local-storage";
import { parseRawToDevScores } from "@/lib/dev-scores-local-storage";

const DB_NAME = "heiwa_sns_moderation_dev_scores_v1";
const STORE = "kv";
const KEY_POSTS = "post_dev_scores";
const KEY_REPLIES = "reply_dev_scores";

function isBrowser(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

async function idbGet(key: string): Promise<DevScoresById> {
  if (!isBrowser()) return {};
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(key);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const raw = r.result;
        if (raw == null) {
          resolve({});
          return;
        }
        if (typeof raw === "string") {
          resolve(parseRawToDevScores(raw));
          return;
        }
        if (typeof raw === "object") {
          resolve(raw as DevScoresById);
          return;
        }
        resolve({});
      };
    });
  } catch {
    return {};
  }
}

async function idbSet(key: string, data: DevScoresById): Promise<void> {
  if (!isBrowser()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(data, key);
    });
  } catch {
    /* ignore */
  }
}

export function idbLoadPostDevScores(): Promise<DevScoresById> {
  return idbGet(KEY_POSTS);
}

export function idbLoadReplyDevScores(): Promise<DevScoresById> {
  return idbGet(KEY_REPLIES);
}

export function idbSavePostDevScores(data: DevScoresById): Promise<void> {
  return idbSet(KEY_POSTS, data);
}

export function idbSaveReplyDevScores(data: DevScoresById): Promise<void> {
  return idbSet(KEY_REPLIES, data);
}
