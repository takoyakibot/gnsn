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

// index.html と *.js は互いに噛み合っていないと動かない。GitHub Pages は
// Cache-Control: max-age=600 を返すので、この 2 種類の寿命は別々に切れる。
// 配信し直した直後に「古い app.js + 新しい index.html」の組み合わせが起きて、
// 消えた要素を触った時点で描画が止まり、一覧が空のまま何も出ない状態になった
// （実際に起きた。renderTeam が $('resonance') で落ちていた）。
//
// この 2 種類だけは毎回サーバに確認を取り、世代を揃える。変わっていなければ
// 304 が返るだけなので安い。データと画像は普通のキャッシュに任せる。
const MUST_AGREE = /(?:\.html|\.js|\/)$/;

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // 書き込みと他オリジンには触らない。このツールは外部に何も投げないので、
  // ここを通るのは自分のファイルの GET だけのはず。
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      try {
        // navigate の Request はそのままでは作り直せないので、URL から組む。
        const res = await fetch(
          MUST_AGREE.test(url.pathname)
            ? new Request(url.href, { cache: 'no-cache', credentials: 'same-origin' })
            : request,
        );
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
