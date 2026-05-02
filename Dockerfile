FROM node:20-alpine

# Cache bust: 2026-05-02 ADD DEAL HUNTER (30s private-seller polling + Gmail SMTP)
ARG CACHEBUST=11

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
