/* Почта вокруг состояния (mail-state.mjs): письма с кодом, журнал и оповещения владелице.

   Почему так (консилиум 16.10): вход по почте пролежал на проде больше недели, и никто этого не видел — сбой проверки
   при запуске шел только в journalctl, отказы людям («почта не настроена») не писались никуда, а «Письма с кодом
   не ушли» в кабинете показывало 0. Теперь:
   — каждая смена состояния почты — строка в журнале сбоев (path 'mail_state') и в journalctl с префиксом «SMTP:»;
   — отказы людям считаются и раз в час пишутся одной строкой (а не строкой на каждое нажатие: таблица errors
     не чистится, и так бот раздул бы базу и утопил настоящие сбои);
   — если почта лежит дольше 10 минут — сообщение владелице в Telegram через очередь бэклога (не почтой: почта
     сломана, а кабинет без почты недоступен вышедшему админу); раз в сутки напоминание, при восстановлении — «снова работает».
   — код из письма записывается в базу только ПОСЛЕ того, как письмо принято сервером: неудачная повторная отправка
     больше не отменяет код, который уже лежит у человека в почте. */
import { maskEmails, NOT_CONFIGURED } from './mailer.mjs';

export const KIND_TEXT = {
  net: 'нет связи с почтовым сервером (сеть, DNS или закрытый порт)',
  temp: 'почтовый сервер временно отказывает',
  auth: 'Яндекс не принял логин или пароль приложения',
  sender: 'адрес отправителя не принадлежит ящику',
  rejected: 'письма отклоняются',
  tls: 'ошибка TLS: сертификат, часы сервера или порт',
  server: 'почтовый сервер отвечает ошибкой',
  config: 'ошибка в настройках почты (.env)',
};
/* что делать владелице — по виду сбоя */
const KIND_TODO = {
  net: 'обычно проходит само; если дольше часа — проверить порт 465 и DNS на сервере',
  temp: 'обычно проходит само в течение часа',
  auth: 'создать новый пароль приложения под этим ящиком в id.yandex.ru и запустить set-smtp.sh',
  sender: 'запустить set-smtp.sh: отправитель должен совпадать с логином ящика',
  rejected: 'проверить письма от Яндекса в самом ящике (лимит, подозрение на спам); при повторении — отдельный сервис рассылок',
  tls: 'проверить часы сервера (timedatectl) и порт в SMTP_PORT',
  server: 'посмотреть строку «SMTP:» в journalctl -u lunario-app',
  config: 'поправить SMTP_* в /opt/lunario-app/.env и перезапустить сервис',
};
const hhmm = (t) => new Date(t).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dur = (msTotal) => { const m = Math.max(1, Math.round(msTotal / 60000)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`; };

/* lastState() — последняя записанная смена состояния почты из журнала сбоев, lastAlert() — последнее оповещение о почте
   в Telegram: по ним новый процесс после перезапуска (set-smtp.sh, выкатка) понимает, что сбой был до него, и пишет
   «снова работает» — иначе кабинет навсегда показывал бы «не работает», а владелица не узнала бы о починке (ревью 16.10) */
export function createMailService({ sendMail, newCode, saveCode, logError, notifyOwner = null, lastState = () => '', lastAlert = () => '', release = '', clock = Date.now, timers = globalThis, scale = 1 }) {
  const ms = (n) => Math.max(20, Math.round(n * scale));
  const ALERT_AFTER = 600e3, REMIND_EVERY = 24 * 3600e3, REFUSALS_EVERY = 3600e3, ANOMALY_EVERY = 3600e3;
  let state = null, alertTimer = null, alerted = false, downSince = 0, refusals = 0, refusalsTimer = null, anomalyAt = -Infinity;
  const describe = (s) => s.state === 'down' ? `${KIND_TEXT[s.kind] || s.kind} — ${maskEmails(s.lastError)}` : s.state === 'off' ? (s.lastError || 'почта не настроена') : '';

  function alertText(s, reminder) {
    return [`Лунарио: вход по почте не работает${reminder ? ' — все еще' : ''} с ${hhmm(s.since)} (МСК).`,
      `Причина: ${KIND_TEXT[s.kind] || s.kind}.`, `Что делать: ${KIND_TODO[s.kind] || KIND_TODO.server}.`,
      release ? `Выпуск ${release}.` : ''].filter(Boolean).join('\n');
  }
  function armAlert() {
    if (alertTimer) timers.clearTimeout(alertTimer);
    alertTimer = timers.setTimeout(() => {
      alertTimer = null;
      const s = state.status();
      if (s.state !== 'down' && s.state !== 'off') return;
      if (notifyOwner) { notifyOwner(alertText(s, false)); alerted = true; }
      alertTimer = timers.setTimeout(armAlertTick, ms(REMIND_EVERY)); alertTimer?.unref?.();
    }, ms(ALERT_AFTER));
    alertTimer?.unref?.();
  }
  function armAlertTick() { alertTimer = null; const s = state.status(); if (s.state === 'down' || s.state === 'off') { if (notifyOwner) notifyOwner(alertText(s, true)); alertTimer = timers.setTimeout(armAlertTick, ms(REMIND_EVERY)); alertTimer?.unref?.(); } }

  /* смена состояния почты — mail-state.mjs зовет это сам */
  function onChange(s, prev) {
    if (s.state === 'ok') {
      const wasDown = prev !== 'checking' || /^почта не работает/.test(lastState() || '');   /* сбой мог быть и до перезапуска */
      console.log(wasDown ? 'SMTP: почта снова работает — вход по почте включен' : 'SMTP: авторизация прошла — вход по почте включен');
      if (wasDown) logError('mail_state', 'почта снова работает');
      if (prev === 'checking' && wasDown && notifyOwner && /не работает/.test(lastAlert() || '')) notifyOwner('Лунарио: вход по почте снова работает (после перезапуска сервиса).');
      if (alertTimer) { timers.clearTimeout(alertTimer); alertTimer = null; }
      if (alerted && notifyOwner) notifyOwner(`Лунарио: вход по почте снова работает. Не работал ${dur(clock() - downSince)}.`);
      alerted = false; downSince = 0;
      return;
    }
    const text = describe(s);
    if (!downSince) downSince = s.since;
    if (s.state === 'off') console.log(s.lastError === NOT_CONFIGURED ? 'SMTP: не настроен — вход по почте скрыт' : `SMTP: ошибка в настройках — вход по почте скрыт (${text})`);
    else console.log(`SMTP: почта не работает — ${text}; повтор через ${s.nextCheckAt ? Math.max(1, Math.ceil((s.nextCheckAt - clock()) / 1000)) : '—'} с`);
    /* «не настроена» без SMTP_* — обычное дело на компьютере разработчика: в журнал сбоев не пишем */
    if (!(s.state === 'off' && s.lastError === NOT_CONFIGURED)) logError('mail_state', `почта не работает: ${s.state === 'off' ? text : `${s.kind}: ${maskEmails(s.lastError)}`}`);
    if (prev === 'ok' || prev === 'checking' || !alertTimer) armAlert();
  }

  /* Письма подряд отклоняются по разным адресам (mail-state.mjs): вход для всех не закрываем — отказ мог быть и делом
     адресов, — но владелица должна знать: так выглядит и ограничение ящика Яндексом. Не чаще раза в час */
  function onAnomaly(a) {
    const text = `письма отклоняются подряд: ${a.n} по ${a.domains} доменам — последнее: ${maskEmails(a.lastError)}`;
    console.log(`SMTP: ${text}`); logError('mail', text);   /* не mail_state: вход открыт, кабинет не должен показывать «не работает» */
    if (notifyOwner && clock() - anomalyAt >= ms(ANOMALY_EVERY)) {
      anomalyAt = clock();
      notifyOwner(`Лунарио: письма с кодом отклоняются подряд (${a.n} по ${a.domains} доменам). Вход по почте открыт, но коды могут не доходить.\nЧто делать: ${KIND_TODO.rejected}.`);
    }
  }

  /* отказ человеку без попытки отправки: считаем, раз в час — одна строка в журнале сбоев */
  function noteRefusal() {
    refusals++;
    if (refusalsTimer) return;
    refusalsTimer = timers.setTimeout(() => {
      refusalsTimer = null;
      if (refusals) logError('mail', `за час отказано во входе по почте: ${refusals} — почта не работала`);
      refusals = 0;
    }, ms(REFUSALS_EVERY));
    refusalsTimer?.unref?.();
  }

  /* Записать код, когда письмо уже принято: база занята ночной рассылкой или отчетом — две попытки повтора */
  async function saveAfterSend(email, code, purpose) {
    for (let i = 0; ; i++) {
      try { saveCode(email, code, purpose); return true; }
      catch (e) { if (i >= 2) { console.error('почта: письмо ушло, но код не записался:', e.message); logError('mail', `письмо ушло, но код не записался: ${e.message}`); return false; } }
      await new Promise((r) => timers.setTimeout(r, 200 * (i + 1)));
    }
  }
  /* Письмо с кодом: letterOf(code) → { subject, text, html }; g — решение mail-state.admit() (замок пробной попытки).
     Ответ: { ok:true } | { ok:true, uncertain:true } | { ok:false, error } — error: bad_recipient, busy, mail_down, send_failed */
  async function deliverCode(email, purpose, letterOf, g = null) {
    const code = newCode(), probe = !!(g && g.probe);
    let outcome, settled = false;
    /* исход — в состояние почты сразу, пока место в очереди SMTP еще не отдано следующему письму */
    const settle = (e) => { if (settled) return; settled = true; state.report(e, email, probe); };
    try {
      const m = letterOf(code);
      await sendMail({ to: email, subject: m.subject, text: m.text, html: m.html, gate: () => state.mayConnect(g), settle });
      outcome = null;
    } catch (e) { outcome = e || new Error('send_failed'); }
    finally { if (!settled) settle(outcome || { kind: 'busy' }); }   /* очередь занята или ошибка до разговора — замок пробы все равно отпускается */
    if (outcome === null) return (await saveAfterSend(email, code, purpose)) ? { ok: true } : { ok: false, error: 'send_failed' };
    const e = outcome, msg = maskEmails(e.message || String(e));
    if (e.kind === 'gated') return { ok: false, error: 'mail_down' };
    if (e.bodySent) {
      /* письмо передано целиком, ответа не дождались: оно могло дойти — код сохраняем, человеку говорим «могло задержаться» */
      console.error('почта: неизвестно, ушло ли письмо:', msg); logError('mail', `неизвестно, ушло ли письмо: ${msg}`);
      return (await saveAfterSend(email, code, purpose)) ? { ok: true, uncertain: true } : { ok: false, error: 'send_failed' };
    }
    console.error('почта не ушла:', msg); logError('mail', msg);
    return { ok: false, error: e.kind === 'recipient' ? 'bad_recipient' : e.kind === 'busy' ? 'busy' : 'send_failed' };
  }

  return {
    bind(s) { state = s; },
    onChange, onAnomaly, noteRefusal, deliverCode, describe,
    stop() { for (const t of [alertTimer, refusalsTimer]) if (t) timers.clearTimeout(t); alertTimer = refusalsTimer = null; },
  };
}
