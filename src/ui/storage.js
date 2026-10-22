// Where a colony lives: this browser every half minute, the player's Claude account about once a minute, and a file on request.
// One colony at a time and no earlier copies, so what happened stays happened.
const KEY = 'colony-run', CHUNK = 200000;
export const Store = { db: null, uid: null, downloads: null, acctBusy: false, lastAcct: 0, lastLocal: 0, pending: null };

const use = name => (window.claude && window.claude.use) ? window.claude.use(name).catch(() => null) : Promise.resolve(null);
export async function initStorage() {
  const [db, user, dl] = await Promise.all([use('db'), use('user'), use('downloads')]);
  Store.downloads = dl;
  if (db && user) { try { const id = await user.id(); if (id) { Store.db = db; Store.uid = id; } } catch (e) { /* no private space this visit */ } }
}
const wrap = data => JSON.stringify({ savedAt: Date.now(), data });

/* ---------- this browser ---------- */
export function saveLocal(data) { try { localStorage.setItem(KEY, wrap(data)); Store.lastLocal = Date.now(); return true; } catch (e) { return false; } }
export function loadLocal() { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

/* ---------- the account: the viewer's private corner of the page's store, split under the per-document limit ---------- */
const ref = k => Store.db.collection('data/users/' + Store.uid).doc(k);
export async function loadAccount() {
  if (!Store.db) return null;
  try {
    const head = await ref('runhead').get(); if (!head.exists) return null; const h = head.data();
    let s = ''; for (let i = 0; i < h.n; i++) { const c = await ref('run' + i).get(); if (!c.exists) return null; s += c.data().s; }
    return { savedAt: h.savedAt, data: JSON.parse(s) };
  } catch (e) { return null; }
}
// writes at most one copy at a time; a newer one waiting replaces any older one waiting
export async function saveAccount(data) {
  if (!Store.db) return false;
  const s = JSON.stringify(data);
  if (Store.acctBusy) { Store.pending = data; return false; }
  Store.acctBusy = true;
  try {
    const n = Math.ceil(s.length / CHUNK), savedAt = Date.now();
    for (let i = 0; i < n; i++) await ref('run' + i).set({ s: s.slice(i * CHUNK, (i + 1) * CHUNK) });
    await ref('runhead').set({ n, savedAt, v: data.v, day: data.day || 0, count: data.count || 0 });
    Store.lastAcct = Date.now(); return true;
  } catch (e) { return false; }
  finally { Store.acctBusy = false; if (Store.pending) { const p = Store.pending; Store.pending = null; saveAccount(p); } }
}

/* ---------- files ---------- */
export async function exportFile(data, name) {
  const json = JSON.stringify(data);
  if (Store.downloads) { try { await Store.downloads.save({ filename: name, data: json }); return 'saved'; } catch (e) { return e && e.code === 'declined' ? 'declined' : 'failed'; } }
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); return 'saved'; } catch (e) { return 'failed'; }
}
export function importFile() {
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => { try { res(JSON.parse(r.result)); } catch (e) { res(null); } }; r.onerror = () => res(null); r.readAsText(f); };
    inp.click();
  });
}
