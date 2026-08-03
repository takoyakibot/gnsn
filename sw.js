// ホーム画面から起動したときと、電波が届かないときのための Service Worker。
//
// 方針は network-first。localStorage にはパース結果だけを保存してあり、
// data/characters.json を更新した時点でそれまで ? だったキャラが貼り直しなしで
// 解決する、という作りにしている。cache-first にすると古い JSON が各端末に
// 焼き付いてその前提が壊れるので、必ず先に網を見に行き、キャッシュは
// 「繋がらないときの控え」としてしか使わない。
//
// 繋がっている限り毎回最新を返すので、配信し直したときにキャッシュの版を
// 上げ忘れて古い画面が residue として残る、という事故も起きない。

const CACHE = 'gnsn-v1';

// 起動に必要な一式。ここに挙げていないものも、一度読めた時点で控えに入る。
// パスは全て相対。GitHub Pages のサブディレクトリ公開でもそのまま効かせるため。
const SHELL = [
  './',
  './index.html',
  './app.js',
  './parse.js',
  './roster.js',
  './names.js',
  './materials.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './data/characters.json',
  './data/materials.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 1 件でも失敗すると addAll は全部を捨ててしまう。控えは「入った分だけ
      // 役に立つ」ものなので、個別に入れて落ちたぶんは見送る。
      await Promise.allSettled(
        SHELL.map(async (path) => {
          const res = await fetch(path, { cache: 'reload' });
          if (res.ok) await cache.put(path, res);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // 書き込みと他オリジンには触らない。このツールは外部に何も投げないので、
  // ここを通るのは自分のファイルの GET だけのはず。
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(request);
        if (res.ok) {
          // 取れたぶんは控えを更新しておく（次に繋がらないときのため）
          const copy = res.clone();
          caches
            .open(CACHE)
            .then((cache) => cache.put(request, copy))
            .catch(() => {
              /* 控えを更新できなくても表示は成立する */
            });
        }
        return res;
      } catch {
        const hit = await caches.match(request, { ignoreSearch: true });
        if (hit) return hit;
        // 画面遷移は index.html で受ける。単一ページなので、どの URL で
        // 開かれてもこれを返せば起動できる。
        if (request.mode === 'navigate') {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }
        return Response.error();
      }
    })(),
  );
});
