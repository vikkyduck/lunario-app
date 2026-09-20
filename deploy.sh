#!/usr/bin/env bash
# lunario.online/app — деплой веб-приложения на Timeweb VDS. Своя папка /opt/lunario-app и свой порт 5031: с лендингом не пересекается.
#
# Один процесс (ревью v114, F11), порядок команд:
#   1. зафиксировать коммит и собрать из него пакет (git archive) — дальше все работает с $COMMIT и $PKG, не с рабочей копией;
#   2. проверить сам пакет (tools/check-all.mjs внутри $PKG; контент и Playwright — ссылками из репозитория);
#   3. посчитать манифест источника; под замком на сервере сверить RELEASE и живой манифест прода со снимком (deploy-safe.sh);
#   4. выложить в новый каталог releases/<выпуск>, сверить хеши на сервере, переключить ссылку current, перезапустить, дождаться health;
#   5. любая ошибка после переключения — откат ссылки на прежний каталог одним обработчиком; прежний выпуск остается нетронутым.
# Переменные для проверки tools/check-deploy.sh: RUN_REMOTE, APP_ROOT, CONTENT_ROOT, BACKUP_ROOT, CHECK_CMD, RSYNC_CMD, HEALTH_CMD, INSTALL_UNITS
set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"; cd "$REPO"
# shellcheck source=deploy-lib.sh
. "$REPO/deploy-lib.sh"
KEEP_RELEASES=5
CHECK_CMD="${CHECK_CMD:-node tools/check-all.mjs}"
RSYNC_CMD="${RSYNC_CMD:-rsync}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
INSTALL_UNITS="${INSTALL_UNITS:-1}"   # 0 — без systemd и прав (локальная проверка)

# ── 1. коммит зафиксирован, пакет — из него ──
if [ -n "$(git status --porcelain --untracked-files=no)" ] && [ "${ALLOW_DIRTY:-}" != "1" ]; then
  echo "❌ в рабочей копии есть незакоммиченные правки — сначала commit (ALLOW_DIRTY=1 — выпустить как есть)"; git status --short | head -20; exit 1
fi
COMMIT="$(git rev-parse HEAD)"; RELEASE="$(git rev-parse --short "$COMMIT")"
DIRTY=0; if [ "${ALLOW_DIRTY:-}" = "1" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then DIRTY=1; RELEASE="$RELEASE-dirty"; fi
echo "==> выпуск $RELEASE (коммит $COMMIT)"
PKG="$(mktemp -d)"; LOCKED=0
cleanup() { rm -rf "$PKG"; if [ "$LOCKED" = 1 ]; then remote "rmdir $APP_ROOT/.deploy.lock 2>/dev/null" || true; fi; }
trap cleanup EXIT
if [ "$DIRTY" = 1 ]; then mkdir -p "$PKG/site" "$PKG/backend" "$PKG/tools"; cp -R site/. "$PKG/site/"; cp -R backend/. "$PKG/backend/"; cp -R tools/. "$PKG/tools/"; cp package.json package-lock.json "$PKG/"; [ -d .github ] && cp -R .github "$PKG/" || true
else git archive --format=tar "$COMMIT" site backend tools package.json package-lock.json .github | tar -x -C "$PKG"; fi
[ -s backend/cities.db ] && cp backend/cities.db "$PKG/backend/cities.db" || true   # не в git; в пакете — на случай пустого сервера

# ── 2. проверки — над пакетом, не над рабочей копией: коммит во время проверок не подменит проверенный код ──
ln -s "$REPO/content" "$PKG/content"; [ -d "$REPO/node_modules" ] && ln -s "$REPO/node_modules" "$PKG/node_modules" || true
echo "==> проверка версии оболочки"
(cd "$PKG" && node tools/bump-version.mjs >/dev/null) || { echo "❌ версии ?v= расходятся — node tools/bump-version.mjs <N>"; exit 1; }
if [ "${SKIP_CHECKS:-}" != "1" ]; then
  echo "==> проверки перед выпуском — над пакетом (SKIP_CHECKS=1 — пропустить)"
  (cd "$PKG" && LUNARIO_REPO="$REPO" $CHECK_CMD) || { echo "❌ проверки не прошли — выпуск остановлен (подробности выше)"; exit 1; }   # LUNARIO_REPO — для check-deploy: в пакете нет .git
fi
rm -f "$PKG/content" "$PKG/node_modules"

# ── 3. манифест источника и сверка прода под замком ──
(cd "$PKG" && bash -c "$MANIFEST_FIND" > "$PKG/MANIFEST"); echo "$RELEASE" > "$PKG/RELEASE"
echo "==> манифест: $(wc -l < "$PKG/MANIFEST" | tr -d ' ') файлов"
remote "mkdir -p $APP_ROOT && mkdir $APP_ROOT/.deploy.lock 2>/dev/null" || { echo "❌ на сервере уже идет выкатка ($APP_ROOT/.deploy.lock) — подождите или снимите замок вручную"; exit 1; }
LOCKED=1
LIVE="$(remote "cat $APP_ROOT/RELEASE 2>/dev/null || echo unknown")"
if [ -n "${EXPECT_RELEASE:-}" ] && [ "$LIVE" != "$EXPECT_RELEASE" ]; then echo "❌ на сервере уже другой выпуск ($LIVE, ожидался $EXPECT_RELEASE) — сверьте снимок заново: bash deploy-safe.sh"; exit 1; fi
if [ -n "${EXPECT_MANIFEST:-}" ]; then
  [ -s "$EXPECT_MANIFEST" ] || { echo "❌ нет снимка $EXPECT_MANIFEST — сначала: bash deploy-safe.sh snapshot"; exit 1; }
  STATE="$(mktemp)"; remote_state > "$STATE"
  if ! cmp -s "$STATE" "$EXPECT_MANIFEST"; then
    echo "❌ прод изменился с момента снимка ($(head -1 "$EXPECT_MANIFEST") → $(head -1 "$STATE")) — на сервере есть правки, которых нет в снимке:"
    diff <(tail -n +2 "$EXPECT_MANIFEST") <(tail -n +2 "$STATE") | grep '^>' | awk '{print "  изменен: " $3}' | head -40 || true
    rm -f "$STATE"; exit 1
  fi
  rm -f "$STATE"; echo "==> прод совпадает со снимком ($LIVE) — чужой работы не затрем"
fi
# cities.db не в git: свежий сервер получит его из пакета, обычный — из прежнего выпуска
if ! remote "test -s $APP_ROOT/current/backend/cities.db || test -s $APP_ROOT/backend/cities.db" && [ ! -s "$PKG/backend/cities.db" ]; then
  echo "❌ нет backend/cities.db ни локально, ни на сервере — соберите: node tools/build-cities.mjs <дампы GeoNames>"; exit 1
fi

# ── 4. новый каталог выпуска; прежняя раскладка (site/ и backend/ прямо в $APP_ROOT) один раз становится releases/prev-<выпуск> ──
REL="$APP_ROOT/releases/$RELEASE"
remote "mkdir -p $APP_ROOT/releases $APP_ROOT/data $CONTENT_ROOT/картинки $BACKUP_ROOT \
  && if [ ! -e $APP_ROOT/current ] && [ -e $APP_ROOT/backend/server.mjs ]; then mkdir -p $APP_ROOT/releases/prev-$LIVE && cp -a $APP_ROOT/site $APP_ROOT/backend $APP_ROOT/releases/prev-$LIVE/ && ln -sfn releases/prev-$LIVE $APP_ROOT/current; fi \
  && mkdir -p $REL/site $REL/backend"
echo "==> site/ и backend/ → $REL"
$RSYNC_CMD -az --delete "$PKG/site/" "$(dest "$REL/site/")"
$RSYNC_CMD -az --delete --exclude cities.db --exclude "*.db-wal" --exclude "*.db-shm" "$PKG/backend/" "$(dest "$REL/backend/")"
$RSYNC_CMD -az "$PKG/RELEASE" "$PKG/MANIFEST" "$(dest "$REL/")"
if remote "test -s $APP_ROOT/current/backend/cities.db"; then remote "test -s $REL/backend/cities.db || cp -p $APP_ROOT/current/backend/cities.db $REL/backend/cities.db"
else $RSYNC_CMD -az "$PKG/backend/cities.db" "$(dest "$REL/backend/cities.db")"; fi
# то, что доехало, — ровно то, что проверили: хеши на сервере сверяются с манифестом пакета; обрыв копирования не пройдет дальше
remote "cd $REL && bash -c '$SHA_CMD' sha -c --quiet MANIFEST 2>/dev/null || (cd $REL && bash -c '$SHA_CMD' sha -c MANIFEST | grep -v ': OK$' | head -20; exit 1)" \
  || { echo "❌ файлы на сервере не совпали с манифестом пакета — выпуск не переключен, прежний работает"; exit 1; }

# ── 5. переключить, перезапустить, дождаться health — один обработчик; иначе откат ссылки ──
PREV="$(remote "readlink $APP_ROOT/current 2>/dev/null || echo ''")"
PREV_OF_PREV="$(remote "cat $APP_ROOT/PREVIOUS 2>/dev/null || echo ''")"   # при откате PREVIOUS возвращается к прежнему значению
finish_or_rollback() {
  # повторный выпуск той же версии не делает ее «прежней» для отката — PREVIOUS остается на настоящем прежнем каталоге
  if [ "$PREV" = "releases/$RELEASE" ]; then remote "cd $APP_ROOT && ln -sfn releases/$RELEASE current && cp $REL/RELEASE RELEASE && cp $REL/MANIFEST MANIFEST" || return 1
  else remote "cd $APP_ROOT && ln -sfn releases/$RELEASE current && echo '$PREV' > PREVIOUS && cp $REL/RELEASE RELEASE && cp $REL/MANIFEST MANIFEST" || return 1; fi
  if [ "$INSTALL_UNITS" = 1 ]; then
    # сервис работает не от root (ревью v114, F02): пользователь lunario и права — backend/service-user.sh; rsync от root сбросил владельцев
    remote "bash $APP_ROOT/current/backend/service-user.sh $APP_ROOT $CONTENT_ROOT $BACKUP_ROOT" || return 1
    remote "install -m644 $APP_ROOT/current/backend/lunario-app.service /etc/systemd/system/lunario-app.service \
      && install -m644 $APP_ROOT/current/backend/lunario-daily.service /etc/systemd/system/lunario-daily.service \
      && install -m644 $APP_ROOT/current/backend/lunario-daily.timer /etc/systemd/system/lunario-daily.timer \
      && install -m644 $APP_ROOT/current/backend/lunario-backup.service /etc/systemd/system/lunario-backup.service \
      && install -m644 $APP_ROOT/current/backend/lunario-backup.timer /etc/systemd/system/lunario-backup.timer \
      && rm -f /etc/cron.d/lunario-app-backup \
      && $SYSTEMCTL daemon-reload && $SYSTEMCTL enable lunario-app >/dev/null \
      && $SYSTEMCTL enable --now lunario-daily.timer >/dev/null && $SYSTEMCTL restart lunario-daily.timer \
      && $SYSTEMCTL enable --now lunario-backup.timer >/dev/null \
      && $SYSTEMCTL restart lunario-app" || return 1
  fi
  # готовность: миграции прошли, сервис отвечает
  if [ -n "${HEALTH_CMD:-}" ]; then $HEALTH_CMD || return 1
  else remote "for i in 1 2 3 4 5 6 7 8; do curl -sSf $HEALTH_URL >/dev/null 2>&1 && exit 0; sleep 2; done; exit 1" || return 1; fi
  return 0
}
rollback() {
  echo "❌ сервис не поднялся после выкатки — откатываю ссылку current на прежний выпуск ($PREV)"
  if [ -z "$PREV" ]; then echo "   прежнего выпуска нет — ссылка current убрана"; remote "rm -f $APP_ROOT/current $APP_ROOT/RELEASE $APP_ROOT/MANIFEST" || true; return; fi
  remote "cd $APP_ROOT && ln -sfn $PREV current && echo '$PREV_OF_PREV' > PREVIOUS && (cp $PREV/RELEASE RELEASE 2>/dev/null || echo '$LIVE' > RELEASE) && (cp $PREV/MANIFEST MANIFEST 2>/dev/null || true)" || true
  if [ "$INSTALL_UNITS" = 1 ]; then remote "$SYSTEMCTL restart lunario-app; sleep 1; printf 'health: '; curl -sS $HEALTH_URL; echo" || true; fi
}
if ! finish_or_rollback; then rollback; exit 1; fi
echo "==> выпуск $RELEASE работает"
# хранить пять последних каталогов, не трогая текущий и прежний
remote "cd $APP_ROOT/releases && ls -t | grep -v -x -e '$RELEASE' -e \"\$(basename \"\$(readlink $APP_ROOT/current)\")\" -e \"\$(basename \"$PREV\")\" | tail -n +$((KEEP_RELEASES - 1)) | while read -r d; do [ -n \"\$d\" ] && rm -rf \"\$d\"; done" || true
echo "==> проверка"
if [ -z "${RUN_REMOTE:-}" ]; then curl -sS -o /dev/null -w "https://lunario.online/app/ → %{http_code}\n" https://lunario.online/app/ || true; fi
