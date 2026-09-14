const CACHE='weather-v7-shell';
const ASSETS=[
  './',
  './index.html?v=7',
  './styles.css?v=7',
  './app.js?v=7',
  './manifest.webmanifest?v=7',
  './icon-192.png?v=7',
  './icon-512.png?v=7'
];

self.addEventListener('install', e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate', e=>{
  e.waitUntil((async()=>{
    for(const k of await caches.keys()){
      if(k!==CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);

  // HTML/JS/CSS are always network-first to prevent stale app UI after updates.
  const isShell = url.pathname.endsWith('/') ||
                  url.pathname.endsWith('/index.html') ||
                  url.pathname.endsWith('/app.js') ||
                  url.pathname.endsWith('/styles.css');

  if(isShell){
    e.respondWith(
      fetch(e.request,{cache:'no-store'}).then(r=>{
        const copy=r.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return r;
      }).catch(()=>caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached=>cached || fetch(e.request).then(r=>{
      const copy=r.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy));
      return r;
    }))
  );
});
