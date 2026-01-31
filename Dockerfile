FROM node:20-alpine

# Cache bust: 2026-01-31T12:40
ARG CACHEBUST=1

WORKDIR /app

# Kopiera package files
COPY package*.json ./

# Installera dependencies
RUN npm ci --only=production

# Kopiera source
COPY src/ ./src/

# Miljövariabler (sätts vid deploy)
ENV NODE_ENV=production

# Kör med cron
CMD ["node", "src/index.js", "--cron"]
