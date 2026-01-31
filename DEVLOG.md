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
