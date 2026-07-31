#!/usr/bin/env bash
# Развёртка трекера калорий на чистой Ubuntu VM (Яндекс Облако и т. п.).
#
#   sudo DOMAIN=easycal.ru EMAIL=you@example.com bash deploy/setup.sh
#
# DOMAIN — домен, уже указывающий на IP этой VM (по умолчанию easycal.ru)
# EMAIL  — почта для Let's Encrypt (необязательно, но рекомендуется)
#
# Скрипт идемпотентный — можно запускать повторно.
set -euo pipefail

DOMAIN="${DOMAIN:-easycal.ru}"
EMAIL="${EMAIL:-}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${SUDO_USER:-$(whoami)}"
ENV_FILE=/etc/calorie-tracker.env
SERVICE=calorie-tracker

if [ "$(id -u)" -ne 0 ]; then
  echo "Запустите через sudo: sudo DOMAIN=$DOMAIN bash deploy/setup.sh"
  exit 1
fi

echo "==> Домен: $DOMAIN | Код: $APP_DIR | Пользователь: $APP_USER"

echo "==> Пакеты (nginx, postgres, certbot, git)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git nginx postgresql postgresql-contrib \
  certbot python3-certbot-nginx openssl fail2ban

# fail2ban с дефолтным джейлом sshd — защита SSH от перебора
systemctl enable --now fail2ban

echo "==> Node.js 22"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> PostgreSQL"
systemctl enable --now postgresql

# Секреты: при повторном запуске берём прежние из env-файла
DB_PASSWORD=""
JWT_SECRET=""
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE" || true
fi
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"

sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='calorie'" | grep -q 1 ||
  sudo -u postgres psql -c "CREATE ROLE calorie LOGIN"
sudo -u postgres psql -c "ALTER ROLE calorie WITH LOGIN PASSWORD '$DB_PASSWORD'"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='calorie_tracker'" | grep -q 1 ||
  sudo -u postgres createdb -O calorie calorie_tracker

echo "==> Конфиг приложения ($ENV_FILE)"
cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=7347
HOST=127.0.0.1
DB_PASSWORD=$DB_PASSWORD
JWT_SECRET=$JWT_SECRET
DATABASE_URL=postgres://calorie:$DB_PASSWORD@localhost:5432/calorie_tracker
EOF
chmod 600 "$ENV_FILE"

echo "==> Зависимости и сборка фронтенда"
sudo -u "$APP_USER" bash -c "
  set -e
  cd '$APP_DIR'
  npm ci 2>/dev/null || npm install
  cd server && (npm ci 2>/dev/null || npm install) && cd ..
  VITE_OFF_PROXY=1 npm run build
"

echo "==> systemd-сервис $SERVICE"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Calorie tracker (Express + Postgres)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now "$SERVICE"
systemctl restart "$SERVICE"

echo "==> nginx для $DOMAIN"
# Зоны rate-limit (первый уровень защиты от флуда; второй — в самом Express)
cat > /etc/nginx/conf.d/calorie-ratelimit.conf <<'EOF'
limit_req_zone $binary_remote_addr zone=calorie_app:10m rate=20r/s;
limit_req_zone $binary_remote_addr zone=calorie_auth:10m rate=30r/m;
limit_conn_zone $binary_remote_addr zone=calorie_conn:10m;
EOF

# nameserver системы для nginx-resolver (на Ubuntu — stub systemd-resolved)
RESOLVER="$(awk '/^nameserver/{print $2; exit}' /etc/resolv.conf 2>/dev/null || true)"
RESOLVER="${RESOLVER:-127.0.0.53}"

cat > "/etc/nginx/sites-available/$SERVICE" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 2m;
    limit_conn calorie_conn 20;

    # Для off-проксей ниже: имена апстримов резолвятся на лету во время запроса
    resolver $RESOLVER valid=300s ipv6=off;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml application/manifest+json;

    # Приложение (Express: API + статика PWA)
    location / {
        limit_req zone=calorie_app burst=60 nodelay;
        proxy_pass http://127.0.0.1:7347;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Вход/регистрация — жёстче (перебор паролей)
    location ~ ^/api/auth/(login|register)\$ {
        limit_req zone=calorie_auth burst=10 nodelay;
        proxy_pass http://127.0.0.1:7347;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Прокси к Open Food Facts: у их поиска сломан CORS, ходим со своего домена.
    # Хостнейм — через переменную: так nginx резолвит DNS при каждом запросе,
    # а не один раз на старте. С литеральным хостнеймом в proxy_pass сбой DNS
    # в момент (пере)запуска — например, при ночном unattended-upgrades — валит
    # nginx целиком ([emerg] host not found in upstream), и сайт лежит до
    # ручного рестарта. rewrite срезает префикс, как это делал URI в proxy_pass.
    location /off-search/ {
        set \$off_search search.openfoodfacts.org;
        rewrite ^/off-search(/.*)\$ \$1 break;
        proxy_pass https://\$off_search;
        proxy_ssl_server_name on;
        proxy_set_header Host search.openfoodfacts.org;
    }
    location /off-ru/ {
        set \$off_ru ru.openfoodfacts.org;
        rewrite ^/off-ru(/.*)\$ \$1 break;
        proxy_pass https://\$off_ru;
        proxy_ssl_server_name on;
        proxy_set_header Host ru.openfoodfacts.org;
    }
    location /off-world/ {
        set \$off_world world.openfoodfacts.org;
        rewrite ^/off-world(/.*)\$ \$1 break;
        proxy_pass https://\$off_world;
        proxy_ssl_server_name on;
        proxy_set_header Host world.openfoodfacts.org;
    }
}
EOF
ln -sf "/etc/nginx/sites-available/$SERVICE" "/etc/nginx/sites-enabled/$SERVICE"
rm -f /etc/nginx/sites-enabled/default

# В дефолтном юните Ubuntu у nginx нет Restart — сорвавшийся старт оставляет
# сайт лежать до ручного вмешательства. Переподнимаем сами; на загрузке ждём DNS.
mkdir -p /etc/systemd/system/nginx.service.d
cat > /etc/systemd/system/nginx.service.d/50-restart.conf <<'EOF'
[Unit]
After=network-online.target nss-lookup.target
Wants=network-online.target

[Service]
Restart=on-failure
RestartSec=5s
EOF
systemctl daemon-reload

nginx -t
systemctl enable --now nginx
systemctl reload nginx

echo "==> Ежедневные бэкапы Postgres (03:30, хранится 14 дней)"
cat > /usr/local/bin/calorie-backup.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
DIR=/var/backups/calorie-tracker
mkdir -p "$DIR"
sudo -u postgres pg_dump calorie_tracker | gzip > "$DIR/calorie_tracker-$(date +%F).sql.gz"
find "$DIR" -name '*.sql.gz' -mtime +14 -delete
EOF
chmod +x /usr/local/bin/calorie-backup.sh

cat > /etc/systemd/system/calorie-backup.service <<EOF
[Unit]
Description=Backup calorie tracker database

[Service]
Type=oneshot
ExecStart=/usr/local/bin/calorie-backup.sh
EOF

cat > /etc/systemd/system/calorie-backup.timer <<EOF
[Unit]
Description=Daily calorie tracker DB backup

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now calorie-backup.timer
# первый бэкап сразу, чтобы убедиться, что работает
systemctl start calorie-backup.service

echo "==> HTTPS (Let's Encrypt)"
if [ -n "$EMAIL" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
else
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
fi

echo ""
echo "=========================================="
echo "Готово: https://$DOMAIN"
echo "Сервис:      systemctl status $SERVICE"
echo "Логи:        journalctl -u $SERVICE -f"
echo "Обновление:  bash deploy/update.sh"
echo "Бэкапы БД:   /var/backups/calorie-tracker (ежедневно в 03:30)"
echo "Восстановить: zcat backup.sql.gz | sudo -u postgres psql calorie_tracker"
echo "=========================================="
