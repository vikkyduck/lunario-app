/* Черновик не теряется: сначала на устройство, потом на сервер.

   Зачем. Сейчас несохраненная запись живет только в поле ввода. Перезагрузка, уснувший телефон, оборванная
   связь — и текста нет. Здесь он сначала ложится в хранилище браузера и только потом уходит на сервер;
   не ушел — полежит и уйдет позже, под тем же именем операции, поэтому вторая запись не появится.

   Три правила, без которых все это не имеет смысла:
   · «Сохранено на устройстве» говорим только после того, как браузер подтвердил запись (complete у транзакции),
     а не когда мы ее попросили. Иначе обещание ложное, и человек спокойно закроет вкладку.
   · У операции есть имя (operationId), и при повторах оно не меняется. Правка текста — это НОВАЯ операция:
     иначе потерянный ответ и повтор молча подменили бы смысл уже принятого действия.
   · Перед каждой отправкой спрашиваем сервер, кто мы сейчас. Человек мог выйти и войти другим — чужой черновик
     отправлять нельзя, лучше подождать.

   Про шифрование честно. Записи лежат зашифрованными ключом AES-GCM, который создан этим браузером и помечен
   неизвлекаемым: его байтов в JavaScript не существует, скопировать ключ нельзя. От чего это НЕ защищает —
   от кода, уже выполняющегося на странице приложения (он просто попросит расшифровать), и от того, кто сидит
   за разблокированным устройством. Это защита от случайного чтения файлов профиля, а не сейф. Настоящий сейф
   требует пароля от человека, а значит — отдельного разговора о том, что делать, если пароль забыт. Для
   черновиков, которые живут до первой удачной отправки, такой размен разумен; для долгого хранения — нет.

   Подключение — одной строкой, см. docs/черновики-и-очередь.md. */
(function () {
  const API = '/app/api';
  const DB_NAME = 'lunario-sync', DB_VERSION = 1, OPS = 'ops', META = 'meta';
  const MAX_ATTEMPTS = 5, TIMEOUT_MS = 12000;

  class ApiError extends Error {
    constructor(code, status = 0, retryable = false, retryAfterMs = 0) {
      super(code); Object.assign(this, { code, status, retryable, retryAfterMs });
    }
  }

  /* Запрос к серверу. HTTP 200 с HTML или обрывком JSON — ошибка протокола, а не успех: так выглядят
     страница-заглушка гостиничного Wi-Fi и старый service worker, отдавший оболочку вместо ответа API. */
  async function apiJson(path, body, { timeoutMs = TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(API + path, {
        method: body === undefined ? 'GET' : 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Tz': (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })() }, signal: controller.signal,
      });
      let data = null, parsed = true;
      try { data = await r.json(); } catch { parsed = false; }
      if (!r.ok) {
        const h = r.headers.get('Retry-After');
        const wait = h == null ? 0 : /^\d+$/.test(h) ? Number(h) * 1000 : Math.max(0, Date.parse(h) - Date.now()) || 0;
        /* сервер сам говорит, стоит ли повторять; не сказал — повторяем только заведомо временные ответы */
        const retryable = data && data.retryable !== undefined ? !!data.retryable : [408, 429, 502, 503, 504].includes(r.status);
        throw new ApiError((data && data.error) || 'server_error', r.status, retryable, wait);
      }
      if (!parsed || !data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('bad_response', r.status);
      return data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(controller.signal.aborted ? 'timeout' : 'network', 0, true);
    } finally { clearTimeout(timer); }
  }

  /* ── хранилище на устройстве ── */
  let dbPromise = null;
  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!self.indexedDB) { reject(new ApiError('no_local_storage')); return; }
      let req; try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { reject(new ApiError('no_local_storage')); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OPS)) db.createObjectStore(OPS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      };
      /* другая вкладка держит прежнюю версию — это чинится закрытием вкладки, а не удалением базы с черновиками */
      req.onblocked = () => reject(new ApiError('local_blocked'));
      req.onerror = () => reject(new ApiError('no_local_storage'));
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { try { db.close(); } catch {} dbPromise = null; };
        resolve(db);
      };
    }).catch((e) => { dbPromise = null; throw e; });
    return dbPromise;
  }
  /* Обещание выполняется только на complete: до него браузер ничего не гарантирует, и говорить «сохранено» рано. */
  function run(store, mode, work) {
    return open().then((db) => new Promise((resolve, reject) => {
      let tx, out;
      try {
        tx = db.transaction(store, mode);
        tx.oncomplete = () => resolve(out);
        tx.onabort = () => reject(new ApiError('local_save_failed'));
        tx.onerror = () => {};   /* о провале сообщает abort */
        const req = work(tx.objectStore(store));
        if (req) req.onsuccess = () => { out = req.result; };
      } catch { try { if (tx) tx.abort(); } catch {} reject(new ApiError('local_save_failed')); }
    }));
  }

  /* Ключ этого браузера. Неизвлекаемый: лежит в том же хранилище, но прочитать его байты нельзя. */
  async function getKey() {
    const saved = await run(META, 'readonly', (s) => s.get('key'));
    if (saved) return saved;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await run(META, 'readwrite', (s) => s.put(key, 'key'));
    return key;
  }
  /* Владелец и имя операции подмешаны в шифрование: запись, переписанную на другого владельца, не расшифровать. */
  const aad = (owner, id) => new TextEncoder().encode(`${owner}:${id}`);
  async function seal(op) {
    const key = await getKey(), iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(op.accountId, op.id) }, key,
      new TextEncoder().encode(JSON.stringify(op)));
    return { id: op.id, owner: op.accountId, state: op.state, nextAttemptAt: op.nextAttemptAt, iv, cipher };
  }
  async function unseal(row) {
    const key = await getKey();
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv, additionalData: aad(row.owner, row.id) }, key, row.cipher);
    const op = JSON.parse(new TextDecoder().decode(plain));
    if (op.id !== row.id || op.accountId !== row.owner) throw new ApiError('local_identity_mismatch');
    return op;
  }
  const put = (op) => seal(op).then((row) => run(OPS, 'readwrite', (s) => s.put(row)));

  /* ── отправка ── */
  let notice = () => {};
  const backoff = (attempts) => Math.min(60000, 1000 * 2 ** Math.min(attempts, 6)) * (0.8 + Math.random() * 0.4);

  async function sendOne(op) {
    if (op.state === 'synced' || op.state === 'conflict' || op.state === 'paused') return op;
    if (op.attempts >= MAX_ATTEMPTS || op.nextAttemptAt > Date.now()) return op;
    /* попытку считаем ДО обращения к сети: иначе оборванный ответ не увеличил бы счетчик и повторы шли бы вечно */
    op = { ...op, attempts: op.attempts + 1 };
    try { await put(op); } catch { notice('Не удалось обновить черновик на устройстве. Текст не очищен.'); return op; }
    try {
      const who = await apiJson('/auth/session');
      if (who.accountId !== op.accountId) throw new ApiError('account_changed', 409);   /* человек сменился — чужое не отправляем */
      const receipt = await apiJson('/sync/journal', { operationId: op.id, accountId: op.accountId, text: op.text, kind: op.kind });
      if (!receipt.ok || receipt.operationId !== op.id || receipt.accountId !== op.accountId || !Number.isSafeInteger(receipt.itemId))
        throw new ApiError('bad_response', 200);
      const done = { ...op, state: 'synced', itemId: receipt.itemId };
      try { await put(done); } catch { notice('Запись сохранена в аккаунте; отметка на устройстве обновится позже.'); return done; }
      notice('Запись сохранена в аккаунте.');
      return done;
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('unknown');
      const state = err.status === 409 ? 'conflict' : err.retryable && op.attempts < MAX_ATTEMPTS ? 'queued' : 'paused';
      const next = { ...op, state, error: err.code, nextAttemptAt: Date.now() + Math.max(err.retryAfterMs, backoff(op.attempts)) };
      try { await put(next); } catch { notice('Не удалось обновить черновик на устройстве. Текст не очищен.'); return op; }
      notice(
        state === 'conflict' ? 'Данные требуют проверки. Черновик сохранен на устройстве.'
          : err.status === 401 ? 'Войдите снова. Черновик сохранен на устройстве.'
          : err.status === 403 ? 'Нет доступа к этому действию. Ваш текст сохранен на устройстве.'
          : state === 'queued' ? 'Связь нестабильна. Черновик сохранен на устройстве; отправим, когда появится связь.'
          : 'Отправка приостановлена. Черновик сохранен на устройстве.');
      return next;
    }
  }

  /* Работаем по очереди, а не одновременно: два параллельных прохода послали бы одно и то же дважды. */
  let chain = Promise.resolve();
  const serial = (fn) => { chain = chain.then(fn, fn); return chain; };

  async function flush(accountId) {
    const rows = await run(OPS, 'readonly', (s) => s.getAll());
    const out = [];
    for (const row of rows) {
      if (row.owner !== accountId || row.state === 'synced') continue;
      let op; try { op = await unseal(row); } catch { continue; }   /* чужую или испорченную запись не трогаем и не удаляем */
      out.push(await sendOne(op));
    }
    return out;
  }

  async function saveJournal(text, accountId, kind = '') {
    const op = { id: crypto.randomUUID(), accountId, text, kind, state: 'queued', attempts: 0, nextAttemptAt: 0, createdAt: new Date().toISOString() };
    try { await put(op); } catch {
      /* не обещаем того, чего не сделали: поле не очищаем и предлагаем скопировать текст */
      notice('Не удалось сохранить на устройстве. Не закрывайте вкладку; скопируйте текст.');
      return null;
    }
    notice('Черновик сохранен на устройстве.');
    return serial(() => sendOne(op));
  }

  const LUN_SYNC = {
    ApiError, apiJson,
    /* кому показывать сообщения о состоянии — подключается приложением */
    onNotice(fn) { notice = typeof fn === 'function' ? fn : () => {}; },
    saveJournal,
    /* вызвать при старте и при возвращении связи: разберет, что осталось в очереди этого человека */
    resume: (accountId) => serial(() => flush(accountId)),
    /* сколько операций ждет отправки — для честного статуса на экране */
    async pending(accountId) {
      const rows = await run(OPS, 'readonly', (s) => s.getAll());
      return rows.filter((r) => r.owner === accountId && r.state !== 'synced').length;
    },
  };
  /* Связь вернулась — пробуем снова. Сам по себе этот сигнал доступности сервера не доказывает: отправка все
     равно идет через обычные повторы с задержкой. */
  addEventListener('online', () => { if (LUN_SYNC.accountId) LUN_SYNC.resume(LUN_SYNC.accountId); });
  window.LUN_SYNC = LUN_SYNC;
})();
