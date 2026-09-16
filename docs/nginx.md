# nginx на сервере: что проверено и что добавить

Конфиг nginx живёт на сервере и в git не попадает, поэтому здесь — результат проверки снаружи
(16.09.2026, `lunario.online`, nginx/1.24.0 Ubuntu) и точные строки, которые нужно применить руками.

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

## Что добавить

### 1. HSTS — его нет

Без этого заголовка первый заход по `http://` можно перехватить и увести на подделку. Редирект от этого не спасает:
он срабатывает уже после того, как запрос ушёл открытым.

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

`preload` добавлять не нужно: он необратим на месяцы и требует, чтобы весь домен и поддомены всегда были на HTTPS.

### 2. TLS 1.3 — сервер его не согласует

Проверка выбрала TLS 1.2, принудительный TLS 1.3 отклонён. nginx 1.24 его умеет — значит, в `ssl_protocols`
он не перечислен.

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
```

### 3. X-Forwarded-For — снаружи не проверяется, а приложение на него опирается

Сервер слушает `127.0.0.1`, поэтому настоящий адрес человека он берёт **из последнего элемента**
`X-Forwarded-For`. По нему считаются лимиты на коды входа и на создание анонимных аккаунтов.
Если заголовка нет, все люди считаются одним клиентом и делят один лимит на всех — приложение напишет об этом
в журнал (`journalctl -u lunario-app | grep X-Forwarded-For`).

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
```

`$proxy_add_x_forwarded_for` дописывает адрес соединения в конец — поэтому последний элемент подделать нельзя,
а первые, присланные клиентом, приложение игнорирует.

### 4. Дублирование заголовков после выкатки

Приложение теперь само отдаёт `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options`, `Referrer-Policy` и CSP
`frame-ancestors 'self'` — чтобы защита была даже если конфиг nginx потеряется. nginx добавляет свои поверх,
и в ответе окажется два `X-Frame-Options` с разными значениями. Браузеры в этом случае применяют более строгое
(`DENY`), то есть хуже не становится, но лучше убрать дубль — одним из двух способов:

* оставить заголовки только в nginx и убрать `HTML_HEADERS` из `backend/server.mjs`; **или**
* в nginx для `location /app/` не добавлять свои `add_header`, положившись на приложение.

Рекомендую первое: nginx отдаёт заголовки и статике, которую приложение не обслуживает.

## Проверить после правок

```bash
nginx -t && systemctl reload nginx
curl -sS -D - -o /dev/null https://lunario.online/app/ | grep -iE "strict-transport|frame|nosniff|referrer"
echo | openssl s_client -connect lunario.online:443 -servername lunario.online 2>/dev/null | grep Protocol
journalctl -u lunario-app --since today | grep -i "X-Forwarded-For" || echo "адрес клиента доходит — предупреждений нет"
```

## SSH

Во время проверки SSH с рабочей машины не открывался: порт 22 принимает соединение, но обрывает обмен баннерами
(`Connection timed out during banner exchange`). Похоже на fail2ban или ограничение по адресу. Команды выше
нужно выполнить с машины, у которой доступ есть.
