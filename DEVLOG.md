# DEVLOG - Blocket Scraper

## 2026-01-31

### Fixed: Infinite loop in backfill-stad.js
- **Problem:** Script processed 40,000+ items repeatedly because ads without city data stayed as `stad=NULL`
- **Cause:** When no city found, script just incremented counter but didn't update database
- **Fix:** Mark ads as `stad='OKÄND'` when no city can be extracted
- **Commit:** `b4c719e`

### Fixed: RPC crash at end of backfill
- **Problem:** Deployment failed with non-zero exit code after backfill completed
- **Cause:** `supabase.rpc('exec_sql', ...)` function doesn't exist in Supabase
- **Fix:** Wrapped exec_sql call in try-catch to prevent crash
- **Commit:** `d2f1d1c`

### Fixed: URL-encoded Swedish characters in city regex
- **Problem:** Cities with Ö, Ä, Å not extracted (e.g., Östersund, Umeå, Gävle)
- **Cause:** Regex `([^"&%]+)` excluded `%` chars, but Swedish letters are URL-encoded (Ö = %C3%96)
- **Fix:** Changed to `([^"&]+)` to allow % in capture, then `decodeURIComponent()` handles decoding
- **Commit:** `c9d41f0`
- **Result:** +100 more ads now have city data

### Final stats
- **City coverage:** 7,512 / 7,521 (99.88%)
- **Missing:** 9 ads marked as OKÄND (truly no location data on Blocket)

### Added: Light Scrape feature
- **Problem:** Cars listed and sold between full scrapes (12h gap) were missed
- **Solution:** Light scrape every 15 minutes (07:00-22:00)
- **Implementation:**
  - `sokNyaste()` - fetches only page 1, sorted by newest
  - `runLightScrape()` - quick scan, only processes NEW cars
  - Cron: `*/15 * * * *` with hour check (7-22)
- **Commit:** `a7dd58f`
- **Expected improvement:** Capture 95%+ of all cars instead of ~60%

### Updated: Fordonlista Log Page
- **Problem:** Log page only showed basic stats, hard to understand what scraper is doing
- **Solution:** Complete redesign of `/blocket-logs` page in fordonlista
- **New features:**
  - Live status banner (shows if scraper is running, time since last run)
  - Schedule info card (Full scrape 06:00 & 18:00, Light scrape var 15 min)
  - "Today" stats: new ads today, sold ads today
  - Region breakdown: active ads per Norrland region
  - Recent NEW cars (last 24h) with full details: make, model, price, mileage, city, seller type
  - Recent SOLD cars (last 24h) with sold reason (SÅLD/404)
  - Expandable lists (show 5 by default, click to show all)
  - External links to Blocket for each car
- **Files changed:**
  - `fordonlista/app/blocket-logs/page.tsx`
  - `fordonlista/components/blocket-logs/blocket-logs-view.tsx`
