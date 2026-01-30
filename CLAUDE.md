# Blocket Scraper Bot

Automatisk scraping av Blocket bilannonser för marknadsanalys i Norrland.

## Arkitektur

```
DigitalOcean (Bot)  ──────▶  Supabase (Databas)
      │                           │
      │ Cron 2x/dag               │ PostgreSQL
      │ (06:00 + 18:00)           │ REST API
      ▼                           ▼
  Blocket.se               fordonlista-projekt
```

## Regioner

- Norrbotten
- Västerbotten
- Jämtland
- Västernorrland

## HYBRID SCRAPING

```
1. Sökresultat (snabb)     → Alla bilar
2. Enskild sida (handlare) → Moms-info
```

## Filer

```
blocket-scraper-bot/
├── src/
│   ├── index.js      # Huvudprogram + cron
│   ├── blocket.js    # Blocket scraper
│   └── database.js   # Supabase operationer
├── Dockerfile        # För DigitalOcean
├── package.json
└── .env.example
```

## Miljövariabler

```bash
SUPABASE_URL=https://rueqiiqxkazocconmnwp.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>
```

## Lokalt test

```bash
cd /Users/arsalseemab/blocket-scraper-bot
npm install
export SUPABASE_SERVICE_KEY="din-nyckel"
node src/index.js
```

## Deploy till DigitalOcean

1. Skapa App Platform app
2. Koppla till GitHub repo
3. Sätt miljövariabler
4. Deploy

## Databas (Supabase: fordonlista)

**Tabeller:**
- `blocket_annonser` - Alla bilannonser
- `blocket_prishistorik` - Prisändringar över tid
- `blocket_marknadsdata` - Daglig statistik
- `blocket_scraper_log` - Körningsloggar

## Scraper-logik

1. Söker Norrbotten + Västerbotten
2. Loopar genom märken (Volvo, Toyota, etc.)
3. För varje annons:
   - NY → Spara till databas
   - BEFINTLIG → Uppdatera senast_sedd
   - PRISÄNDRING → Logga i prishistorik
4. Markera borttagna (ej sedda på 2 dagar)
5. Beräkna daglig marknadsstatistik
