#!/usr/bin/env bash
# Called by deploy only after the runtime, model cache and private env are provisioned.
# A separate code copy lets the worker run without access to the app's encryption key or .env.
set -euo pipefail
ROOT=/opt/lunario-rag
SRC="$(cd "$(dirname "$0")" && pwd)"
# RAG не установлен или отключен: дополнение к lunario-app с обязательным файлом памяти убрать ДО выхода — иначе systemd
# не запустит приложение, а откат выпуска не поможет: дополнение лежит вне releases/ (ревью 16.10)
if ! { [ -x /opt/lunario-rag-venv/bin/uvicorn ] && [ -f "$ROOT/service.env" ]; }; then
  if [ -f /etc/systemd/system/lunario-app.service.d/rag.conf ] && ! grep -q 'EnvironmentFile=-' /etc/systemd/system/lunario-app.service.d/rag.conf; then
    rm -f /etc/systemd/system/lunario-app.service.d/rag.conf && systemctl daemon-reload
  fi
  exit 0
fi
id lunario-rag >/dev/null
chown root:root "$ROOT" "$ROOT/service.env"
chmod 0755 "$ROOT"
chmod 0600 "$ROOT/service.env"
install -d -m 0750 -o root -g lunario-rag "$ROOT/code"
install -d -m 0700 -o lunario-rag -g lunario-rag "$ROOT/state" "$ROOT/chroma" "$ROOT/models"
install -m 0440 -o root -g lunario-rag "$SRC/service.py" "$ROOT/code/service.py"
install -m 0644 "$SRC/lunario-chroma.service" /etc/systemd/system/lunario-chroma.service
install -m 0644 "$SRC/lunario-rag.service" /etc/systemd/system/lunario-rag.service
install -d /etc/systemd/system/lunario-app.service.d
# «-» перед путем: если файл памяти удалят (например, отключая RAG), приложение все равно запустится — иначе systemd
# не поднимал бы lunario-app вовсе, и откат ссылки current не помогал бы: дополнение лежит вне выпуска (консилиум 16.10)
cat > /etc/systemd/system/lunario-app.service.d/rag.conf <<'EOF'
[Service]
EnvironmentFile=-/opt/lunario-rag/service.env
EOF
systemctl daemon-reload
systemctl enable --now lunario-chroma >/dev/null
systemctl enable lunario-rag >/dev/null
systemctl restart lunario-rag
