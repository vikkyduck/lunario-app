#!/usr/bin/env bash
# Проверка оркестрации выпуска (ревью v114, F11) — на локальном «сервере»: deploy.sh запускается из временного клона репозитория
# в подготовленную временную папку той же машины (RUN_REMOTE="bash -c" вместо ssh, пути сервера — во временной папке, без systemd).
# Сценарии: коммит во время проверок (RELEASE = зафиксированный, не новый); чужая правка на сервере без смены RELEASE (манифест
# ловит); health не отвечает (ссылка current осталась прежней); обрыв копирования (прежний каталог не тронут).
#   bash tools/check-deploy.sh      (запускается из tools/check-all.mjs)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
CLONE="$T/clone"; SRV="$T/srv"
git clone -q "$REPO" "$CLONE"
git -C "$CLONE" config user.email check@example.test; git -C "$CLONE" config user.name check
# проверяются скрипты рабочей копии, даже незакоммиченные: в клон кладутся текущие deploy.sh, deploy-lib.sh, rollback.sh и unit-файлы
cp "$REPO/deploy.sh" "$REPO/deploy-lib.sh" "$REPO/rollback.sh" "$CLONE/"; cp "$REPO"/backend/*.service "$REPO"/backend/*.timer "$CLONE/backend/"
git -C "$CLONE" add -A; git -C "$CLONE" commit -q -m "скрипты выпуска из рабочей копии" || true
printf 'not a real db\n' > "$CLONE/backend/cities.db"   # не в git: пустой «сервер» получит его из пакета
mkdir -p "$SRV/app" "$SRV/content" "$SRV/backups"
# на «сервере» — прежняя раскладка: site/ и backend/ прямо в папке приложения, без current; первый выпуск сохраняет ее как releases/prev-<выпуск>
mkdir -p "$SRV/app/site" "$SRV/app/backend"; echo "// старый выпуск" > "$SRV/app/site/app.js"; echo "// старый сервер" > "$SRV/app/backend/server.mjs"; printf 'old1\n' > "$SRV/app/RELEASE"
# Общие подстановки: сервер — локальная папка; проверки, systemd и health — заглушки, их подменяют сценарии
export RUN_REMOTE="bash -c" APP_ROOT="$SRV/app" CONTENT_ROOT="$SRV/content" BACKUP_ROOT="$SRV/backups" INSTALL_UNITS=0 SYSTEMCTL=true
export CHECK_CMD="true" HEALTH_CMD="true"
fail() { echo "❌ check-deploy: $*"; exit 1; }
deploy() { (cd "$CLONE" && env "$@" bash deploy.sh); }   # подстановки сценария — через env, явно
cur() { readlink "$APP_ROOT/current" 2>/dev/null || echo ''; }

# ── 1. коммит во время проверок: выпускается зафиксированный коммит, а не новый ──
FIRST="$(git -C "$CLONE" rev-parse --short HEAD)"
cat > "$T/commit-during-checks.sh" <<EOF
#!/usr/bin/env bash
git -C "$CLONE" commit -q --allow-empty -m "коммит во время проверок"
EOF
chmod +x "$T/commit-during-checks.sh"
deploy CHECK_CMD="$T/commit-during-checks.sh" >"$T/log1" 2>&1 || { cat "$T/log1"; fail "первый выпуск не прошел"; }
NEWEST="$(git -C "$CLONE" rev-parse --short HEAD)"
[ "$NEWEST" != "$FIRST" ] || fail "сценарий не создал новый коммит"
[ "$(cat "$APP_ROOT/RELEASE")" = "$FIRST" ] || fail "RELEASE = $(cat "$APP_ROOT/RELEASE"), ожидался зафиксированный $FIRST (а не $NEWEST)"
[ "$(cur)" = "releases/$FIRST" ] || fail "current → $(cur), ожидался releases/$FIRST"
[ -s "$APP_ROOT/current/backend/server.mjs" ] && [ -s "$APP_ROOT/current/backend/cities.db" ] || fail "в выпуске нет server.mjs или cities.db"
grep -q "site/index.html" "$APP_ROOT/MANIFEST" || fail "манифест не записан"
[ ! -e "$APP_ROOT/.deploy.lock" ] || fail "замок не снят"
[ "$(cat "$APP_ROOT/PREVIOUS")" = "releases/prev-old1" ] && [ -s "$APP_ROOT/releases/prev-old1/backend/server.mjs" ] || fail "прежняя раскладка не сохранена как releases/prev-old1: PREVIOUS=$(cat "$APP_ROOT/PREVIOUS")"
echo "✅ коммит во время проверок: выпущен $FIRST, новый $NEWEST не попал; прежняя раскладка сохранена для отката"

# ── 2. чужая правка на сервере без смены RELEASE — манифест ловит, ссылка не меняется ──
(cd "$CLONE" && . ./deploy-lib.sh && remote_state > "$T/snapshot")
[ "$(head -1 "$T/snapshot")" = "$FIRST" ] || fail "снимок не видит RELEASE"
echo "// чужая правка на проде" >> "$APP_ROOT/current/site/app.js"
git -C "$CLONE" commit -q --allow-empty -m "второй выпуск"
SECOND="$(git -C "$CLONE" rev-parse --short HEAD)"
if deploy EXPECT_RELEASE="$FIRST" EXPECT_MANIFEST="$T/snapshot" >"$T/log2" 2>&1; then cat "$T/log2"; fail "выпуск прошел поверх чужой правки"; fi
grep -q "прод изменился" "$T/log2" || { cat "$T/log2"; fail "причина остановки не названа"; }
grep -q "site/app.js" "$T/log2" || { cat "$T/log2"; fail "измененный файл не назван"; }
[ "$(cur)" = "releases/$FIRST" ] || fail "после отказа current сдвинулась: $(cur)"
[ ! -e "$APP_ROOT/.deploy.lock" ] || fail "замок не снят после отказа"
echo "✅ чужая правка на сервере: манифест остановил выпуск, current на месте"
# правку «приняли»: новый снимок — выпуск проходит и записывает второй выпуск
(cd "$CLONE" && . ./deploy-lib.sh && remote_state > "$T/snapshot2")
deploy EXPECT_RELEASE="$FIRST" EXPECT_MANIFEST="$T/snapshot2" >"$T/log2b" 2>&1 || { cat "$T/log2b"; fail "выпуск по свежему снимку не прошел"; }
[ "$(cur)" = "releases/$SECOND" ] || fail "второй выпуск не переключен: $(cur)"
[ "$(cat "$APP_ROOT/PREVIOUS")" = "releases/$FIRST" ] || fail "PREVIOUS не записан: $(cat "$APP_ROOT/PREVIOUS")"

# ── 3. health не отвечает — ссылка current возвращается на прежний выпуск, RELEASE тоже ──
git -C "$CLONE" commit -q --allow-empty -m "третий выпуск"
THIRD="$(git -C "$CLONE" rev-parse --short HEAD)"
if deploy HEALTH_CMD="false" >"$T/log3" 2>&1; then cat "$T/log3"; fail "выпуск с мертвым health считается успешным"; fi
grep -q "откатываю" "$T/log3" || { cat "$T/log3"; fail "откат не объявлен"; }
[ "$(cur)" = "releases/$SECOND" ] || fail "после отказа health current → $(cur), ожидался releases/$SECOND"
[ "$(cat "$APP_ROOT/RELEASE")" = "$SECOND" ] || fail "RELEASE после отката: $(cat "$APP_ROOT/RELEASE")"
[ -d "$APP_ROOT/releases/$THIRD" ] || fail "каталог неудачного выпуска исчез — его можно было бы изучить"
echo "✅ health не отвечает: current вернулась на $SECOND"

# ── 4. обрыв копирования — прежний каталог не тронут, ссылка не переключена ──
cat > "$T/rsync-broken.sh" <<'EOF'
#!/usr/bin/env bash
# первая половина файлов доезжает, потом «связь рвется»
dest="${@: -1}"; src="${@: -2:1}"
if [[ "$src" == */site/ ]]; then rsync "$@"; echo "rsync: connection unexpectedly closed" >&2; exit 12; fi
rsync "$@"
EOF
chmod +x "$T/rsync-broken.sh"
BEFORE="$(cd "$APP_ROOT/current" && find site backend -type f | sort | xargs shasum -a 256 | shasum -a 256)"
git -C "$CLONE" commit -q --allow-empty -m "четвертый выпуск"
FOURTH="$(git -C "$CLONE" rev-parse --short HEAD)"
if deploy RSYNC_CMD="$T/rsync-broken.sh" >"$T/log4" 2>&1; then cat "$T/log4"; fail "выпуск с оборванным копированием считается успешным"; fi
[ "$(cur)" = "releases/$SECOND" ] || fail "после обрыва current → $(cur)"
AFTER="$(cd "$APP_ROOT/current" && find site backend -type f | sort | xargs shasum -a 256 | shasum -a 256)"
[ "$BEFORE" = "$AFTER" ] || fail "прежний каталог изменился при обрыве копирования"
[ ! -e "$APP_ROOT/.deploy.lock" ] || fail "замок не снят после обрыва"
echo "✅ обрыв копирования: прежний выпуск $SECOND не тронут"
# файлы доехали, но не те, что проверили (подмена в пути) — хеши на сервере не сходятся с манифестом, переключения нет
cat > "$T/rsync-tamper.sh" <<'EOF'
#!/usr/bin/env bash
rsync "$@"; dest="${@: -1}"; if [[ "$dest" == */site/ ]]; then echo "// подмена" >> "$dest/app.js"; fi
EOF
chmod +x "$T/rsync-tamper.sh"
if deploy RSYNC_CMD="$T/rsync-tamper.sh" >"$T/log5" 2>&1; then cat "$T/log5"; fail "подмененный файл прошел проверку манифеста"; fi
grep -q "не совпали с манифестом" "$T/log5" || { cat "$T/log5"; fail "несовпадение манифеста не названо"; }
[ "$(cur)" = "releases/$SECOND" ] || fail "после подмены current → $(cur)"
echo "✅ файлы не совпали с манифестом: переключения нет"

# ── 5. откат вручную — переключение ссылки на прежний каталог ──
(cd "$CLONE" && bash rollback.sh >"$T/log6" 2>&1) || { cat "$T/log6"; fail "rollback.sh не прошел"; }
[ "$(cur)" = "releases/$FIRST" ] || fail "rollback.sh: current → $(cur), ожидался releases/$FIRST"
[ "$(cat "$APP_ROOT/RELEASE")" = "$FIRST" ] || fail "rollback.sh: RELEASE $(cat "$APP_ROOT/RELEASE")"
(cd "$CLONE" && bash rollback.sh "$SECOND" >"$T/log7" 2>&1) || { cat "$T/log7"; fail "rollback.sh <выпуск> не прошел"; }
[ "$(cur)" = "releases/$SECOND" ] || fail "rollback.sh <выпуск>: current → $(cur)"
echo "✅ rollback.sh переключает ссылку на прежний и на названный выпуск"
echo "PASS: check-deploy — выпускается ровно проверенный коммит, чужая правка и обрыв копирования останавливают выпуск, мертвый health откатывает ссылку, rollback.sh переключает ее"
