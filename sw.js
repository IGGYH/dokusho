/* 読書録　オフラインでも画面を開けるようにする仕組み（サービスワーカー） */
const CACHE = 'dokusho-v2.0.2';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];
// 通信が止まったままの場合に、保存しておいた画面に切り替えるまでの時間（ミリ秒）
const WAIT = 4000;

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      // ブラウザの一時保存を通さず、最新のファイルを保存します
      .then(function (cache) { return cache.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.indexOf('dokusho-') === 0 && k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/*
 * 同じサイトのファイルは「まず最新を取りに行き、つながらない（または時間がかかりすぎる）場合は保存しておいたもの」を使います。
 * 最新のファイルが届いたら、次回のために保存し直します。
 * 読書データの通信（Google Apps Script）や表紙画像には関与しません。
 */
self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const fromCache = function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined);
    });
  };
  let saved = Promise.resolve();
  const network = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
    if (res.ok) {
      const copy = res.clone();
      saved = caches.open(CACHE).then(function (cache) { return cache.put(req, copy); });
    }
    return res;
  });
  // 保存し直す処理が終わるまで、サービスワーカーを止めないようにします
  event.waitUntil(network.then(function () { return saved; }, function () {}));
  event.respondWith(new Promise(function (resolve) {
    let done = false;
    const finish = function (res) { if (!done && res) { done = true; resolve(res); } };
    const timer = setTimeout(function () { fromCache().then(finish); }, WAIT);
    network.then(function (res) { clearTimeout(timer); finish(res); }, function () {
      clearTimeout(timer);
      fromCache().then(function (hit) { finish(hit || Response.error()); });
    });
  }));
});
