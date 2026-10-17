/* Состояние почты: работает ли вход по коду прямо сейчас.

   Раньше сервер проверял почту один раз при запуске и держал ответ до следующего перезапуска (server.mjs, smtpOk):
   любой разовый сбой в эту секунду — таймаут, DNS, перезапуск рядом стоящего сервиса — выключал вход по почте
   до следующего выпуска, а настоящие отказы отправки флаг не меняли. На проде так вход пролежал больше недели (16.10).

   Теперь состояние живое (консилиум 16.10 — надежность, почта, безопасность, интерфейс, проверки):
     off      — почта не настроена или настройка с ошибкой; ждем перезапуска с исправленным .env;
     checking — первая проверка после запуска еще идет;
     ok       — вход в ящик проходит; перепроверка раз в час (тихой ночью отозванный пароль иначе первой найдет посетительница);
     down     — не работает; kind — вид сбоя (mailer.mjs), от него зависит расписание перепроверок:
                net, temp — проходят сами: 30 с, 1, 2, 5, 10 мин, дальше каждые 10 мин;
                auth, sender, tls, server — сами не проходят (нужен новый пароль или правка): раз в 30 мин первые 6 ч, потом раз в час,
                  чтобы частые неудачные входы не выглядели для Яндекса подбором пароля и не кончились блокировкой ящика.
   Проверку запускают только таймер и запуск сервера — публичные адреса (/api/me, /api/mail-status, /api/health) лишь читают
   состояние: иначе любой бот управлял бы частотой наших входов в ящик.

   Живая отправка тоже говорит о почте: удача — ok, сбой подключения, входа или отправителя — down.
   Отказ одного письма (recipient — ответ на RCPT, rejected — отказ текста) общее состояние НЕ меняет: иначе запросы кодов
   на переполненные или несуществующие ящики выключали бы вход всем (ревью 16.10 воспроизвело: один «552 Mailbox full» —
   6 часов без входа). Если такие отказы идут подряд по разным адресам — это сигнал владелице (onAnomaly), а не закрытие входа.

   При сбое вида net/temp запрос человека сам служит проверкой — не чаще раза в минуту на весь сервер и по одному:
   первый человек после того, как сеть ожила, входит сразу, не дожидаясь таймера. При auth/tls/sender/server запросы
   людей к Яндексу не ходят вовсе — сразу «почта не работает». */

export const RETRYABLE = new Set(['net', 'temp']);
const LETTER = new Set(['recipient', 'rejected']);
const LADDER = [30e3, 60e3, 120e3, 300e3, 600e3];
const OK_EVERY = 3600e3, SLOW = 1800e3, SLOW_LATE = 3600e3, SLOW_FOR = 6 * 3600e3;
const PROBE_GAP = 60e3, CHECK_DEADLINE = 30e3, BUSY_RETRY = 30e3, STREAK = 5, STREAK_DOMAINS = 3;

export function createMailState({ configProblem, verify, onChange = () => {}, onAnomaly = () => {}, clock = Date.now, timers = globalThis, scale = 1 }) {
  const ms = (n) => Math.max(20, Math.round(n * scale));
  const st = { state: 'checking', kind: '', since: clock(), lastOkAt: 0, lastError: '', lastAttemptAt: 0, nextCheckAt: 0, fails: 0 };
  /* epoch растет с каждым исходом живой отправки: проверка, начатая раньше, свежий исход не перекрывает */
  let timer = null, inflight = null, probing = false, stopped = false, epoch = 0;
  let streak = { n: 0, domains: new Set(), last: '' };

  const change = (prev, prevKind) => { if (prev !== st.state || prevKind !== st.kind) onChange({ ...st }, prev, prevKind); };
  const schedule = (delay) => {
    if (timer) timers.clearTimeout(timer);
    timer = null; st.nextCheckAt = 0;
    if (stopped || st.state === 'off') return;
    st.nextCheckAt = clock() + delay;
    timer = timers.setTimeout(() => { timer = null; check(); }, delay);
    timer?.unref?.();
  };
  const delayDown = () => RETRYABLE.has(st.kind) ? ms(LADDER[Math.min(st.fails - 1, LADDER.length - 1)]) : ms(clock() - st.since < SLOW_FOR ? SLOW : SLOW_LATE);
  function toOk() {
    const prev = st.state, prevKind = st.kind;
    Object.assign(st, { state: 'ok', kind: '', lastError: '', lastOkAt: clock(), fails: 0 });
    if (prev !== 'ok') st.since = clock();
    schedule(ms(OK_EVERY));
    change(prev, prevKind);
  }
  /* fromCheck — исход проверки по расписанию: только она двигает лестницу. Залп писем, упавших разом из-за одного
     мигания сети, лестницу не перескакивает (иначе следующая проверка была бы через 10 мин, а не через 30 с) */
  function toDown(kind, error, fromCheck) {
    const prev = st.state, prevKind = st.kind;
    if (prev !== 'down') { st.since = clock(); st.fails = 0; }
    st.state = 'down'; st.kind = kind; st.lastError = String(error || '').slice(0, 300);
    if (fromCheck || prev !== 'down' || prevKind !== kind) { st.fails++; schedule(delayDown()); }
    change(prev, prevKind);
  }
  function toOff(error) {
    const prev = st.state, prevKind = st.kind;
    Object.assign(st, { state: 'off', kind: 'config', lastError: String(error || ''), fails: 0 });
    schedule(0);
    change(prev, prevKind);
  }

  /* Одна проверка за раз и со своим сроком: даже если проверка зависнет, состояние «checking» не застрянет */
  function check() {
    if (stopped) return Promise.resolve({ ...st });
    const bad = configProblem();
    if (bad) { toOff(bad); return Promise.resolve({ ...st }); }
    if (inflight) return inflight;
    const started = epoch;
    let deadline;
    const guard = new Promise((res) => { deadline = timers.setTimeout(() => res({ ok: false, kind: 'net', error: `проверка не уложилась в ${Math.round(ms(CHECK_DEADLINE) / 1000)} с` }), ms(CHECK_DEADLINE)); deadline?.unref?.(); });
    inflight = Promise.race([Promise.resolve().then(verify).catch((e) => ({ ok: false, kind: 'net', error: String(e && e.message || e) })), guard])
      .then((r) => {
        timers.clearTimeout(deadline);
        if (stopped) return { ...st };
        /* пока шла проверка, живое письмо уже сказало свое — оно свежее; проверку просто ставим заново по расписанию */
        if (epoch !== started && st.state !== 'checking') { schedule(st.state === 'ok' ? ms(OK_EVERY) : delayDown()); return { ...st }; }
        st.lastAttemptAt = clock();
        if (r.ok) toOk();
        else if (r.kind === 'busy') schedule(ms(BUSY_RETRY));        // заняты отправками — проверим чуть позже, состояние не меняем
        else if (r.kind === 'config') toOff(r.error);
        else toDown(r.kind || 'net', r.error, true);
        return { ...st };
      })
      .finally(() => { inflight = null; });
    return inflight;
  }

  /* можно ли пустить запрос человека к почте сейчас — без побочных эффектов */
  function peek() {
    if (st.state === 'off') return { ok: false, error: 'mail_off' };
    if (st.state === 'ok' || st.state === 'checking') return { ok: true };
    if (RETRYABLE.has(st.kind) && !probing && clock() - st.lastAttemptAt >= ms(PROBE_GAP)) return { ok: true, probe: true };
    return { ok: false, error: 'mail_down', retryAfter: publicRetryAfter() };
  }
  /* первая проверка после запуска еще идет — дождаться ее (лимиты частоты не тратим на запросы, которым откажем) */
  const ready = async () => { if (st.state === 'checking') await check(); };
  /* решение окончательное: пробная попытка занимает замок до report() или cancel() */
  async function admit() {
    await ready();
    const g = peek();
    if (g.probe) probing = true;
    return g;
  }
  /* очередь к SMTP дошла: письму, допущенному раньше, все еще можно входить в ящик? Пробной попытке — да (у нее замок) */
  const mayConnect = (g) => !!(g && g.probe) || st.state === 'ok' || st.state === 'checking';

  /* исход живой отправки: null — письмо ушло; иначе SmtpError из mailer.mjs. to — адрес (для счета подряд идущих отказов);
     probe — это была пробная попытка: замок отпускает только она */
  function report(err, to = '', probe = false) {
    if (probe) probing = false;
    epoch++;
    if (stopped) return;
    st.lastAttemptAt = clock();
    if (!err) { streak = { n: 0, domains: new Set(), last: '' }; return toOk(); }
    const kind = err.kind || 'net';
    if (kind === 'busy' || kind === 'gated') return;              // очередь к SMTP — про нашу загрузку, не про почту
    if (LETTER.has(kind) || err.bodySent) {                        // вход прошел и письмо дошло до сервера: почта как таковая жива
      if (st.state === 'down' && RETRYABLE.has(st.kind)) toOk();
      if (LETTER.has(kind)) {
        streak.n++; streak.domains.add(String(to).split('@')[1] || '?'); streak.last = err.message;
        if (streak.n >= STREAK && streak.domains.size >= STREAK_DOMAINS) { onAnomaly({ n: streak.n, domains: streak.domains.size, lastError: streak.last }); streak = { n: 0, domains: new Set(), last: '' }; }
      }
      return;
    }
    if (kind === 'config') return toOff(err.message);
    toDown(kind, err.message, false);
  }
  /* попытка, на которую дали замок, не состоялась */
  const cancel = () => { probing = false; };
  /* Наружу (публичные /api/mail-status и отказы 503) — грубая подсказка: при коротком сбое — когда можно попробовать
     снова (не больше минуты: дальше запрос сам станет пробной попыткой); при долгом — null. Точное время до проверки
     и вид сбоя по нему не угадать, они — только в mailInfo на самом сервере */
  function publicRetryAfter() {
    if (st.state !== 'down' || !RETRYABLE.has(st.kind)) return null;
    return Math.max(1, Math.min(60, Math.ceil((st.lastAttemptAt + ms(PROBE_GAP) - clock()) / 1000)));
  }

  return {
    start() { stopped = false; return check(); },
    stop() { stopped = true; if (timer) timers.clearTimeout(timer); timer = null; },
    check, peek, ready, admit, mayConnect, report, cancel, publicRetryAfter,
    /* для журнала и mailInfo — все, в том числе секунды до следующей проверки */
    status: () => ({ ...st, retryAfter: st.nextCheckAt ? Math.max(1, Math.ceil((st.nextCheckAt - clock()) / 1000)) : null }),
    /* для экранов: имеет ли смысл показывать форму входа — почта работает, проверяется или сбой короткий */
    formUseful: () => st.state === 'ok' || st.state === 'checking' || (st.state === 'down' && RETRYABLE.has(st.kind)),
    /* для публичного /api/health и /api/mail-status — только грубое состояние, без причины и времени */
    publicState: () => st.state,
  };
}
