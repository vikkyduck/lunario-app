/* Страница «Как установить Лунарио на телефон» (/app/install, собирается в backend/install-guide.mjs).
   Здесь только то, что нельзя сделать разметкой: показать сначала свою платформу (iPhone или Android) с
   переключателем, а в Chrome на Android — кнопку системной установки, если браузер ее предложил.
   Без скрипта страница остается читаемой: обе платформы видны подряд. */
(function () {
  const root = document.documentElement;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(navigator.userAgent);
  const chips = document.querySelectorAll('.chip[data-pick]');
  function pick(os) {
    root.dataset.os = os;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.pick === os)));
  }
  /* компьютер — обе платформы подряд, как на бумаге: инструкцию читают, чтобы поставить на телефон */
  if (ios || android) pick(android ? 'android' : 'ios');   /* Android первым: эмуляция и планшеты иногда выглядят как iPad */
  chips.forEach((c) => c.addEventListener('click', () => pick(c.dataset.pick)));

  /* Пришли по реферальной ссылке (?ref=код): ссылки в приложение несут код дальше, а сверху — кто зовет.
     Манифест с кодом уже в разметке (сервер), так что и установленное отсюда приложение откроется с приглашением */
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref && /^[a-z0-9]{6,12}$/i.test(ref)) {
    document.querySelectorAll('a[data-app]').forEach((a) => { a.href = '/app/?ref=' + encodeURIComponent(ref); });
    const box = document.getElementById('invited');
    const show = (name) => { box.textContent = ''; const b = document.createElement('b'); b.textContent = name ? `${name} зовет вас в Лунарио` : 'Вас зовут в Лунарио'; box.append(b, ' — откройте приложение по этой ссылке. Это бесплатно.'); box.hidden = false; };
    fetch('/app/api/invite/host?code=' + encodeURIComponent(ref)).then((r) => (r.ok ? r.json() : null)).then((h) => { if (h && h.ok) show(h.name); }).catch(() => {});
  }

  /* Chrome на Android: браузер сам умеет ставить приложение — тогда первая кнопка делает это в одно касание */
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; root.dataset.canInstall = '1'; });
  const btn = document.getElementById('native-install');
  if (btn) btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    deferred = null; delete root.dataset.canInstall;
  });
  window.addEventListener('appinstalled', () => { deferred = null; delete root.dataset.canInstall; });
})();
