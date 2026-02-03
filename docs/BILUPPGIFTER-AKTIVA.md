# Biluppgifter för Aktiva Blocket-annonser

Hämtar ägar- och fordonsdata från biluppgifter.se för aktiva Blocket-annonser.

## Arkitektur

```
blocket_annonser (aktiva)
        ↓
    Biluppgifter API (localhost:3456)
        ↓
    biluppgifter.se (scraping)
        ↓
    biluppgifter_data (Supabase)
```

## Beroenden

### Biluppgifter API Server
- **Plats:** `/Users/arsalseemab/Desktop/biluppgifter-api`
- **Port:** 3456
- **Start:** `uvicorn server:app --port 3456`
- **Endpoints:**
  - `GET /api/vehicle/{regnr}` - Fordonsdata
  - `GET /api/owner/{regnr}` - Ägardata med profil
  - `GET /api/address/{regnr}` - Alla fordon på adressen

### Supabase
- **URL:** `https://rueqiiqxkazocconmnwp.supabase.co`
- **Tabeller:** `blocket_annonser`, `biluppgifter_data`

## Script

### Plats
```
/Users/arsalseemab/Desktop/github/fordonlista/scripts/fetch-blocket-biluppgifter.cjs
```

### Köra
```bash
cd /Users/arsalseemab/Desktop/github/fordonlista
node scripts/fetch-blocket-biluppgifter.cjs
```

### Vad det gör
1. Hämtar aktiva Blocket-annonser med regnummer
2. För varje annons: anropar Biluppgifter API
3. Sparar ägardata till `biluppgifter_data`-tabellen
4. Väntar 1.5s mellan requests (rate limiting)

## Data som hämtas

### Fordonsdata
| Fält | Beskrivning |
|------|-------------|
| Miltal | Mätarställning i mil |
| Antal ägare | Historiskt antal |
| Årsskatt | SEK |
| Besiktning | Giltig till datum |
| Milhistorik | JSONB array med besiktningsvärden |

### Ägardata
| Fält | Beskrivning |
|------|-------------|
| Namn | Fullständigt namn |
| Ålder | Beräknad från personnummer |
| Personnummer | YYYYMMDD-XXXX |
| Adress | Gatuadress |
| Postnummer | 5-siffrig kod |
| Ort | Postort |
| Andra fordon | JSONB array med ägarens bilar |
| Adress-fordon | JSONB array med bilar på adressen |

## Databastabell: biluppgifter_data

```sql
CREATE TABLE biluppgifter_data (
  regnummer TEXT PRIMARY KEY,
  blocket_id INTEGER REFERENCES blocket_annonser(id),

  -- Ägarinfo
  owner_name TEXT,
  owner_age INTEGER,
  owner_city TEXT,
  owner_address TEXT,
  owner_postal_code TEXT,
  owner_postal_city TEXT,

  -- Relaterade fordon
  owner_vehicles JSONB,      -- Ägarens alla fordon
  address_vehicles JSONB,    -- Fordon på samma adress

  -- Metadata
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Viktigt: blocket_id

**Använd `blocket_annonser.id`** (databasens PK), INTE `blocket_id`-kolumnen (Blockets externa ID).

```javascript
// RÄTT
saveBiluppgifter(ad.id, ad.regnummer, data)

// FEL - ger FK constraint error
saveBiluppgifter(ad.blocket_id, ad.regnummer, data)
```

## Cron-integration

Fordonlista har redan ett cron-jobb för detta:
- **Route:** `/api/cron/biluppgifter`
- **Schema:** `*/30 7-18 * * *` (var 30:e min, 07-18)
- **Logik:** Hämtar endast annonser som saknar biluppgifter

## Felhantering

| Fel | Orsak | Lösning |
|-----|-------|---------|
| 403 Cloudflare | Cookies expired | Uppdatera cookies i biluppgifter-api/.env |
| FK constraint | Fel blocket_id | Använd `ad.id` istället för `ad.blocket_id` |
| Timeout | Biluppgifter.se långsam | Öka delay mellan requests |
| Ingen ägardata | Vissa bilar saknar | Normalt, skippa och fortsätt |

## Exempel: Output

```
🚙 BMW 525 2013
   Reg: BGP739 | Pris: 159,900 kr
   Miltal: 15,333 mil | Östersund

   🔍 Hämtar biluppgifter...
   ✅ Ägare: Åsa Lindström, 39 år
   📍 Skördevägen 36, 83175 Östersund
   🆔 19860727-8226
   🚗 Äger 4 fordon
   📜 8 tidigare ägare
   💾 Sparad i databasen
```

## Utöka scriptet

### Fler annonser
```javascript
const ads = await getBlocketAds(50);  // Ändra limit
```

### Filtrera på region
```javascript
.eq('region', 'norrbotten')
```

### Endast annonser utan biluppgifter
```javascript
.is('bu_fetched_at', null)
```
