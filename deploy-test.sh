#!/usr/bin/env bash
# lunario.online/app-test — тестовая копия приложения для просмотра ветки до выкладки на прод.
# Своя папка /opt/lunario-app-test, свой порт 5032, своя база; прод (/opt/lunario-app, 5031) не трогаем.
# Пути /app/ в отдаче переписывает nginx (sub_filter) — код приложения о тесте не знает.
set -euo pipefail
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
echo "==> site/ и backend/ → /opt/lunario-app-test (тексты и картинки стенд читает из общей /opt/lunario-content)"
ssh "$SERVER" 'mkdir -p /opt/lunario-app-test/{site,backend,data}'
rsync -az --delete site/ "$SERVER:/opt/lunario-app-test/site/"
rsync -az --delete backend/ "$SERVER:/opt/lunario-app-test/backend/"
echo "==> systemd"
ssh "$SERVER" 'install -m644 /opt/lunario-app-test/backend/lunario-app-test.service /etc/systemd/system/lunario-app-test.service \
  && systemctl daemon-reload && systemctl enable lunario-app-test >/dev/null \
  && systemctl restart lunario-app-test && sleep 1 \
  && printf "health: " && curl -sS http://127.0.0.1:5032/app-test/api/health && echo'
echo "==> проверка"
curl -sS -o /dev/null -w "https://lunario.online/app-test/ → %{http_code}\n" https://lunario.online/app-test/ || true
