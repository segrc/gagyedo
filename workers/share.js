// 가계도 편집기 · 짧은 공유 링크 서버 (Cloudflare Worker + KV)
// KV 바인딩 이름: SHARES
// Worker 이름: gagyedo-share  → 주소 https://gagyedo-share.j-segrc.workers.dev
const SITE = 'https://gagyedo.j-segrc.workers.dev';   // 편집기 주소 (여기서 온 요청만 허용)
const MAX = 400000;                                    // 한 판 최대 크기 (글자 수)
const KEEP = 60 * 60 * 24 * 365 * 3;                   // 보관 기간: 3년 (초)

const cors = {
  'Access-Control-Allow-Origin': SITE,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const ABC = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const rand = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => ABC[x % ABC.length]).join('');
const reply = (body, status = 200, extra = {}) => new Response(body, { status, headers: { ...cors, ...extra } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return reply(null, 204);

    // 올리기: 가계도(JSON)를 받아 짧은 번호를 돌려줌
    if (req.method === 'POST' && url.pathname === '/') {
      const origin = req.headers.get('Origin');
      if (origin && origin !== SITE) return reply('forbidden', 403);
      const body = await req.text();
      if (!body.startsWith('{') || body.length > MAX) return reply('bad request', 400);
      try { JSON.parse(body); } catch { return reply('bad request', 400); }
      let id = rand(7);
      for (let i = 0; i < 4 && (await env.SHARES.get(id)) !== null; i++) id = rand(7);
      await env.SHARES.put(id, body, { expirationTtl: KEEP });
      return reply(JSON.stringify({ id }), 200, { 'Content-Type': 'application/json' });
    }

    // 꺼내기: 번호로 가계도(JSON)를 돌려줌
    const id = url.pathname.slice(1);
    if (req.method === 'GET' && /^[0-9A-Za-z]{5,12}$/.test(id)) {
      const v = await env.SHARES.get(id);
      if (v === null) return reply('not found', 404);
      return reply(v, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' });
    }

    return reply('가계도 편집기 공유 서버', 200, { 'Content-Type': 'text/plain; charset=utf-8' });
  },
};
