/**
 * Biluppgifter Integration for Blocket Scraper
 * Hämtar ägardata för nya annonser efter scrape
 */

import { supabase } from './database.js';

const BILUPPGIFTER_API = process.env.BILUPPGIFTER_API_URL || 'http://localhost:3456';
const BATCH_SIZE = 10;
const DELAY_MS = 1500;

/**
 * Log to biluppgifter_log table
 */
async function log(type, message, details = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[BILUPPGIFTER] [${type}] ${message}`);

  try {
    await supabase.from('biluppgifter_log').insert({
      type,
      message,
      details,
      created_at: timestamp
    });
  } catch (err) {
    console.error('Could not save biluppgifter log:', err.message);
  }
}

/**
 * Check if biluppgifter API is available
 */
export async function checkBiluppgifterHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${BILUPPGIFTER_API}/health`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Fetch biluppgifter for one registration number
 */
async function fetchBiluppgifter(regnr) {
  const response = await fetch(`${BILUPPGIFTER_API}/api/owner/${regnr}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return await response.json();
}

/**
 * Save biluppgifter to database
 */
async function saveBiluppgifter(blocketId, regnr, data) {
  if (!data?.owner_profile) return false;

  const profile = data.owner_profile;
  const dbData = {
    regnummer: regnr,
    blocket_id: blocketId,
    owner_name: profile.name || null,
    owner_age: profile.age || null,
    owner_city: profile.city || null,
    owner_address: profile.address || null,
    owner_postal_code: profile.postal_code || null,
    owner_postal_city: profile.postal_city || null,
    owner_vehicles: profile.vehicles || [],
    address_vehicles: profile.address_vehicles || [],
    mileage_history: data.mileage_history || [],
    owner_history: data.owner_history || [],
    is_dealer: profile.vehicles?.length >= 10 || false,
    fetched_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('biluppgifter_data')
    .upsert(dbData, { onConflict: 'regnummer' });

  if (error) throw new Error(error.message);
  return true;
}

/**
 * Fetch biluppgifter for new ads after scrape
 * Called from index.js after each scrape run
 */
export async function fetchBiluppgifterForNewAds(newAdsRegnummers = []) {
  // Skip if no API configured or no new ads
  if (!BILUPPGIFTER_API || newAdsRegnummers.length === 0) {
    return { success: 0, failed: 0, skipped: 0 };
  }

  // Check API health first
  const health = await checkBiluppgifterHealth();
  if (!health.ok) {
    await log('error', 'Biluppgifter API not available', {
      error: health.error,
      api_url: BILUPPGIFTER_API
    });
    return { success: 0, failed: 0, skipped: newAdsRegnummers.length, error: 'API unavailable' };
  }

  await log('info', `Fetching biluppgifter for ${newAdsRegnummers.length} new ads`);

  let success = 0;
  let failed = 0;
  let skipped = 0;
  const errors = [];

  // Get blocket_id for each regnummer
  const { data: ads } = await supabase
    .from('blocket_annonser')
    .select('id, regnummer')
    .in('regnummer', newAdsRegnummers.map(r => r.toUpperCase()));

  const regnrToId = new Map(ads?.map(a => [a.regnummer, a.id]) || []);

  // Process in batches
  for (const regnr of newAdsRegnummers.slice(0, BATCH_SIZE)) {
    const upperRegnr = regnr.toUpperCase();

    try {
      const data = await fetchBiluppgifter(upperRegnr);

      if (data?.owner_profile) {
        const blocketId = regnrToId.get(upperRegnr);
        await saveBiluppgifter(blocketId, upperRegnr, data);
        success++;
        console.log(`  ✅ ${upperRegnr}: ${data.owner_profile.name || 'Handlare'}`);
      } else {
        skipped++;
        console.log(`  ⚠️ ${upperRegnr}: Ingen ägardata`);
      }
    } catch (error) {
      failed++;
      errors.push({ regnr: upperRegnr, error: error.message });
      console.log(`  ❌ ${upperRegnr}: ${error.message}`);
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  await log('info', 'Biluppgifter fetch completed', {
    success,
    failed,
    skipped,
    total: newAdsRegnummers.length,
    errors: errors.length > 0 ? errors : undefined
  });

  return { success, failed, skipped };
}

/**
 * Fetch biluppgifter for ads that don't have it yet
 * Standalone function for backfill
 */
export async function fetchMissingBiluppgifter(limit = BATCH_SIZE) {
  // Check API health
  const health = await checkBiluppgifterHealth();
  if (!health.ok) {
    await log('error', 'Biluppgifter API not available for backfill', {
      error: health.error
    });
    return { success: 0, failed: 0, skipped: 0, remaining: -1 };
  }

  // Get active ads with regnummer
  const { data: ads } = await supabase
    .from('blocket_annonser')
    .select('id, regnummer')
    .is('borttagen', null)
    .not('regnummer', 'is', null)
    .order('publicerad', { ascending: false })
    .limit(limit * 2);

  if (!ads || ads.length === 0) {
    return { success: 0, failed: 0, skipped: 0, remaining: 0 };
  }

  // Filter out those that already have biluppgifter
  const regnummers = ads.map(a => a.regnummer.toUpperCase());
  const { data: existing } = await supabase
    .from('biluppgifter_data')
    .select('regnummer')
    .in('regnummer', regnummers);

  const existingSet = new Set(existing?.map(e => e.regnummer) || []);
  const adsToFetch = ads.filter(a => !existingSet.has(a.regnummer.toUpperCase())).slice(0, limit);

  if (adsToFetch.length === 0) {
    return { success: 0, failed: 0, skipped: 0, remaining: 0 };
  }

  await log('info', `Backfill: fetching biluppgifter for ${adsToFetch.length} ads`);

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const ad of adsToFetch) {
    const regnr = ad.regnummer.toUpperCase();

    try {
      const data = await fetchBiluppgifter(regnr);

      if (data?.owner_profile) {
        await saveBiluppgifter(ad.id, regnr, data);
        success++;
      } else {
        skipped++;
      }
    } catch (error) {
      failed++;
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Count remaining
  const { count: totalWithRegnummer } = await supabase
    .from('blocket_annonser')
    .select('*', { count: 'exact', head: true })
    .is('borttagen', null)
    .not('regnummer', 'is', null);

  const { count: totalFetched } = await supabase
    .from('biluppgifter_data')
    .select('*', { count: 'exact', head: true });

  const remaining = (totalWithRegnummer || 0) - (totalFetched || 0);

  await log('info', 'Backfill completed', { success, failed, skipped, remaining });

  return { success, failed, skipped, remaining };
}
