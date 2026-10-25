const NAME='privacy-frames-host-v1';
export async function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open(NAME,2);r.onupgradeneeded=()=>{if(r.result.objectStoreNames.contains('apps'))r.result.deleteObjectStore('apps');r.result.createObjectStore('apps',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function store(mode,action){const db=await database();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('apps',mode);const r=action(tx.objectStore('apps'));let value;r.onsuccess=()=>{value=r.result};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Transaction aborted'));});}finally{db.close();}}
export const getApp=id=>store('readonly',s=>s.get(id));
export const listApps=()=>store('readonly',s=>s.getAll());
export const putApp=app=>store('readwrite',s=>s.put(app));
export const deleteApp=id=>store('readwrite',s=>s.delete(id));
