/* Оболочка приложения работает офлайн; данные всегда идут в сеть.

   ВАЖНО про стратегию: саму страницу берем ИЗ СЕТИ (кэш — только запасной путь
   при пропавшей связи). Прежняя версия отдавала ее из кэша всегда, и человек,
   один раз открывший приложение, навсегда оставался на старой версии:
   обновления до него не доезжали. */
const V = '72';   /* одна версия для оболочки: index.html, sky.js и импорты внутри него ссылаются на тот же ?v= */
const CACHE = 'lunario-app-v' + V;
const RUNTIME_LIMIT = 60;   // сколько файлов статики держим на устройстве сверх оболочки
const SHELL = ['/app/', '/app/theme.css?v=' + V, '/app/experience.css?v=' + V, '/app/moon-glass.css?v=' + V, '/app/compact.css?v=' + V, '/app/frame.css?v=' + V,
  /* скрипты оболочки: раньше жили внутри index.html, вынесены ради CSP без инлайна — офлайн без них экран пустой */
  '/app/boot.js?v=' + V, '/app/moon-logo.js?v=' + V, '/app/experience.js?v=' + V, '/app/app.js?v=' + V, '/app/tour.js?v=' + V, '/app/handlers.js?v=' + V, '/app/on.js?v=' + V,
  '/app/assets/fonts/onest-400-cyrillic.woff2', '/app/assets/fonts/onest-400-latin.woff2', '/app/assets/fonts/comfortaa-300-700-cyrillic.woff2', '/app/assets/fonts/comfortaa-300-700-latin.woff2', '/app/sky.js?v=' + V, '/app/sky-model.js?v=' + V, '/app/constellations.js?v=' + V, '/app/assets/moon-hero-560.webp', '/app/assets/moon-hero-1120.webp'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('lunario-app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/app/api/')) return;   // данные — только из сети
  if (u.pathname.startsWith('/app/uploads/') || u.pathname.startsWith('/app-test/uploads/')) return;   // материалы кабинета не оседают на телефоне
  // манифест и сам воркер — мимо кэша: иначе Chrome не видит новые иконки и имя приложения
  if (e.request.destination === 'manifest' || u.pathname === '/app/manifest.webmanifest' || u.pathname === '/app/sw.js') return;

  // страница приложения: сначала сеть, чтобы правки появлялись сразу. Запасной копией под ключом '/app/' становится
  // только сама страница приложения: переход на /app/install или /app/cabinet не должен подменять офлайн-оболочку
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r.ok && u.origin === location.origin && (u.pathname === '/app/' || u.pathname === '/app/index.html')) {
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
      if (r.ok && u.origin === location.origin && /\.(woff2|svg|png|webp|css|js|json)$/i.test(u.pathname)) {
        const cp = r.clone();
        caches.open(CACHE).then(async (c) => { await c.put(e.request, cp); trim(c); });
      }
      return r;
    }).catch(() => caches.match('/app/')))
  );
});

/* кеш не растет бесконечно: старые файлы сверх лимита выбрасываем, оболочка остается */
async function trim(c) {
  const keys = await c.keys();
  const extra = keys.filter((k) => { const u = new URL(k.url); return !SHELL.includes(u.pathname + u.search); });
  for (const k of extra.slice(0, Math.max(0, extra.length - RUNTIME_LIMIT))) await c.delete(k);
}

/* Уведомление «карта дня готова». Текст живет здесь, поэтому сервер шлет
   пустой сигнал — личных данных в пути нет вовсе. */
/* Сервер шлет пустой сигнал «проснись» — через чужие почтовые службы не летит ни слова.
   По сигналу забираем тексты со своего сервера (по куке аккаунта) и показываем каждое:
   карта дня, настроение, привычки, аскеза, лунный день, небо. */
const FALLBACK = { title: 'Лунарио', body: 'Ваше напоминание — загляните в приложение', url: '/app/', feature: 'reminder' };
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let items = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const r = await fetch('/app/api/push/next', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub ? sub.endpoint : '' }) });
      if (r.ok) items = ((await r.json()).items || []).filter((n) => n && n.title);
    } catch (err) { /* сеть не ответила — покажем общее */ }
    if (!items.length) items = [FALLBACK];
    for (const n of items) {
      await self.registration.showNotification(n.title, {
        body: n.body || '',
        icon: '/app/assets/icon-192.png?v=3',
        badge: '/app/assets/badge-96.png?v=1',   /* монохромный силуэт: Android красит альфу */
        tag: 'lunario-' + (n.feature || 'day'),
        data: { url: n.url || '/app/' },
      });
    }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/app/';
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => c.url.includes('/app'));
    if (open) {
      await open.focus();
      if ('navigate' in open) { try { await open.navigate(url); } catch (err) { /* окно не дает перейти — оно уже открыто */ } }
      return;
    }
    return clients.openWindow(url);
  })());
});
