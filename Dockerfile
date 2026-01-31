FROM node:20-alpine

# Cache bust: 2026-01-31T14:05 - PARALLEL BACKFILL
ARG CACHEBUST=3

WORKDIR /app

# Kopiera package files
COPY package*.json ./

# Installera dependencies
RUN npm ci --only=production

# Kopiera source
COPY src/ ./src/

# Miljövariabler (sätts vid deploy)
ENV NODE_ENV=production

# Kör scraping en gång (för att fylla i publicerad-datum)
# Byt till --cron för schemalagd körning
CMD ["node", "src/index.js"]
