#!/usr/bin/env bash
# Восстановление из копии, созданной scripts/backup.sh.
# Использование:
#   RESTORE_DATABASE_URL=postgresql://user:pass@host:5432/db STORAGE_DIR=./storage \
#     scripts/restore.sh backups/db-YYYYMMDD-HHMMSS.dump backups/storage-YYYYMMDD-HHMMSS.tar.gz
# Безопасность: целевая БД должна быть пустой (иначе — FORCE=1), каталог хранилища — пустым или отсутствовать.
# Рекомендуется сначала восстановить в отдельную БД и проверить данные, затем переключить приложение.
set -euo pipefail
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL не задан}"
DUMP="${1:?укажите файл дампа БД}"
ARCHIVE="${2:-}"
STORAGE_DIR="${STORAGE_DIR:-./storage}"
URL="${RESTORE_DATABASE_URL%%\?*}"
TABLES="$(psql "$URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
if [ "$TABLES" != "0" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Целевая БД не пуста ($TABLES таблиц). Восстановление остановлено. Укажите пустую БД или FORCE=1." >&2
  exit 1
fi
pg_restore --no-owner --clean --if-exists --dbname="$URL" "$DUMP"
if [ -n "$ARCHIVE" ]; then
  if [ -d "$STORAGE_DIR" ] && [ -n "$(ls -A "$STORAGE_DIR" | grep -v '^.gitkeep$' || true)" ] && [ "${FORCE:-0}" != "1" ]; then
    echo "Каталог $STORAGE_DIR не пуст. Файлы не восстановлены. Укажите пустой каталог или FORCE=1." >&2
    exit 1
  fi
  mkdir -p "$STORAGE_DIR"
  tar -xzf "$ARCHIVE" -C "$STORAGE_DIR" --strip-components=1
fi
echo "Восстановлено: БД из $DUMP${ARCHIVE:+, файлы из $ARCHIVE в $STORAGE_DIR}"
