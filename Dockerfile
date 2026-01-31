FROM node:20-alpine

# Cache bust: 2026-01-31 ADD LIGHT SCRAPE
ARG CACHEBUST=9

WORKDIR /app

# Kopiera package files
COPY package*.json ./

# Installera dependencies
RUN npm ci --only=production

# Kopiera source
COPY src/ ./src/

# Miljövariabler (sätts vid deploy)
ENV NODE_ENV=production

# Normal cron-körning (2x/dag)
CMD ["node", "src/index.js", "--cron"]
