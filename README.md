# Blocket Scraper

Automatisk scraping av Blocket bilannonser för marknadsanalys i Norrland.

## Features

- **Hybrid scraping** - Snabb sökning + moms-info för handlare
- **4 regioner** - Norrbotten, Västerbotten, Jämtland, Västernorrland
- **2x per dag** - Cron kl 06:00 och 18:00
- **Detekterar förändringar** - Nya annonser, prisändringar, borttagna

## Data som extraheras

| Fält | Källa |
|------|-------|
| Regnummer | Blocket (dold JSON) |
| Pris | Blocket |
| Märke/Modell | Blocket |
| Moms-info | Enskild annons (handlare) |
| Säljare | Blocket |

## Tech Stack

- **Runtime:** Node.js 20+
- **Database:** Supabase (PostgreSQL)
- **Hosting:** DigitalOcean App Platform
- **Cron:** node-cron

## Installation

```bash
npm install
```

## Miljövariabler

```bash
SUPABASE_SERVICE_KEY=din-service-role-key
```

## Användning

```bash
# Kör en gång
npm start

# Kör med cron (2x/dag)
node src/index.js --cron
```

## Deploy (DigitalOcean)

```bash
docker build -t blocket-scraper .
docker run -e SUPABASE_SERVICE_KEY=xxx blocket-scraper
```

## Databas (Supabase: fordonlista)

Tabeller:
- `blocket_annonser` - Alla annonser
- `blocket_prishistorik` - Prisändringar
- `blocket_marknadsdata` - Daglig statistik
- `blocket_scraper_log` - Körningsloggar
