/* Обертка над потоком отчетов (report-worker.mjs) для основного процесса.
   overview()/report() возвращают промисы с тем же результатом, что и одноименные функции reports.mjs.
   Поток поднимается при первом обращении и переживает ошибки отчета.

   Очередь с пределом (ревью v114, F10):
   · в потоке одновременно идет одно задание (MAX_INFLIGHT), остальные ждут здесь, в pending; ждущих не больше MAX_PENDING —
     сверх того вызов сразу получает ошибку с code 'busy' (маршрут кабинета отвечает 429, кабинет говорит «повторите через минуту»);
   · одинаковые запросы (kind + аргументы) объединяются: второй получает промис первого, новой задачи не создается;
   · таймаут снимает задание: не начатое — просто вынимается из очереди; уже отданное потоку — поток помечает его отмененным
     (перед каждым заданием он сверяется с набором cancelled), а зависший синхронный отчет нельзя прервать иначе как
     остановкой потока — поток останавливается и поднимается заново при следующем вызове;
   · падение потока — не больше MAX_RESTARTS за RESTART_WINDOW_MS; дальше call() отвечает busy, ожидавшие получают ошибку —
     тяжелый пересчет в основном процессе не запускается ни для кого. Inline-путь остается только для одиночного холодного
     вызова, когда поток вовсе не удалось запустить (нет worker_threads, нет файла) — кабинет не остается без данных. */
import { Worker } from 'node:worker_threads';

export const MAX_PENDING = 8, MAX_INFLIGHT = 1, MAX_RESTARTS = 3, RESTART_WINDOW_MS = 10 * 60000;
const busyError = () => Object.assign(new Error('busy'), { code: 'busy' });
export function createReportRunner({ dataDir, inline, log = console.log, workerUrl = new URL('./report-worker.mjs', import.meta.url), timeoutMs = 60000 }) {
  let worker = null, seq = 0, everSpawned = false;
  const pending = [];              /* ждут отправки в поток: { id, key, kind, args, resolve, reject, timer } */
  const inflight = new Map();      /* отданы потоку: id → то же */
  const byKey = new Map();         /* key → промис живого задания (объединение одинаковых) */
  const starts = [];               /* моменты запуска потока — для предела перезапусков */
  const settle = (job, fn, value) => { clearTimeout(job.timer); byKey.delete(job.key); inflight.delete(job.id); const i = pending.indexOf(job); if (i >= 0) pending.splice(i, 1); fn(value); };
  const failAll = (why) => { for (const job of [...inflight.values(), ...pending]) settle(job, job.reject, Object.assign(new Error(why), { code: 'busy', why })); };
  /* первый запуск не считается перезапуском: за окно допустимо MAX_RESTARTS повторных подъемов */
  function canSpawn() { const now = Date.now(); while (starts.length && now - starts[0] > RESTART_WINDOW_MS) starts.shift(); return starts.length <= MAX_RESTARTS; }
  function spawn() {
    if (!canSpawn()) return null;
    let w;
    try { w = new Worker(workerUrl, { workerData: { dataDir }, env: { ...process.env, LUNARIO_QUIET: '1' } }); }
    catch (e) { log('Отчеты: поток не запустился —', e.message); return null; }
    starts.push(Date.now()); everSpawned = true;
    w.on('message', (m) => {
      if (m.ready) return;
      const job = inflight.get(m.id); if (!job || job.worker !== w) return;
      m.ok ? settle(job, job.resolve, m.result) : settle(job, job.reject, Object.assign(new Error(m.error), { fromReport: true, code: 'report_failed' }));
      pump();
    });
    w.on('error', (e) => log('Отчеты: поток отчетов упал —', e.message));
    w.on('exit', () => {
      if (worker === w) worker = null;
      for (const job of [...inflight.values()]) if (job.worker === w) settle(job, job.reject, Object.assign(new Error('worker_exit'), { code: 'busy', why: 'worker_exit' }));   /* только задания этого потока: новый уже мог взять следующее */
      if (w.stoppedByTimeout) pump();   /* остановлен нами из-за зависшего задания — остальные ждущие поедут в новый поток */
      else failAll('worker_exit');      /* упал сам: ожидавшие получают busy, тяжелый пересчет в основном потоке не запускается */
    });
    w.unref();   // поток не держит процесс: сервер и так живет, пока слушает порт
    worker = w;
    return w;
  }
  /* отдать потоку следующее задание, если он свободен */
  function pump() {
    while (inflight.size < MAX_INFLIGHT && pending.length) {
      const w = worker || spawn();
      if (!w) { failAll('worker_unavailable'); return; }
      const job = pending.shift(); job.worker = w; inflight.set(job.id, job);
      w.postMessage({ id: job.id, kind: job.kind, args: job.args });
    }
  }
  function timeout(job) {
    if (!inflight.has(job.id) && !pending.includes(job)) return;
    const wasInflight = inflight.has(job.id);
    settle(job, job.reject, Object.assign(new Error('report_timeout'), { code: 'report_timeout' }));
    if (wasInflight && worker) {
      /* поток занят зависшим отчетом: сказать ему об отмене (на случай, если он еще между заданиями) и остановить — иначе очередь стоит */
      const w = worker; worker = null; w.stoppedByTimeout = true;
      try { w.postMessage({ cancel: job.id }); } catch { /* уже мертв */ }
      w.terminate().catch(() => {});
      log(`Отчеты: задание ${job.kind} не уложилось в ${Math.round(timeoutMs / 1000)} с — поток остановлен, следующий вызов поднимет его заново`);
    } else pump();
  }
  function call(kind, args) {
    const key = kind + ':' + JSON.stringify(args);
    if (byKey.has(key)) return byKey.get(key);   /* тот же отчет уже считается — второй запрос ждет его же */
    if (pending.length + inflight.size >= MAX_PENDING) return Promise.reject(busyError());
    if (!worker && !canSpawn()) return Promise.reject(busyError());   /* поток падал слишком часто — не запускаем и не считаем в основном */
    const p = new Promise((resolve, reject) => {
      const job = { id: ++seq, key, kind, args, resolve, reject, timer: null };
      job.timer = setTimeout(() => timeout(job), timeoutMs); job.timer.unref();
      pending.push(job); pump();
    }).catch((e) => {
      if (e.why === 'worker_unavailable' && !everSpawned) { log('Отчеты: поток недоступен — считаю в основном потоке один раз'); return inline[kind](...args); }
      throw e;
    });
    byKey.set(key, p);
    p.finally(() => { if (byKey.get(key) === p) byKey.delete(key); }).catch(() => {});
    return p;
  }
  return {
    overview: (q) => call('overview', [q]),
    report: (kind, q) => call('report', [kind, q]),
    /* для проверок: поток жив и не занят; размеры очередей */
    get idle() { return !!worker && pending.length === 0 && inflight.size === 0; },
    get pendingSize() { return pending.length + inflight.size; },
    get restarts() { return starts.length; },
  };
}
