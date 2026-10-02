#!/usr/bin/env bash
# Called by deploy only after the runtime, model cache and private env are provisioned.
# A separate code copy lets the worker run without access to the app's encryption key or .env.
set -euo pipefail
ROOT=/opt/lunario-rag
SRC="$(cd "$(dirname "$0")" && pwd)"
[ -x /opt/lunario-rag-venv/bin/uvicorn ] && [ -f "$ROOT/service.env" ] || exit 0
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
cat > /etc/systemd/system/lunario-app.service.d/rag.conf <<'EOF'
[Service]
EnvironmentFile=/opt/lunario-rag/service.env
EOF
systemctl daemon-reload
systemctl enable --now lunario-chroma >/dev/null
systemctl enable lunario-rag >/dev/null
systemctl restart lunario-rag
