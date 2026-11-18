// 가계도 편집기 · 기기 간 동기화 서버 (Cloudflare Worker + D1)
// D1 바인딩 이름: DB  (표는 처음 요청 때 저절로 만들어집니다)
// Worker 이름을 gagyedo-sync 로 만들면 주소가 https://gagyedo-sync.j-segrc.workers.dev 가 됩니다.
const SITE = 'https://gagyedo.j-segrc.workers.dev';   // 편집기 주소 (여기서 온 요청만 허용)
const SYNC_MAX = 1900000;                              // 한 판 최대 크기 (압축 후 글자 수, D1 한 칸 한도 2MB)
const HIST = 20;                                       // 판마다 이전 버전을 몇 개까지 보관할지

const cors = {
  'Access-Control-Allow-Origin': SITE,
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // 헷갈리는 글자(0 O 1 I) 뺌
const rand = (n, abc) => [...crypto.getRandomValues(new Uint8Array(n))].map(x => abc[x % abc.length]).join('');
const reply = (body, status = 200, extra = {}) => new Response(body, { status, headers: { ...cors, ...extra } });
// 코드 맞추기: 공백 빼고 영문은 대문자로. 영문·숫자만 16자면 4자씩 끊음 (만들어 준 코드와 같은 꼴)
const normCode = c => { c = String(c || '').normalize('NFC').replace(/\s+/g, '').toUpperCase(); return /^[A-Z0-9]{16}$/.test(c) ? c.match(/.{4}/g).join('-') : c; };
const okCode = c => /^[가-힣A-Z0-9_-]{8,40}$/.test(c);
const json = (obj, status = 200) => reply(JSON.stringify(obj), status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

let ready = false;
async function setup(db) {
  if (ready) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS accounts (code TEXT PRIMARY KEY, hint TEXT, created INTEGER, seen INTEGER)'),
    db.prepare('CREATE TABLE IF NOT EXISTS boards (code TEXT, id TEXT, title TEXT, created TEXT, data TEXT, rev INTEGER, updated INTEGER, deleted INTEGER DEFAULT 0, PRIMARY KEY (code, id))'),
    db.prepare('CREATE TABLE IF NOT EXISTS history (code TEXT, id TEXT, rev INTEGER, title TEXT, data TEXT, saved INTEGER)'),
    db.prepare('CREATE INDEX IF NOT EXISTS history_ix ON history (code, id, rev)'),
    db.prepare('CREATE INDEX IF NOT EXISTS hint_ix ON accounts (hint)'),
  ]);
  ready = true;
}

async function sync(req, env, parts) {
  if (!env.DB) return json({ error: 'DB 바인딩이 없습니다' }, 500);
  await setup(env.DB);
  const db = env.DB, now = Date.now();
  const origin = req.headers.get('Origin');
  if (req.method !== 'GET' && origin && origin !== SITE) return reply('forbidden', 403);

  // 새 동기화 코드 만들기
  if (parts[0] === 'new' && req.method === 'POST') {
    let hint = '', want = '';
    try { const b = await req.json(); hint = String(b.hint || '').trim().slice(0, 80); want = b.code ? normCode(b.code) : ''; } catch {}
    let code;
    if (want) {   // 쓰는 사람이 정한 코드
      if (!okCode(want)) return json({ error: 'bad code' }, 400);
      if (await db.prepare('SELECT 1 FROM accounts WHERE code=?').bind(want).first()) return json({ taken: true }, 409);
      code = want;
    } else for (let i = 0; i < 5; i++) {
      code = rand(16, CODE_ABC).match(/.{4}/g).join('-');
      if (!(await db.prepare('SELECT 1 FROM accounts WHERE code=?').bind(code).first())) break;
    }
    await db.prepare('INSERT INTO accounts (code, hint, created, seen) VALUES (?,?,?,?)').bind(code, hint, now, now).run();
    return json({ code });
  }

  const code = normCode(parts[0]);
  if (!okCode(code)) return json({ error: 'bad code' }, 400);
  const acc = await db.prepare('SELECT code FROM accounts WHERE code=?').bind(code).first();
  if (!acc) return json({ error: 'not found' }, 404);

  // 판 목록 (내용 없이)
  if (parts.length === 1 && req.method === 'GET') {
    await db.prepare('UPDATE accounts SET seen=? WHERE code=?').bind(now, code).run();
    const { results } = await db.prepare('SELECT id, title, created, rev, updated, deleted FROM boards WHERE code=?').bind(code).all();
    return json({ boards: results });
  }

  if (parts[1] !== 'b' || !/^[A-Za-z0-9_-]{1,40}$/.test(parts[2] || '')) return json({ error: 'bad request' }, 400);
  const id = parts[2];
  const cur = await db.prepare('SELECT title, created, data, rev, updated, deleted FROM boards WHERE code=? AND id=?').bind(code, id).first();

  if (req.method === 'GET') {
    if (!cur) return json({ error: 'not found' }, 404);
    return json({ id, ...cur });
  }

  // 덮어쓰기 전 내용은 history 표에 남김 (판마다 최근 HIST개)
  const keepOld = () => cur && cur.data ? [
    db.prepare('INSERT INTO history (code, id, rev, title, data, saved) VALUES (?,?,?,?,?,?)').bind(code, id, cur.rev, cur.title, cur.data, now),
    db.prepare('DELETE FROM history WHERE code=? AND id=? AND rev NOT IN (SELECT rev FROM history WHERE code=? AND id=? ORDER BY rev DESC LIMIT ?)').bind(code, id, code, id, HIST),
  ] : [];

  if (req.method === 'PUT') {
    let b;
    try { b = await req.json(); } catch { return json({ error: 'bad request' }, 400); }
    if (typeof b.data !== 'string' || b.data.length > SYNC_MAX) return json({ error: 'too large' }, 413);
    if (cur && !b.force && (cur.rev || 0) !== (b.baseRev || 0)) return json({ conflict: true, rev: cur.rev, updated: cur.updated }, 409);
    const rev = (cur ? cur.rev || 0 : 0) + 1;
    await db.batch([
      ...keepOld(),
      db.prepare('INSERT INTO boards (code, id, title, created, data, rev, updated, deleted) VALUES (?,?,?,?,?,?,?,0) ON CONFLICT(code, id) DO UPDATE SET title=excluded.title, created=excluded.created, data=excluded.data, rev=excluded.rev, updated=excluded.updated, deleted=0')
        .bind(code, id, String(b.title || '').slice(0, 200), String(b.created || ''), b.data, rev, now),
    ]);
    return json({ rev, updated: now });
  }

  if (req.method === 'DELETE') {
    if (!cur) return json({ rev: 0 });
    const rev = (cur.rev || 0) + 1;
    await db.batch([...keepOld(), db.prepare('UPDATE boards SET deleted=1, data=NULL, rev=?, updated=? WHERE code=? AND id=?').bind(rev, now, code, id)]);
    return json({ rev, updated: now });
  }
  return json({ error: 'bad request' }, 400);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return reply(null, 204);
    const parts = url.pathname.split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
    if (parts[0] === 'sync') parts.shift();   // /sync/... 로 와도, 바로 /... 로 와도 됨
    if (!parts.length) return reply('가계도 편집기 동기화 서버', 200, { 'Content-Type': 'text/plain; charset=utf-8' });
    try { return await sync(req, env, parts); }
    catch (e) { return json({ error: String(e && e.message || e) }, 500); }
  },
};
