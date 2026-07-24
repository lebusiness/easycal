#!/usr/bin/env bash
# Обновление приложения на VM: git pull → сборка → перезапуск сервиса.
#   bash deploy/update.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "==> git pull"
git pull

echo "==> Зависимости и сборка"
npm ci 2>/dev/null || npm install
(cd server && (npm ci 2>/dev/null || npm install))
VITE_OFF_PROXY=1 npm run build

echo "==> Перезапуск сервиса"
sudo systemctl restart calorie-tracker
sleep 1
sudo systemctl --no-pager -l status calorie-tracker | head -6

echo "Готово."
