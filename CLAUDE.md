# Blocket Norrland Bil-Scraper

Automatisk scraping av bilannonser från Blocket.se för marknadsanalys i Norrland.

## Arkitektur

```
DigitalOcean App Platform          Supabase (PostgreSQL)
        │                                   │
        │ Worker (Node.js)                  │ Databas: fordonlista
        │ Cron: 06:00 + 18:00               │ Project ID: rueqiiqxkazocconmnwp
        ▼                                   ▼
    Blocket.se  ───────────────────►  blocket_annonser
    (Reverse-engineered API)              blocket_prishistorik
                                          blocket_marknadsdata
                                          blocket_scraper_log
```

## Regioner (Norrland)

| Region | Blocket-kod | Status |
|--------|-------------|--------|
| Norrbotten | 0.300025 | ✅ Aktiv |
| Västerbotten | 0.300024 | ✅ Aktiv |
| Jämtland | 0.300023 | ✅ Aktiv |
| Västernorrland | 0.300022 | ✅ Aktiv |

## Filer

```
blocket-scraper/
├── src/
│   ├── index.js           # Huvudprogram + cron-schema
│   ├── blocket.js         # Blocket API-scraper
│   ├── database.js        # Supabase CRUD-operationer
│   ├── backfill-details.js # Backfill växellåda/kaross/färg
│   └── backfill-stad.js   # Backfill saknade städer
├── Dockerfile             # Docker för DigitalOcean
├── package.json
└── .env.example
```

## Data som samlas in

### Från Sök-API (snabb, bulk)
- `blocket_id`, `regnummer`
- `marke`, `modell`, `arsmodell`
- `pris`, `miltal`, `bransle`
- `stad` (location) - ~60-80% täckning
- `saljare_namn`, `saljare_typ` (privat/handlare)
- `publicerad` (exakt timestamp)
- `url`, `bild_url`

### Från Annons-sida (detaljerad)
- `vaxellada` (Automat/Manuell)
- `kaross` (Sedan/Kombi/SUV/etc)
- `farg` (Blå, Svart, etc)
- `momsbil` (boolean)
- `pris_exkl_moms`
- `stad` (fallback från Google Maps-länk)

## Databastabell: blocket_annonser

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| id | integer | Primary key |
| blocket_id | varchar | Blockets annons-ID |
| regnummer | varchar | ABC123 |
| marke | varchar | Volvo, BMW, etc |
| modell | varchar | V60, 320i, etc |
| arsmodell | integer | 2019 |
| miltal | integer | 85000 |
| pris | integer | 189000 |
| bransle | varchar | diesel, bensin, el |
| vaxellada | varchar | Automat, Manuell |
| kaross | varchar | Kombi, SUV, Sedan |
| farg | varchar | Svart, Vit, Blå |
| effekt | integer | Hästkrafter |
| region | varchar | norrbotten, jamtland |
| stad | text | Luleå, Östersund |
| saljare_typ | varchar | privat, handlare |
| saljare_namn | varchar | Firma AB |
| momsbil | boolean | true/false |
| pris_exkl_moms | integer | 151200 |
| url | text | Länk till annons |
| bild_url | text | Första bilden |
| publicerad | timestamptz | När annonsen lades upp |
| forst_sedd | timestamptz | När vi hittade den |
| senast_sedd | timestamptz | Senaste scrape |
| borttagen | timestamptz | När den försvann |
| borttagen_anledning | text | SÅLD, 404 |

## Scraper-flöde

```
1. Sök alla bilar i region (via Blocket sök-API)
   ↓
2. För varje annons:
   ├── NY? → Hämta detaljer från sidan → Spara
   └── BEFINTLIG?
       ├── Prisändring? → Logga i prishistorik
       ├── Saknar stad? → Hämta från sidan
       └── Uppdatera senast_sedd
   ↓
3. Kolla sålda (annonser ej i sökning)
   → Besök URL → Markera som SÅLD/404
   ↓
4. Markera borttagna (ej sedda 7+ dagar)
   ↓
5. Beräkna daglig marknadsstatistik
```

## Miljövariabler

```bash
SUPABASE_URL=https://rueqiiqxkazocconmnwp.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>
```

## Köra lokalt

```bash
cd /Users/arsalseemab/Desktop/github/blocket-scraper
npm install
export SUPABASE_SERVICE_KEY="..."
node src/index.js           # Kör en gång
node src/index.js --cron    # Kör med schema
```

## DigitalOcean Deploy

**App ID:** `48151528-db98-4b05-b443-9abb63d801bd`
**Region:** Amsterdam (ams)
**Instans:** apps-s-1vcpu-0.5gb

### Byta körläge (Dockerfile CMD)

```dockerfile
# Normal cron-körning (2x/dag)
CMD ["node", "src/index.js", "--cron"]

# Backfill detaljer
CMD ["node", "src/backfill-details.js"]

# Backfill städer
CMD ["node", "src/backfill-stad.js"]
```

## Statistik & Täckning

| Data | Täckning |
|------|----------|
| Publicerad (timestamp) | 99% |
| Stad | ~65% (mål: 99%) |
| Växellåda | 95%+ |
| Kaross | 95%+ |
| Färg | 95%+ |

## MCP/CLI-kommandon

```bash
# Kolla status per region
SELECT region, COUNT(*) as total,
  ROUND(100.0 * COUNT(stad) / COUNT(*), 1) as procent_stad
FROM blocket_annonser
WHERE borttagen IS NULL
GROUP BY region;

# Senaste annonser
SELECT marke, modell, pris, stad, publicerad
FROM blocket_annonser
WHERE borttagen IS NULL
ORDER BY publicerad DESC
LIMIT 10;

# Sålda bilar senaste veckan
SELECT marke, modell, pris, borttagen_anledning
FROM blocket_annonser
WHERE borttagen > NOW() - INTERVAL '7 days'
ORDER BY borttagen DESC;
```

## Blocket API-konstanter

```javascript
// Länskoder
LAN_KODER = {
  norrbotten: "0.300025",
  vasterbotten: "0.300024",
  jamtland: "0.300023",
  vasternorrland: "0.300022",
  // ... fler i blocket.js
}

// Bränsletyper
BRANSLE = {
  bensin: "gasoline",
  diesel: "diesel",
  el: "electric",
  hybrid: "hybrid",
  laddhybrid: "plug_in_hybrid"
}
```

## Kända begränsningar

1. **Stad från API:** Blocket returnerar inte `location` för alla annonser (~20-40% saknas)
   - Lösning: Fallback-extraktion från Google Maps-länk på sidan

2. **Rate limiting:** Blocket kan blockera vid för många requests
   - Lösning: 200-800ms delay mellan requests

3. **Privata säljare:** Oftare saknar location i API:et än handlare
