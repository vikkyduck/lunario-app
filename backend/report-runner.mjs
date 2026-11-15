/* Прежнее имя обертки над потоком отчетов — теперь общая очередь заданий job-runner.mjs (ревью v114, F09):
   отчеты, дашборд и выгрузка личных данных считаются в одном потоке с одной ограниченной очередью (F10) */
export { createJobRunner as createReportRunner, createJobRunner, MAX_PENDING, MAX_INFLIGHT, MAX_RESTARTS, RESTART_WINDOW_MS } from './job-runner.mjs';
