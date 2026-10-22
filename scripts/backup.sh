#!/usr/bin/env bash
# Резервная копия БД и файлового хранилища.
# Использование: DATABASE_URL=... STORAGE_DIR=./storage BACKUP_DIR=./backups scripts/backup.sh
# Рекомендуется запускать ежедневно (cron) и хранить копии вне сервера приложения.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL не задан}"
STORAGE_DIR="${STORAGE_DIR:-./storage}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
umask 077
# pg_dump не понимает параметр ?schema= из строки Prisma
pg_dump --format=custom --file="$BACKUP_DIR/db-$STAMP.dump" "${DATABASE_URL%%\?*}"
tar -czf "$BACKUP_DIR/storage-$STAMP.tar.gz" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
echo "Готово: $BACKUP_DIR/db-$STAMP.dump, $BACKUP_DIR/storage-$STAMP.tar.gz"
# Восстановление: pg_restore --clean --dbname="$DATABASE_URL_БЕЗ_SCHEMA" db-XXXX.dump; tar -xzf storage-XXXX.tar.gz
