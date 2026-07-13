const DB_NAME = 'free-ocr-grader';
const DB_VERSION = 1;
const STORES = ['tests', 'templates', 'results', 'drafts', 'verificationSets'];

export async function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(new Error('ブラウザ内の保存領域を開けませんでした。'));
    request.onupgradeneeded = () => {
      const db = request.result;
      STORES.forEach(store => {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function getAll(storeName) {
  const db = await openDb();
  return transaction(db, storeName, 'readonly', store => requestToPromise(store.getAll()));
}

export async function getItem(storeName, id) {
  const db = await openDb();
  return transaction(db, storeName, 'readonly', store => requestToPromise(store.get(id)));
}

export async function putItem(storeName, value) {
  const db = await openDb();
  return transaction(db, storeName, 'readwrite', store => requestToPromise(store.put(value)));
}

export async function deleteItem(storeName, id) {
  const db = await openDb();
  return transaction(db, storeName, 'readwrite', store => requestToPromise(store.delete(id)));
}

export async function exportAllData() {
  const data = {};
  for (const store of STORES) {
    data[store] = await getAll(store);
  }
  return {
    app: 'free-ocr-grader',
    exportedAt: new Date().toISOString(),
    data
  };
}

export async function importAllData(backup) {
  if (!backup || backup.app !== 'free-ocr-grader' || !backup.data) {
    throw new Error('このアプリのバックアップJSONではありません。');
  }

  for (const store of STORES) {
    const items = backup.data[store] || [];
    for (const item of items) {
      await putItem(store, item);
    }
  }
}

export function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function transaction(db, storeName, mode, callback) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    tx.onerror = () => reject(tx.error || new Error('保存処理でエラーが発生しました。'));
    tx.oncomplete = () => resolve(result);
    Promise.resolve(callback(store)).then(value => {
      result = value;
    }).catch(reject);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
