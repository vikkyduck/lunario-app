/* Оболочка приложения работает офлайн; данные всегда идут в сеть.

   ВАЖНО про стратегию: саму страницу берём ИЗ СЕТИ (кэш — только запасной путь
   при пропавшей связи). Прежняя версия отдавала её из кэша всегда, и человек,
   один раз открывший приложение, навсегда оставался на старой версии:
   обновления до него не доезжали. */
const CACHE = 'lunario-app-v2';
const SHELL = ['/app/', '/app/assets/fonts/inter-var-cyrillic.woff2', '/app/assets/fonts/inter-var-latin.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/app/api/')) return;   // данные — только из сети

  // страница приложения: сначала сеть, чтобы правки появлялись сразу
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r.ok && u.origin === location.origin) {
            const cp = r.clone();
            caches.open(CACHE).then((c) => c.put('/app/', cp)).catch(() => {});
          }
          return r;
        })
        .catch(() => caches.match('/app/'))
    );
    return;
  }

  // шрифты, иконки и прочая неизменная статика — из кэша, это быстро и безопасно
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok && u.origin === location.origin) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match('/app/')))
  );
});

/* Уведомление «карта дня готова». Текст живёт здесь, поэтому сервер шлёт
   пустой сигнал — личных данных в пути нет вовсе. */
self.addEventListener('push', (e) => {
  e.waitUntil(self.registration.showNotification('Лунарио', {
    body: 'Ваша карта дня готова',
    icon: '/app/assets/icon-192.png',
    badge: '/app/assets/icon-192.png',
    tag: 'lunario-day',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => c.url.includes('/app'));
    if (open) return open.focus();
    return clients.openWindow('/app/');
  })());
});
