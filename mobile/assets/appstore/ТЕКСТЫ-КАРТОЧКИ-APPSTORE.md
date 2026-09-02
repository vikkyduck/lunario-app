# App Store — карточка Лунарио

Готовые тексты для App Store Connect. Скопировать как есть; лимиты уже соблюдены.
Версия от 01.09.2026. Всё написано по реальным функциям приложения — ничего не обещаем.

---

## Основное

| Поле | Значение |
|---|---|
| Название (до 30) | `Лунарио — карта дня и дневник` |
| Подзаголовок (до 30) | `Спокойный утренний ритуал` |
| Bundle ID | `online.lunario.app` |
| SKU | `lunario-ios-1` |
| Основная категория | Lifestyle (Образ жизни) |
| Вторичная категория | Entertainment (Развлечения) |
| Язык карточки | Русский |
| Цена | Бесплатно |
| Copyright | © 2026 Уткина Виктория Викторовна |

## URL

| Поле | Значение |
|---|---|
| Privacy Policy URL | `https://lunario.online/politika` |
| Support URL | `https://lunario.online` |
| Marketing URL | `https://lunario.online` |
| Контакт для App Review | hello@lunario.online, +7 964 584 22 25 |

## Промо-текст (до 170 символов, меняется без ревью)

```
Одна карта утром, ответ на конкретный вопрос и дневник, который видите только вы. Спокойный ритуал на две минуты в день.
```

## Ключевые слова (до 100 символов, через запятую, без пробелов)

```
таро,карта дня,руны,нумерология,совместимость,дневник,настроение,гороскоп,луна,ритуал
```

## Описание

```
Лунарио — спокойный утренний ритуал на пару минут.

Каждое утро вас ждёт одна карта дня: её смысл и что с этим делать сегодня. Не простыня прогнозов — одна мысль, с которой можно прожить день.

Что внутри:
• Карта дня — 22 аркана, каждому дню свой смысл
• Прогноз дня по вашему знаку — работа, отношения, здоровье, деньги
• «Да / Нет», руна или расклад из трёх карт — ответ на конкретный вопрос
• Нумерология: число судьбы, личный год и число дня — с расчётом на виду
• Совместимость по датам рождения
• Настроение дня и итоги недели — видно, как менялись состояния
• Дневник и список желаний — записи шифруются, их видите только вы
• Серия дней — сколько дней подряд вы возвращаетесь
• Фаза Луны на сегодня

Начать просто: короткая анкета — имя и дата рождения — и карта дня уже ждёт. Ни пароля, ни регистрации не нужно. Если позже оставите почту, дневник и записи переедут на новое устройство: вместо пароля — короткий код из письма.

Записи хранятся в России и видны только вам. В любой момент можно очистить историю или удалить аккаунт прямо из приложения.

Лунарио создано для развлечения и самонаблюдения. Оно не даёт медицинских, юридических или финансовых советов и не заменяет консультацию специалиста.
```

## Скриншоты

Загружать из соседних папок (уже в нужных размерах, PNG):
- `69/` — iPhone 6.9″ (1320×2868), обязательные
- `65/` — iPhone 6.5″ (1242×2688), для старых моделей
- `raw-69/`, `raw-65/` — те же экраны без витринной рамки, запасной вариант

Порядок: 01-today → 02-ask → 03-numbers → 04-compat → 05-journal.

## Возрастной рейтинг

Анкету заполнять честно, ничего не отмечая: нет насилия, азартных игр, рекламы,
нецензурной лексики, нет неограниченного доступа в интернет (встроенного браузера нет —
внешние ссылки открываются системно). Гадания/эзотерика отдельным пунктом в анкете
не спрашиваются. Какой рейтинг анкета выдаст — такой и оставить, вручную не завышать.

## App Privacy (анкета «Конфиденциальность приложения»)

Трекинга нет (рекламных SDK нет, данные никому не передаются) — на вопрос
про Tracking отвечать «нет». Собираемые данные:

| Категория в анкете | Что это у нас | Linked to user | Tracking |
|---|---|---|---|
| Contact Info → Name | имя из анкеты | да | нет |
| Contact Info → Email Address | почта для входа по коду (необязательна) | да | нет |
| User Content → Other User-Generated Content | дневник, вопросы, желания (шифруются) | да | нет |
| Identifiers → User ID | внутренний идентификатор аккаунта | да | нет |
| Other Data → Other Data Types | дата, время и город рождения | да | нет |
| Usage Data → Product Interaction | события: тип действия, без текстов (пишутся с id аккаунта) | да | нет |

Цель сбора везде — App Functionality (и Analytics для Usage Data).

## Review Notes (заметка для проверяющего)

```
Hello! Lunario is an entertainment app in Russian: a daily tarot-style card,
short answers to user questions, numerology, a private journal and mood tracking.

How to test:
1. Open the app — tap «Сразу открыть мой день» (open my day), fill the short
   form: any name, any birth date, tick the consent checkbox. No account needed.
2. The main screen shows the card of the day — tap it to flip.
3. «Спросить» tab — type any question (10+ characters, two words) and get an answer.
4. «Я» tab — numerology, compatibility, journal, and account controls.

Notes:
• No demo account is required: all content is available in guest mode.
• Sign in with Apple is not applicable (guideline 4.8): the app has no
  third-party or social login. The only sign-in is a one-time code sent
  to the user's own e-mail, used to sync entries between devices.
• The iOS app contains no purchases, no prices and no external payment links.
• Every section visible in the app is fully functional and free: there are no
  "coming soon" placeholders and no locked or empty screens.
• Account deletion: «Я» tab → «Удалить аккаунт» (guideline 5.1.1(v)).
• Native features: daily local-notification reminder (opt-in, «Я» tab),
  haptic feedback, native share sheet, offline screen.
• All content is for entertainment and self-reflection; a disclaimer is shown
  in the profile section. The app gives no medical, legal or financial advice.
```

## Что НЕЛЬЗЯ писать в карточке (правила Apple)

- Цены, подписки, «скоро появится» — в iOS-версии этого нет.
- Обещания предсказаний, исцеления, гарантий («точно сбудется», «изменит жизнь»).
- Упоминания Android, Google Play, RuStore и внешних способов оплаты.
- Слово «бесплатно» в названии/подзаголовке (Apple не пропускает).

## Доступность по странам

На старте включить: Россия, Беларусь, Казахстан, Армения, Киргизия, Узбекистан,
Азербайджан, Грузия, Молдова, Таджикистан, Туркменистан + при желании Израиль,
ОАЭ, Турция, Сербия, Черногория (русскоязычная аудитория).
Страны ЕС на старте НЕ включать: по закону DSA для них нужен статус «трейдера»
(публикация адреса и телефона в карточке) — можно добавить позже отдельным шагом.
