/* Обёртка над потоком отчётов (report-worker.mjs) для основного процесса.
   overview()/report() возвращают промисы с тем же результатом, что и одноимённые функции reports.mjs.
   Поток поднимается при первом обращении и переживает ошибки отчёта; если он упал или не отвечает,
   отчёт один раз считается в основном потоке (inline) — кабинет не остаётся без данных. */
import { Worker } from 'node:worker_threads';

const TIMEOUT_MS = 60000;
export function createReportRunner({ dataDir, inline, log = console.log }) {
  let worker = null, seq = 0;
  const pending = new Map();
  const failAll = (why) => { for (const [id, p] of pending) { pending.delete(id); p.reject(new Error(why)); } };
  function spawn() {
    const w = new Worker(new URL('./report-worker.mjs', import.meta.url), { workerData: { dataDir }, env: { ...process.env, LUNARIO_QUIET: '1' } });
    w.on('message', (m) => {
      if (m.ready) return;
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id); clearTimeout(p.timer);
      m.ok ? p.resolve(m.result) : p.reject(Object.assign(new Error(m.error), { fromReport: true }));
    });
    w.on('error', (e) => log('Отчёты: поток отчётов упал —', e.message));
    w.on('exit', () => { if (worker === w) worker = null; failAll('worker_exit'); });
    w.unref();   // поток не держит процесс: сервер и так живёт, пока слушает порт
    worker = w;
    return w;
  }
  function call(kind, args) {
    return new Promise((resolve, reject) => {
      const w = worker || spawn();
      const id = ++seq;
      const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('report_timeout')); } }, TIMEOUT_MS);
      timer.unref();
      pending.set(id, { resolve, reject, timer });
      w.postMessage({ id, kind, args });
    }).catch((e) => {
      if (e.fromReport || e.message === 'report_timeout') throw e;   // ошибка самого отчёта или он слишком долгий — не пересчитываем в основном потоке
      log(`Отчёты: поток недоступен (${e.message}) — считаю в основном потоке`);
      return inline[kind](...args);
    });
  }
  return {
    overview: (q) => call('overview', [q]),
    report: (kind, q) => call('report', [kind, q]),
    /* для проверок: поток жив и не занят */
    get idle() { return !!worker && pending.size === 0; },
  };
}
