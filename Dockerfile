FROM node:20-alpine

# Cache bust: 2026-01-31 FIX URL-ENCODED CITIES
ARG CACHEBUST=8

WORKDIR /app

# Kopiera package files
COPY package*.json ./

# Installera dependencies
RUN npm ci --only=production

# Kopiera source
COPY src/ ./src/

# Miljövariabler (sätts vid deploy)
ENV NODE_ENV=production

# BACKFILL med fixad regex för svenska tecken
CMD ["node", "src/backfill-stad.js"]
