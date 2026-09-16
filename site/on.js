/* Делегирование событий вместо инлайн-атрибутов вида onclick=…, которые запрещает CSP без 'unsafe-inline'.
   В разметке: data-on="click:имя" (несколько — через пробел: "input:а keydown:б"), аргументы — data-a0, data-a1…
   Обработчик берётся из window.LUN_HANDLERS (handlers.js / cabinet-handlers.js) и вызывается с this = элемент
   и event = событие — ровно как раньше вызывался бы атрибут; вернул false — preventDefault, как «return false».
   Порядок как при всплытии: сначала сам элемент, потом родители. toggle не всплывает — ловим его на захвате. */
(function () {
  function run(event) {
    const H = window.LUN_HANDLERS || {};
    for (let el = event.target; el && el.nodeType === 1; el = el.parentElement) {
      const spec = el.getAttribute('data-on'); if (!spec) continue;
      for (const pair of spec.split(' ')) {
        const i = pair.indexOf(':'); if (pair.slice(0, i) !== event.type) continue;
        const fn = H[pair.slice(i + 1)];
        if (!fn) { console.warn('Нет обработчика', pair, el); continue; }
        if (fn.call(el, event) === false) event.preventDefault();
      }
    }
  }
  for (const type of ['click', 'input', 'change', 'keydown']) document.addEventListener(type, run);
  document.addEventListener('toggle', run, true);
})();
