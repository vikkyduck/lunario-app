#!/usr/bin/env bash
# lunario.online/app — деплой веб-приложения на Timeweb VDS.
# Своя папка /opt/lunario-app и свой порт 5031: с лендингом не пересекается.
set -euo pipefail
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
echo "==> проверка версии оболочки и справочника городов"
node tools/bump-version.mjs >/dev/null || { echo "❌ версии ?v= расходятся — node tools/bump-version.mjs <N>"; exit 1; }
# обязательные проверки перед выпуском — те же, что в CI (.github/workflows/check.yml); SKIP_CHECKS=1 только для срочной правки
if [ "${SKIP_CHECKS:-}" != "1" ]; then
  echo "==> проверки перед выпуском (SKIP_CHECKS=1 — пропустить)"
  for f in backend/*.mjs tools/*.mjs; do node --check "$f" || { echo "❌ синтаксис: $f"; exit 1; }; done
  node tools/check-personal-features.mjs >/dev/null 2>&1 || { echo "❌ check-personal-features не прошёл — запустите node tools/check-personal-features.mjs"; exit 1; }
fi
# cities.db не в git: свежий клон без него не должен стереть серверный (rsync --delete)
if ! ssh "$SERVER" 'test -s /opt/lunario-app/backend/cities.db' && [ ! -s backend/cities.db ]; then
  echo "❌ нет backend/cities.db ни локально, ни на сервере — соберите: node tools/build-cities.mjs <дампы GeoNames>"; exit 1
fi
echo "==> снимок кода на сервере — для отката (bash rollback.sh)"
ssh "$SERVER" 'mkdir -p /opt/lunario-app/{site,backend,data} /opt/lunario-content/картинки /opt/lunario-app-backups \
  && cd /opt/lunario-app && if [ -e backend/server.mjs ]; then tar -czf "/opt/lunario-app-backups/code-$(date +%Y-%m-%d-%H%M%S).tar.gz" --exclude=backend/cities.db --exclude="*.db-wal" --exclude="*.db-shm" site backend; fi \
  && ls -t /opt/lunario-app-backups/code-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f'
echo "==> site/ и backend/ → /opt/lunario-app"
rsync -az --delete site/ "$SERVER:/opt/lunario-app/site/"
rsync -az --delete --exclude cities.db --exclude "*.db-wal" --exclude "*.db-shm" backend/ "$SERVER:/opt/lunario-app/backend/"
# тексты и картинки — не код: они живут в /opt/lunario-content и выкладываются отдельно, ./обновить-тексты.sh
echo "==> systemd"
ssh "$SERVER" 'install -m644 /opt/lunario-app/backend/lunario-app.service /etc/systemd/system/lunario-app.service \
  && install -m644 /opt/lunario-app/backend/lunario-daily.service /etc/systemd/system/lunario-daily.service \
  && install -m644 /opt/lunario-app/backend/lunario-daily.timer /etc/systemd/system/lunario-daily.timer \
  && mkdir -p /opt/lunario-app-backups \
  && install -m644 /dev/stdin /etc/cron.d/lunario-app-backup <<< "40 3 * * * root set -a; . /opt/lunario-app/.env 2>/dev/null; set +a; DATA_DIR=/opt/lunario-app/data CONTENT_DIR=/opt/lunario-content BACKUP_DIR=/opt/lunario-app-backups /usr/bin/node /opt/lunario-app/backend/backup.mjs >>/var/log/lunario-app-backup.log 2>&1" \
  && systemctl daemon-reload && systemctl enable lunario-app >/dev/null \
  && systemctl enable --now lunario-daily.timer >/dev/null && systemctl restart lunario-daily.timer \
  && systemctl restart lunario-app && sleep 1 \
  && printf "health: " && curl -sS http://127.0.0.1:5031/app/api/health && echo'
# готовность: миграции прошли, сервис отвечает; иначе — откат к снимку, снятому выше
ssh "$SERVER" 'for i in 1 2 3 4 5; do curl -sSf http://127.0.0.1:5031/app/api/health >/dev/null 2>&1 && exit 0; sleep 2; done; exit 1' \
  || { echo "❌ сервис не поднялся после выкатки — откатываю код: bash rollback.sh"; bash rollback.sh; exit 1; }
echo "==> проверка"
curl -sS -o /dev/null -w "https://lunario.online/app/ → %{http_code}\n" https://lunario.online/app/ || true
