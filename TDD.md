# TDD - Blocket Scraper Tasks

## Completed

- [x] Fix infinite loop in backfill-stad.js (mark as OKÄND when no city)
- [x] Fix RPC crash (wrap exec_sql in try-catch)
- [x] Fix URL-encoded Swedish characters (Ö, Ä, Å) in city regex
- [x] Re-run backfill with fixed regex
- [x] Switch back to cron mode
- [x] Deploy to DigitalOcean
- [x] Add light scrape every 15 minutes (07:00-22:00)

## Pending

- [ ] Monitor light scrape performance
- [ ] Verify quick-selling cars are now captured

## Future Improvements

- [ ] Add more robust city extraction patterns
- [ ] Consider storing raw Google Maps URL for manual verification
- [ ] Add retry logic for failed detail fetches
