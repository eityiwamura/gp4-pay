FROM node:20-alpine

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# package-lock.json entra no COPY para que o `npm ci` instale exatamente as versões
# testadas — `npm install` sem o lock deixa as dependências flutuarem entre builds.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Não roda como root.
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q -O- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1

# A migração roda antes e trava o start se falhar: melhor não subir do que subir
# com o schema errado. Ela espera o Postgres ficar disponível antes de desistir.
CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
