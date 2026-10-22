# Образ приложения: Next.js + системные утилиты распознавания (Tesseract rus/kir/eng, poppler, libheif).
# Документы обрабатываются только внутри контейнера — внешние OCR/AI-сервисы не используются.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 STORAGE_DIR=/data/storage OMP_THREAD_LIMIT=2
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
      tesseract-ocr tesseract-ocr-rus tesseract-ocr-kir tesseract-ocr-eng \
      poppler-utils libheif-examples postgresql-client \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/assets ./assets
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/next.config.ts ./next.config.ts
# исходники и tsconfig нужны командам db:seed / db:demo (tsx импортирует src/lib)
COPY --from=build /app/src ./src
COPY --from=build /app/tsconfig.json ./tsconfig.json
RUN mkdir -p /data/storage && chown -R node:node /data /app
USER node
VOLUME ["/data/storage"]
EXPOSE 3000
# Миграции применяются при запуске; сид (роли и первый администратор) — отдельной командой: npm run db:seed
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
