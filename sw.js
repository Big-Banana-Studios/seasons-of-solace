/* Service worker — makes the app itself work with no internet.

   Scope note: this caches the *app* (a few small files, the fonts, and the
   Transformers.js library). It does NOT cache the model. Transformers.js keeps
   the model weights and the ONNX Runtime binaries in its own cache under
   'transformers-cache', so the two never overlap — and we must never delete a
   cache we did not create, because that would throw away an 814MB download.

   Nothing a person types passes through here. The worker only ever sees
   requests for files. */

// Keep identical to APP_VERSION in app.js.
const VERSION = 'v1.0.0';
const SHELL = `seasons-of-solace-shell-${VERSION}`;

// Keep identical to the import in worker.js.
const LIBRARY = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

const SHELL_FILES = [
  './',
  './index.html',
  './app.js',
  './worker.js',
  './prompts.js',
  './safety.js',
  './welcome.js',
  './style.css',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
  './assets/fonts/lora-latin.woff2',
  './assets/fonts/nunito-sans-latin.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // cache.addAll() would read through the browser's HTTP cache, and GitHub
    // Pages sends max-age=600 — so a fresh install could enshrine files up to
    // ten minutes old. 'reload' forces a real network fetch.
    await Promise.all(SHELL_FILES.map(async (file) => {
      const response = await fetch(new Request(file, { cache: 'reload' }));
      if (!response.ok) throw new Error(`${file} returned ${response.status}`);
      await cache.put(file, response);
    }));
    try {
      await cache.add(new Request(LIBRARY, { mode: 'cors' }));
    } catch (err) {
      console.warn('Library not pre-cached:', err);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        // Only ever clear our own older shells. Everything else on this origin,
        // the model cache above all, is left strictly alone.
        .filter((k) => k.startsWith('seasons-of-solace-shell-') && k !== SHELL)
        .map((k) => caches.delete(k)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'version' && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Let Transformers.js manage its own model traffic — it has a better cache for
  // those files than we do, and they are far too big to duplicate.
  if (url.hostname.endsWith('huggingface.co') || url.hostname.endsWith('hf.co')) return;

  // The library: cache-first, since it never changes at a pinned version.
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) (await caches.open(SHELL)).put(request, response.clone());
      return response;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  /* App files: try the network so edits show up, fall back to the cache when
     offline. `cache: 'no-cache'` is load-bearing — a plain fetch() reads the
     browser's HTTP cache first, and GitHub Pages sends max-age=600, so for ten
     minutes after a deploy this "network-first" handler would quietly serve
     the old file. 'no-cache' still uses the cache but always revalidates. */
  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok) (await caches.open(SHELL)).put(request, response.clone());
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw new Error('offline and not cached');
    }
  })());
});
