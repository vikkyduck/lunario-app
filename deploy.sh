#!/usr/bin/env bash
# lunario.online/app — деплой веб-приложения на Timeweb VDS.
# Своя папка /opt/lunario-app и свой порт 5031: с лендингом не пересекается.
set -euo pipefail
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
echo "==> проверка версии оболочки и справочника городов"
node tools/bump-version.mjs >/dev/null || { echo "❌ версии ?v= расходятся — node tools/bump-version.mjs <N>"; exit 1; }
# обязательные проверки перед выпуском — один набор с CI (tools/check-all.mjs, аудит v98 F21); SKIP_CHECKS=1 только для срочной правки
if [ "${SKIP_CHECKS:-}" != "1" ]; then
  echo "==> проверки перед выпуском (SKIP_CHECKS=1 — пропустить)"
  node tools/check-all.mjs || { echo "❌ проверки не прошли — выпуск остановлен (подробности выше)"; exit 1; }
fi
# выпуск собирается из зафиксированного коммита, а не из меняющейся рабочей копии (аудит v98 F22): незакоммиченные правки — стоп
if [ -n "$(git status --porcelain --untracked-files=no)" ] && [ "${ALLOW_DIRTY:-}" != "1" ]; then
  echo "❌ в рабочей копии есть незакоммиченные правки — сначала commit (ALLOW_DIRTY=1 — выпустить как есть)"; git status --short | head -20; exit 1
fi
RELEASE="$(git rev-parse --short HEAD)"; if [ -n "$(git status --porcelain --untracked-files=no)" ]; then RELEASE="$RELEASE-dirty"; fi
echo "==> выпуск $RELEASE"
# пакет выпуска — из самого коммита, в отдельный каталог (повторный аудит v112, R14): правка рабочей копии после начала выкатки
# в пакет не попадает; ALLOW_DIRTY=1 — из рабочей копии как есть (и RELEASE помечен -dirty)
PKG="$(mktemp -d)"; trap 'rm -rf "$PKG"' EXIT
if [ "${ALLOW_DIRTY:-}" = "1" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then mkdir -p "$PKG/site" "$PKG/backend"; cp -R site/. "$PKG/site/"; cp -R backend/. "$PKG/backend/"
else git archive --format=tar HEAD site backend | tar -x -C "$PKG"; fi
[ -s backend/cities.db ] && cp backend/cities.db "$PKG/backend/cities.db" || true
# cities.db не в git: свежий клон без него не должен стереть серверный (rsync --delete)
if ! ssh "$SERVER" 'test -s /opt/lunario-app/backend/cities.db' && [ ! -s backend/cities.db ]; then
  echo "❌ нет backend/cities.db ни локально, ни на сервере — соберите: node tools/build-cities.mjs <дампы GeoNames>"; exit 1
fi
# одна выкатка за раз: замок на сервере (снимается при любом выходе); перед заменой — сверка, что прод все еще тот, что видели
ssh "$SERVER" 'mkdir -p /opt/lunario-app && mkdir /opt/lunario-app/.deploy.lock 2>/dev/null' || { echo "❌ на сервере уже идет выкатка (/opt/lunario-app/.deploy.lock) — подождите или снимите замок вручную"; exit 1; }
trap 'rm -rf "$PKG"; ssh "$SERVER" "rmdir /opt/lunario-app/.deploy.lock 2>/dev/null" || true' EXIT
if [ -n "${EXPECT_RELEASE:-}" ]; then
  LIVE="$(ssh "$SERVER" 'cat /opt/lunario-app/RELEASE 2>/dev/null || echo unknown')"
  [ "$LIVE" = "$EXPECT_RELEASE" ] || { echo "❌ на сервере уже другой выпуск ($LIVE, ожидался $EXPECT_RELEASE) — сверьте снимок заново: bash deploy-safe.sh"; exit 1; }
fi
echo "==> снимок кода на сервере — для отката (bash rollback.sh)"
ssh "$SERVER" 'mkdir -p /opt/lunario-app/{site,backend,data} /opt/lunario-content/картинки /opt/lunario-app-backups \
  && cd /opt/lunario-app && if [ -e backend/server.mjs ]; then tar -czf "/opt/lunario-app-backups/code-$(date +%Y-%m-%d-%H%M%S).tar.gz" --exclude=backend/cities.db --exclude="*.db-wal" --exclude="*.db-shm" site backend; fi \
  && ls -t /opt/lunario-app-backups/code-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f'
echo "==> site/ и backend/ → /opt/lunario-app"
rsync -az --delete "$PKG/site/" "$SERVER:/opt/lunario-app/site/"
rsync -az --delete --exclude cities.db --exclude "*.db-wal" --exclude "*.db-shm" "$PKG/backend/" "$SERVER:/opt/lunario-app/backend/"
# идентификатор выпуска и манифест хешей всех выложенных файлов — по ним deploy-safe.sh узнает чужой выпуск (F22)
ssh "$SERVER" "cd /opt/lunario-app && echo '$RELEASE' > RELEASE && find site backend -type f ! -name cities.db ! -name '*.db-wal' ! -name '*.db-shm' -print0 | sort -z | xargs -0 sha256sum > MANIFEST"
# тексты и картинки — не код: они живут в /opt/lunario-content и выкладываются отдельно, ./обновить-тексты.sh
echo "==> systemd"
ssh "$SERVER" 'install -m644 /opt/lunario-app/backend/lunario-app.service /etc/systemd/system/lunario-app.service \
  && install -m644 /opt/lunario-app/backend/lunario-daily.service /etc/systemd/system/lunario-daily.service \
  && install -m644 /opt/lunario-app/backend/lunario-daily.timer /etc/systemd/system/lunario-daily.timer \
  && install -m644 /opt/lunario-app/backend/lunario-backup.service /etc/systemd/system/lunario-backup.service \
  && install -m644 /opt/lunario-app/backend/lunario-backup.timer /etc/systemd/system/lunario-backup.timer \
  && mkdir -p /opt/lunario-app-backups \
  && rm -f /etc/cron.d/lunario-app-backup \
  && systemctl daemon-reload && systemctl enable lunario-app >/dev/null \
  && systemctl enable --now lunario-daily.timer >/dev/null && systemctl restart lunario-daily.timer \
  && systemctl enable --now lunario-backup.timer >/dev/null \
  && systemctl restart lunario-app && sleep 1 \
  && printf "health: " && curl -sS http://127.0.0.1:5031/app/api/health && echo'
# готовность: миграции прошли, сервис отвечает; иначе — откат к снимку, снятому выше
ssh "$SERVER" 'for i in 1 2 3 4 5; do curl -sSf http://127.0.0.1:5031/app/api/health >/dev/null 2>&1 && exit 0; sleep 2; done; exit 1' \
  || { echo "❌ сервис не поднялся после выкатки — откатываю код: bash rollback.sh"; bash rollback.sh; exit 1; }
echo "==> проверка"
curl -sS -o /dev/null -w "https://lunario.online/app/ → %{http_code}\n" https://lunario.online/app/ || true
