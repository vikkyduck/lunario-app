# nginx на сервере: что проверено и что добавить

Конфиг nginx живёт на сервере (`/etc/nginx/sites-enabled/lunario`) и в git не попадает. Здесь — что проверено
16.09.2026 (`lunario.online`, nginx/1.24.0 Ubuntu, node 24.13) и что при этом сделано.

## Что уже хорошо

| Проверка | Результат |
|---|---|
| `http://lunario.online/app/` | `301` на `https://` — редирект есть |
| `X-Frame-Options` | `DENY` — встроить приложение в чужой сайт нельзя |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| TLS 1.0 | отклоняется |
| Размер тела запроса | 8 МБ проходят — загрузкам кабинета (до 7 МБ) хватает |
| Сертификат | валидный, ECDSA, `ECDHE-ECDSA-CHACHA20-POLY1305` |

## Что сделано 16.09.2026

### HSTS — добавлен

Без этого заголовка первый заход по `http://` можно перехватить и увести на подделку; редирект срабатывает уже
после того, как запрос ушёл открытым. Добавлено на уровне `server` и повторено в каждом `location` со своим
`add_header` (в nginx `add_header` в location отменяет наследование — это уже было учтено в конфиге для
`nosniff` и `X-Frame-Options`). Бэкап конфига — `/root/nginx-lunario.bak-2026-09-16-101808`.

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;
```

Без `includeSubDomains`: на этом сервере несколько сайтов, и не все поддомены проверены на HTTPS. Без `preload`:
он необратим на месяцы.

### TLS 1.3 — выключен намеренно, не трогать

В `/etc/letsencrypt/options-ssl-nginx.conf`: «`ssl_protocols TLSv1.2; # 04.08.2026, эксперимент по разрешению
владельца: TLSv1.3 выключен из-за DPI-блокировки у Билайна; откат — бэкап в /root/`». Это осознанное решение
из-за провайдера у части аудитории. Снаружи это видно как «TLS 1.3 не согласуется» — так и задумано.

### X-Forwarded-For — проставляется правильно

В `location ^~ /app` стоит `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` — адрес соединения
дописывается в конец, приложение берёт последний элемент. Лимиты на коды входа и анонимные аккаунты считаются
на настоящего клиента. Если заголовок когда-нибудь пропадёт, приложение напишет в журнал:
`journalctl -u lunario-app | grep X-Forwarded-For`.

### Заголовки приложения и nginx — совпадают

nginx ставит `X-Frame-Options: DENY`; приложение с этого дня отдаёт то же `DENY` и `frame-ancestors 'none'`
(оно нигде себя не встраивает). Два одинаковых заголовка в ответе безвредны — разные заставили бы браузер
выбирать. Заголовки в приложении остаются как страховка на случай потери конфига nginx и для локального просмотра.

## Как проверить

```bash
curl -sS -D - -o /dev/null https://lunario.online/app/ | grep -iE "strict-transport|frame|nosniff|referrer|content-security"
journalctl -u lunario-app --since today | grep -i "X-Forwarded-For" || echo "адрес клиента доходит — предупреждений нет"
```

## Ещё на сервере

* `/opt/lunario-app/.env` (права 600): SMTP, `BACKUP_SECRET` (добавлен 16.09.2026 — пароль шифрования копий;
  прочитать: `grep BACKUP_SECRET /opt/lunario-app/.env`, положить в менеджер паролей) и старые `PRODAMUS_*`,
  `SUB_*` — платежи из кода убраны, строки можно удалить.
* Предел тела: `client_max_body_size 8m` в `/app` — загрузкам кабинета (до 7 МБ) хватает.
* Рядом на том же nginx живут другие сайты; правки в `sites-enabled/lunario` их не касаются, а вот
  `options-ssl-nginx.conf` и `nginx.conf` — общие.
