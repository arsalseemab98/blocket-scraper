# Biluppgifter för Sålda Blocket-bilar

Verifierar försäljningar och hämtar köpardata för bilar som försvunnit från Blocket.

## Koncept

När en annons försvinner från Blocket markeras den som "SÅLD". Men detta betyder inte alltid att bilen faktiskt såldes - annonsen kan ha tagits bort av andra skäl.

**Verifieringslogik:**
1. Hämta nuvarande ägare från biluppgifter.se
2. Jämför med ursprunglig ägare (säljaren)
3. Om ägarbyte → **Bekräftad försäljning**
4. Om samma ägare efter 90 dagar → **Ej såld**

## Arkitektur

```
blocket_annonser (borttagen = SÅLD)
        ↓
    7 dagar väntetid (ägarbyte tar tid)
        ↓
    Biluppgifter API (localhost:3456)
        ↓
    Jämför ägare: original vs nuvarande
        ↓
   ┌────────────────────────────────────┐
   │                                    │
   ▼                                    ▼
Ägarbyte?                          Samma ägare?
   │                                    │
   ▼                                    ▼
blocket_salda                    < 90 dagar?
(bekräftad)                            │
                              ┌────────┴────────┐
                              ▼                 ▼
                        JA: pending        NEJ: ej_salda
                       (kolla igen         (inte såld)
                        om 14 dagar)
```

## Databastabeller

### blocket_salda (Bekräftade försäljningar)
```sql
CREATE TABLE blocket_salda (
  id SERIAL PRIMARY KEY,
  blocket_id INTEGER REFERENCES blocket_annonser(id),
  regnummer TEXT NOT NULL,

  -- Försäljningsdata
  slutpris INTEGER,
  liggtid_dagar INTEGER,      -- Dagar på Blocket
  sold_at TIMESTAMPTZ,

  -- Säljardata
  saljare_typ TEXT,           -- 'privat' | 'handlare'
  saljare_namn TEXT,

  -- Bildata
  marke TEXT,
  modell TEXT,
  arsmodell INTEGER,
  miltal INTEGER,

  -- Köpardata (från biluppgifter)
  kopare_namn TEXT,
  kopare_typ TEXT,            -- 'privatperson' | 'handlare'
  kopare_is_dealer BOOLEAN,
  kopare_alder INTEGER,
  kopare_adress TEXT,
  kopare_postnummer TEXT,
  kopare_postort TEXT,
  kopare_telefon TEXT,
  kopare_fordon JSONB,        -- Köparens andra bilar
  adress_fordon JSONB,        -- Bilar på köparens adress

  -- Metadata
  buyer_fetched_at TIMESTAMPTZ,
  agarbyte_gjort BOOLEAN DEFAULT TRUE
);
```

### blocket_salda_pending (Väntar på verifiering)
```sql
CREATE TABLE blocket_salda_pending (
  id SERIAL PRIMARY KEY,
  blocket_id INTEGER REFERENCES blocket_annonser(id),
  regnummer TEXT NOT NULL,
  original_owner TEXT,
  marke TEXT,
  modell TEXT,
  arsmodell INTEGER,
  pris INTEGER,
  sold_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ DEFAULT NOW(),
  check_count INTEGER DEFAULT 1
);
```

### blocket_ej_salda (Verifierat EJ sålda)
```sql
CREATE TABLE blocket_ej_salda (
  id SERIAL PRIMARY KEY,
  blocket_id INTEGER REFERENCES blocket_annonser(id),
  regnummer TEXT NOT NULL,
  agare_namn TEXT,
  marke TEXT,
  modell TEXT,
  arsmodell INTEGER,
  pris INTEGER,
  annons_skapad TIMESTAMPTZ,
  annons_borttagen TIMESTAMPTZ,
  liggtid_dagar INTEGER,
  check_count INTEGER,
  verified_at TIMESTAMPTZ
);
```

## Tidsintervall

| Konstant | Värde | Beskrivning |
|----------|-------|-------------|
| `MIN_DAYS_BEFORE_CHECK` | 7 dagar | Vänta innan första koll (ägarbyte tar tid) |
| `CHECK_INTERVAL_DAYS` | 14 dagar | Tid mellan omcheckar i pending |
| `MAX_DAYS_WINDOW` | 90 dagar | Max väntetid - efter detta = ej såld |

## Kod

### Huvudfil
```
/Users/arsalseemab/Desktop/github/fordonlista/lib/sold-cars/fetch-buyer.ts
```

### Huvudfunktioner

```typescript
// Processa batch av sålda bilar
processSoldCarsForBuyers(limit: number = 50)

// Hämta köpardata för enskild bil
fetchBuyerForSoldCar(regnummer: string)

// Hämta alla sålda med köpardata
getSoldCarsWithBuyers(options?: {
  limit?: number
  kopareTyp?: 'privatperson' | 'handlare'
  onlyDealerBuyers?: boolean
})

// Statistik
getSoldCarsStats()
```

## Flöde: processSoldCarsForBuyers()

```
1. STEG 1: Processa PENDING-bilar
   ├── Hämta bilar från blocket_salda_pending
   ├── Filtrera: last_checked_at > 14 dagar sedan
   ├── För varje bil:
   │   ├── Hämta nuvarande ägare från biluppgifter
   │   ├── Jämför med original_owner
   │   └── Avgör: completed | pending | error
   └── Rate limit: 1.5s mellan requests

2. STEG 2: Processa NYA sålda bilar
   ├── Hämta från blocket_annonser WHERE borttagen_anledning = 'SÅLD'
   ├── Filtrera: 7-90 dagar sedan borttagen
   ├── Exkludera: redan i salda/pending/ej_salda
   ├── För varje bil:
   │   ├── Hämta original ägare från biluppgifter_data
   │   ├── Hämta nuvarande ägare från biluppgifter API
   │   ├── Jämför namn
   │   └── Avgör status
   └── Rate limit: 1.5s mellan requests
```

## Ägarjämförelse

```typescript
function isSameOwner(sellerName, buyerName): boolean {
  // Normalisera: lowercase, ta bort AB/HB/etc
  // Exakt match ELLER
  // Ett namn innehåller det andra (minst 5 tecken)
}
```

**Exempel:**
- "Johan Andersson" vs "Johan Andersson" → SAMMA
- "N Bergs Bil HB" vs "N Bergs Bil" → SAMMA
- "Johan" vs "Johan Andersson" → SAMMA (>= 5 tecken)
- "AB Bilar" vs "Per Svensson" → OLIKA

## Cron-integration

### Vercel Cron
```
/api/cron/sold-cars
Schema: Dagligen eller manuellt
```

### Körning
```typescript
import { processSoldCarsForBuyers } from '@/lib/sold-cars/fetch-buyer'

const result = await processSoldCarsForBuyers(50)
// {
//   success: true,
//   processed: 12,
//   noOwnerChange: 3,
//   addedToPending: 8,
//   errors: []
// }
```

## Statistik

```typescript
const stats = await getSoldCarsStats()
// {
//   totalSalda: 145,           // Bekräftade försäljningar
//   totalEjSalda: 23,          // Verifierat ej sålda
//   totalPending: 67,          // Väntar på verifiering
//   privatTillPrivat: 89,
//   privatTillHandlare: 12,
//   handlareTillPrivat: 44,
//   avgLiggtid: 18             // Dagar på Blocket
// }
```

## Användningsområden

### 1. Marknadsanalys
- Genomsnittlig liggtid per märke/modell
- Vilka bilar säljs snabbast?
- Prisförändring: utgångspris vs slutpris (om sparat)

### 2. Köparbeteende
- Privat → Privat (vanligast)
- Privat → Handlare (inbyten?)
- Handlare → Privat (normal försäljning)

### 3. Lead-generering
- Köpare som köpt nyligen = potentiella säljare om 3-5 år
- Handlare som köper mycket = potentiella partners

## Exempel: Output i Blocket Logs

```
📊 Sålda bilar med köparinfo

| Bil | Säljare | Köpare | Liggtid |
|-----|---------|--------|---------|
| Volvo V60 2019 | Privat | Per Svensson, 45 år | 12 dagar |
| BMW 320d 2018 | Handlare | Bilfirma AB | 28 dagar |
| VW Golf 2017 | Privat | Lisa Ek, 32 år | 8 dagar |

Statistik:
- Bekräftade: 145
- Pending: 67
- Ej sålda: 23
- Snitt liggtid: 18 dagar
```

## Felhantering

| Scenario | Hantering |
|----------|-----------|
| Biluppgifter timeout | Logga fel, skippa till nästa |
| Ingen original ägare | Anta ägarbyte (kan inte verifiera) |
| 403 Cloudflare | Uppdatera cookies |
| Samma ägare | Om < 90 dagar → pending, annars → ej_salda |

## Tips

### Kör manuellt
```bash
# I fordonlista-projektet
npx tsx -e "
import { processSoldCarsForBuyers } from './lib/sold-cars/fetch-buyer'
processSoldCarsForBuyers(20).then(console.log)
"
```

### Kolla pending-status
```sql
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE last_checked_at < NOW() - INTERVAL '14 days') as ready_for_check
FROM blocket_salda_pending;
```

### Vanliga köpare (handlare)
```sql
SELECT kopare_namn, COUNT(*) as antal_kop
FROM blocket_salda
WHERE kopare_is_dealer = true
GROUP BY kopare_namn
ORDER BY antal_kop DESC
LIMIT 10;
```
