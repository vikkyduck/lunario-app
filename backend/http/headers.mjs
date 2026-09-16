/* Заголовки страниц — одно место для сервера и локального просмотра (tools/preview.mjs отдаёт index.html сам).

   Content-Security-Policy: скрипты только со своего домена и без инлайна. В index.html и cabinet.html нет
   ни <script> без src, ни атрибутов вида onclick=… — обработчики живут в handlers.js / cabinet-handlers.js
   и вешаются делегированием (on.js). Поэтому даже если в разметку попадёт чужой текст, выполнить код он не сможет.
   Стили пока с 'unsafe-inline': <style> и style=… в разметке остались, а стили — не исполнение кода.
   img-src: открытки и фото рисуются через data:/blob:. frame-ancestors 'none' и X-Frame-Options: DENY —
   как у nginx на сервере; два одинаковых заголовка безвредны, разные заставили бы браузер выбирать. */
export const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
  "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"].join('; ');
export const HTML_HEADERS = { 'X-Frame-Options': 'DENY', 'Content-Security-Policy': CSP, 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff' };
