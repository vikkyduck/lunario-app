#!/usr/bin/env bash
# lunario.online/app — деплой веб-приложения на Timeweb VDS.
# Своя папка /opt/lunario-app и свой порт 5031: с лендингом не пересекается.
set -euo pipefail
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
echo "==> site/, backend/ и content/ → /opt/lunario-app"
ssh "$SERVER" 'mkdir -p /opt/lunario-app/{site,backend,data,content}'
rsync -az --delete site/ "$SERVER:/opt/lunario-app/site/"
rsync -az --delete backend/ "$SERVER:/opt/lunario-app/backend/"
# тексты правит владелец продукта — они едут вместе с кодом
rsync -az --delete content/ "$SERVER:/opt/lunario-app/content/"
echo "==> systemd"
ssh "$SERVER" 'install -m644 /opt/lunario-app/backend/lunario-app.service /etc/systemd/system/lunario-app.service \
  && install -m644 /opt/lunario-app/backend/lunario-daily.service /etc/systemd/system/lunario-daily.service \
  && install -m644 /opt/lunario-app/backend/lunario-daily.timer /etc/systemd/system/lunario-daily.timer \
  && systemctl daemon-reload && systemctl enable lunario-app >/dev/null \
  && systemctl enable --now lunario-daily.timer >/dev/null \
  && systemctl restart lunario-app && sleep 1 \
  && printf "health: " && curl -sS http://127.0.0.1:5031/app/api/health && echo'
echo "==> проверка"
curl -sS -o /dev/null -w "https://lunario.online/app/ → %{http_code}\n" https://lunario.online/app/ || true
