// 가계도 편집기 오프라인 캐시. 새 버전을 올릴 때 VERSION 숫자를 올리세요.
const VERSION = 'gagyedo-v89';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './fonts/PretendardVariable.woff2', './fonts/PretendardJPVariable.woff2',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // 페이지는 최신 것을 먼저, 오프라인이면 저장해 둔 것
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return r;
  })));
});
