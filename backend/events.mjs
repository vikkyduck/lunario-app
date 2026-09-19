/* Реестр событий продукта — один источник для трех потребителей:
   · сервер — какие ключи принимать от браузера (/api/event) и какие писать сам;
   · отчеты кабинета — названия, разделы и список «содержательных действий» (DAU/WAU/MAU, активация, возвраты);
   · аналитика — тип и короткая деталь, без личных текстов.

   source: 'server' — событие пишет обработчик операции, когда результат подтвержден (запись сохранена, карта вытянута);
           'client' — впечатление интерфейса (открыл экран, поделился), приходит через /api/event.
   core:   содержательное действие — по нему считаются активность, активация и возвраты.
   section/title: строка в отчете «Функции»; событие без раздела в таблицу функций не попадает. */
const E = (key, name, source, o = {}) => ({ key, name, source, core: !!o.core, section: o.section || '', title: o.title || '' });

export const EVENTS = [
  E('app_open', 'Открыл приложение', 'client'),
  E('intro_view', 'Показ приветствия', 'client'),
  E('login_open', 'Открыл вход по почте', 'client'),
  E('login_code_sent', 'Запросил код', 'client'),
  E('login_done', 'Подтвердил почту', 'client'),
  E('onboard_start', 'Начал анкету', 'client'),
  E('onboard_done', 'Заполнил анкету', 'server'),
  E('card_open', 'Открыл карту дня', 'server', { core: true, section: 'Сегодня', title: 'Карта дня' }),
  E('dayrune_open', 'Открыл руну дня', 'server', { core: true, section: 'Сегодня', title: 'Руна дня' }),
  E('card_draw', 'Карта дня вытянута утром сама', 'server'),
  E('dayrune_draw', 'Руна дня вытянута утром сама', 'server'),
  E('mood_set', 'Отметил настроение', 'server', { core: true, section: 'Сегодня', title: 'Настроение дня' }),
  E('forecast_view', 'Открыл прогноз дня', 'client', { core: true, section: 'Сегодня', title: 'Прогноз дня' }),
  E('answer_add', 'Ответил на вопрос дня', 'server', { core: true, section: 'Сегодня', title: 'Вопрос дня' }),
  E('thought_save', 'Записал мысль к карте, руне или раскладу', 'server', { core: true, section: 'Сегодня', title: 'Мысль к материалу' }),
  E('habit_add', 'Добавил привычку', 'server', { core: true, section: 'Сегодня', title: 'Дневник привычек' }),
  E('habit_mark', 'Отметил привычку', 'server', { core: true }),
  E('askesis_start', 'Взял аскезу', 'server', { core: true, section: 'Сегодня', title: 'Взять аскезу' }),
  E('askesis_mark', 'Записал наблюдение аскезы', 'server', { core: true }),
  E('day_save', 'Запомнил день', 'server', { core: true, section: 'Дневник', title: 'Запомнить этот день' }),
  E('lunar_view', 'Открыл лунный день', 'client', { core: true, section: 'Луна и небо', title: 'Лунный день' }),
  E('lunar_expand', 'Развернул раздел лунного дня', 'client'),
  E('topics_set', 'Выбрал темы чтения', 'client'),
  E('tools_add', 'Добавил инструмент', 'client'),
  E('morning_add', 'Выбрал плитку утра', 'client'),
  E('rhythm_view', 'Увидел экран напоминаний (после первого дня или из Аккаунта)', 'client'),
  E('push_open', 'Пришел из уведомления', 'client'),
  E('morning_edit', 'Развернул выбор утра', 'client'),
  E('skin_compact_on', 'Включил компактный вид (тест)', 'client'),
  E('skin_compact_off', 'Выключил компактный вид (тест)', 'client'),
  E('rhythm_enable', 'Включил напоминания после анкеты', 'client'),
  E('morning_remove', 'Убрал плитку утра', 'client'),
  E('tools_remove', 'Убрал инструмент с экрана', 'client'),
  E('topics_all', 'Переключил «показать все»', 'client'),
  E('sky_view', 'Открыл «На небе»', 'client', { core: true, section: 'Луна и небо', title: 'На небе' }),
  E('worry_pick', 'Разобрал вопрос', 'client', { core: true, section: 'Свериться с собой', title: 'Ответить себе на вопрос' }),
  E('ask_yesno', 'Спросил «Да / Нет»', 'server', { core: true, section: 'Свериться с собой', title: 'Да / Нет' }),
  E('ask_rune', 'Вытянул руну', 'server', { core: true, section: 'Свериться с собой', title: 'Руны' }),
  E('ask_spread', 'Сделал расклад', 'server', { core: true, section: 'Свериться с собой', title: 'Таро' }),
  E('journal_add', 'Сделал запись', 'server', { core: true, section: 'Дневник', title: 'Дневник' }),
  E('gratitude_add', 'Записал благодарность', 'server', { core: true, section: 'Дневник', title: 'Дневник благодарности' }),
  E('wish_add', 'Добавил желание', 'server', { core: true, section: 'Дневник', title: 'Мои желания' }),
  E('wish_photo', 'Добавил фото к желанию', 'server'),
  E('moodreport_view', 'Открыл отчет по настроениям', 'client', { core: true, section: 'Дневник', title: 'История настроений' }),
  E('week_view', 'Открыл «Мою неделю»', 'server', { core: true, section: 'Дневник', title: 'Моя неделя' }),
  E('week_echo', 'Отметил, отозвалось ли утро', 'server'),
  E('week_reflect', 'Записал рефлексию недели', 'server', { core: true }),
  E('natal_view', 'Открыл натальную карту', 'server', { core: true, section: 'Обо мне', title: 'Натальная карта' }),
  E('compat_calc', 'Посчитал совместимость', 'server', { core: true, section: 'Обо мне', title: 'Совместимость' }),
  E('photo_set', 'Загрузил фото профиля', 'server'),
  E('share_card', 'Поделился результатом', 'client', { section: 'Социальное', title: 'Поделиться' }),
  E('card_download', 'Скачал открытку', 'client', { section: 'Социальное', title: 'Открытка на телефон' }),
  E('invite_copy', 'Скопировал приглашение', 'client', { section: 'Социальное', title: 'Позвать подругу' }),
  E('invite_share', 'Поделился приглашением', 'client'),   /* деталь — откуда: invite, compat, install */
  E('invite_used', 'Пришел по приглашению', 'server'),   /* деталь — id пригласившей; пишет POST /api/invite */
  E('reminder_on', 'Включил напоминание', 'server', { section: 'Аккаунт', title: 'Уведомления' }),
  E('reminder_off', 'Выключил напоминание', 'server'),
  E('reminder_test', 'Прислал пробное напоминание', 'server'),
  E('push_on', 'Подключил устройство к уведомлениям', 'server'),
  E('day_open', 'Открыл прошлый день', 'client', { section: 'Дневник', title: 'Прошлые дни' }),
  E('day_photo', 'Добавил фото дня', 'server', { core: true, section: 'Дневник', title: 'Фото дня' }),
  E('day_remove', 'Убрал запись из дня', 'server'),
  E('bridge_view', 'Увидел «мост» из прошлого', 'client'),
  E('tool_offer_show', 'Увидел предложение шага вечера', 'client'),   /* деталь — ключ шага; предложения — после сохранения дня */
  E('tool_offer_accept', 'Добавил шаг вечера из предложения', 'client', { section: 'Дневник', title: 'Шаги вечера' }),
  E('tool_offer_dismiss', 'Отложил предложение шага', 'client'),
  E('install_prompt', 'Увидел «Установить»', 'client'),
  E('installed', 'Установил на телефон', 'client', { section: 'Аккаунт', title: 'Установка на телефон' }),
  E('support_new', 'Написал в поддержку', 'server', { section: 'Аккаунт', title: 'Чат поддержки' }),
  E('news_view', 'Открыл «Новое в приложении»', 'client'),
  E('utm_seen', 'Пришел с UTM-меткой', 'server'),
];

export const EVENT_BY_KEY = Object.fromEntries(EVENTS.map((e) => [e.key, e]));
/* Что принимает /api/event: только впечатления интерфейса. Подтвержденные действия пишет сам обработчик. */
export const CLIENT_EVENTS = new Set(EVENTS.filter((e) => e.source === 'client').map((e) => e.key));
/* Содержательные действия — для активности, активации и возвратов */
export const CORE_EVENTS = EVENTS.filter((e) => e.core).map((e) => e.key);
export const EVENT_NAMES = Object.fromEntries(EVENTS.map((e) => [e.key, e.name]));
/* Строки отчета «Функции»: ключ, раздел, название */
export const FEATURE_EVENTS = EVENTS.filter((e) => e.section);
