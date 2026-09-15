#!/usr/bin/env bash
# lunario.online/app — деплой веб-приложения на Timeweb VDS.
# Своя папка /opt/lunario-app и свой порт 5031: с лендингом не пересекается.
set -euo pipefail
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
echo "==> проверка версии оболочки и справочника городов"
node tools/bump-version.mjs >/dev/null || { echo "❌ версии ?v= расходятся — node tools/bump-version.mjs <N>"; exit 1; }
# cities.db не в git: свежий клон без него не должен стереть серверный (rsync --delete)
if ! ssh "$SERVER" 'test -s /opt/lunario-app/backend/cities.db' && [ ! -s backend/cities.db ]; then
  echo "❌ нет backend/cities.db ни локально, ни на сервере — соберите: node tools/build-cities.mjs <дампы GeoNames>"; exit 1
fi
echo "==> site/ и backend/ → /opt/lunario-app"
ssh "$SERVER" 'mkdir -p /opt/lunario-app/{site,backend,data} /opt/lunario-content/картинки'
rsync -az --delete site/ "$SERVER:/opt/lunario-app/site/"
rsync -az --delete --exclude cities.db --exclude "*.db-wal" --exclude "*.db-shm" backend/ "$SERVER:/opt/lunario-app/backend/"
# тексты и картинки — не код: они живут в /opt/lunario-content и выкладываются отдельно, ./обновить-тексты.sh
echo "==> systemd"
ssh "$SERVER" 'install -m644 /opt/lunario-app/backend/lunario-app.service /etc/systemd/system/lunario-app.service \
  && install -m644 /opt/lunario-app/backend/lunario-daily.service /etc/systemd/system/lunario-daily.service \
  && install -m644 /opt/lunario-app/backend/lunario-daily.timer /etc/systemd/system/lunario-daily.timer \
  && mkdir -p /opt/lunario-app-backups \
  && install -m644 /dev/stdin /etc/cron.d/lunario-app-backup <<< "40 3 * * * root DATA_DIR=/opt/lunario-app/data CONTENT_DIR=/opt/lunario-content BACKUP_DIR=/opt/lunario-app-backups /usr/bin/node /opt/lunario-app/backend/backup.mjs >>/var/log/lunario-app-backup.log 2>&1" \
  && systemctl daemon-reload && systemctl enable lunario-app >/dev/null \
  && systemctl enable --now lunario-daily.timer >/dev/null && systemctl restart lunario-daily.timer \
  && systemctl restart lunario-app && sleep 1 \
  && printf "health: " && curl -sS http://127.0.0.1:5031/app/api/health && echo'
echo "==> проверка"
curl -sS -o /dev/null -w "https://lunario.online/app/ → %{http_code}\n" https://lunario.online/app/ || true
