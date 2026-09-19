/* Делегирование событий вместо инлайн-атрибутов вида onclick=…, которые запрещает CSP без 'unsafe-inline'.
   В разметке: data-on="click:имя" (несколько — через пробел: "input:а keydown:б"), аргументы — data-a0, data-a1…
   Обработчик берется из window.LUN_HANDLERS (handlers.js / cabinet-handlers.js) и вызывается с this = элемент
   и event = событие — ровно как раньше вызывался бы атрибут; вернул false — preventDefault, как «return false».
   Порядок как при всплытии: сначала сам элемент, потом родители. toggle не всплывает — ловим его на захвате. */
(function () {
  /* Имя вида «функция-a0-a1-this-value» вызывает window.функция(el.dataset.a0, el.dataset.a1, el, el.value) сама —
     без строки в реестре. Другие хвосты (openWidget-tone, go-home) — по-прежнему из реестра. */
  const ARGS = { this: (el) => el, value: (el) => el.value, event: (el, ev) => ev };
  const autoCache = {};
  function auto(name) {
    if (name in autoCache) return autoCache[name];
    const parts = name.split('-'), fnName = parts[0], fn = typeof window[fnName] === 'function' ? window[fnName] : null;
    const ok = fn && parts.slice(1).every((a) => ARGS[a] || /^a\d$/.test(a));
    return (autoCache[name] = ok ? function (event) { return fn.apply(this, parts.slice(1).map((a) => ARGS[a] ? ARGS[a](this, event) : this.dataset[a])); } : null);
  }
  function run(event) {
    const H = window.LUN_HANDLERS || {};
    /* toggle не всплывает: у атрибута ontoggle срабатывал только свой <details>. Идем по предкам лишь для
       всплывающих событий — иначе открытие вложенного <details> дергало бы обработчик внешнего. */
    for (let el = event.target; el && el.nodeType === 1; el = event.bubbles ? el.parentElement : null) {
      const spec = el.getAttribute('data-on'); if (!spec) continue;
      for (const pair of spec.split(' ')) {
        const i = pair.indexOf(':'); if (pair.slice(0, i) !== event.type) continue;
        const name = pair.slice(i + 1), fn = H[name] || auto(name);
        if (!fn) { console.warn('Нет обработчика', pair, el); continue; }
        if (fn.call(el, event) === false) event.preventDefault();
      }
    }
  }
  for (const type of ['click', 'input', 'change', 'keydown']) document.addEventListener(type, run);
  document.addEventListener('toggle', run, true);
})();
