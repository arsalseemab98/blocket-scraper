FROM node:20-alpine

# Cache bust: 2026-01-31 BACKFILL STAD
ARG CACHEBUST=4

WORKDIR /app

# Kopiera package files
COPY package*.json ./

# Installera dependencies
RUN npm ci --only=production

# Kopiera source
COPY src/ ./src/

# Miljövariabler (sätts vid deploy)
ENV NODE_ENV=production

# BACKFILL STAD - Fyller i saknade städer
# Byt tillbaka till "src/index.js", "--cron" efter backfill
CMD ["node", "src/backfill-stad.js"]
