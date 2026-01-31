#!/usr/bin/env node

/**
 * Backfill-skript för att uppdatera annonser som saknar stad
 * Hämtar stad från Google Maps-länk på annonssidan
 *
 * PARALLEL VERSION - 5 samtidiga requests
 */

import { createClient } from "@supabase/supabase-js";
import { hamtaDetaljer } from "./blocket.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BATCH_SIZE = 100;
const CONCURRENCY = 5;
const DELAY_BETWEEN_BATCHES_MS = 500;

async function processAnnons(annons, stats) {
  if (!annons.url) {
    annons.url = `https://www.blocket.se/mobility/item/${annons.blocket_id}`;
  }

  try {
    const detaljer = await hamtaDetaljer(annons.url);

    if (detaljer.stad) {
      const { error: updateError } = await supabase
        .from("blocket_annonser")
        .update({ stad: detaljer.stad })
        .eq("id", annons.id);

      if (!updateError) {
        stats.updated++;
        return { success: true, annons, stad: detaljer.stad };
      } else {
        stats.failed++;
        return { success: false, annons, error: updateError.message };
      }
    } else {
      stats.noData++;
      return { success: true, annons, noData: true };
    }
  } catch (err) {
    stats.failed++;
    return { success: false, annons, error: err.message };
  }
}

async function processChunk(chunk, stats) {
  const promises = chunk.map(annons => processAnnons(annons, stats));
  return Promise.all(promises);
}

async function backfillStad() {
  console.log("\n" + "=".repeat(60));
  console.log("🏙️  BACKFILL STAD: Uppdaterar annonser utan stad");
  console.log("=".repeat(60));
  console.log(`📅 ${new Date().toLocaleString("sv-SE")}`);
  console.log(`⚡ Concurrency: ${CONCURRENCY} parallella requests`);
  console.log("=".repeat(60) + "\n");

  // Räkna annonser som saknar stad
  const { count } = await supabase
    .from("blocket_annonser")
    .select("*", { count: "exact", head: true })
    .is("stad", null)
    .is("borttagen", null);

  console.log(`📊 Totalt ${count} annonser saknar stad\n`);

  if (!count || count === 0) {
    console.log("⚠️ Inga annonser att uppdatera!");
    return;
  }

  const stats = { processed: 0, updated: 0, failed: 0, noData: 0 };
  let batchNum = 0;
  const startTime = Date.now();

  while (true) {
    batchNum++;

    const { data: annonser, error } = await supabase
      .from("blocket_annonser")
      .select("id, blocket_id, url, marke, modell, region")
      .is("stad", null)
      .is("borttagen", null)
      .limit(BATCH_SIZE);

    if (error) {
      console.error("❌ Fel vid hämtning:", error.message);
      break;
    }

    if (!annonser || annonser.length === 0) break;

    console.log(`\n📦 Batch ${batchNum}: ${annonser.length} annonser`);

    for (let i = 0; i < annonser.length; i += CONCURRENCY) {
      const chunk = annonser.slice(i, i + CONCURRENCY);
      const results = await processChunk(chunk, stats);

      stats.processed += chunk.length;

      // Visa städer som hittades
      const found = results.filter(r => r.stad);
      if (found.length > 0) {
        found.forEach(r => {
          console.log(`  ✅ ${r.annons.marke} ${r.annons.modell} | 📍 ${r.stad}`);
        });
      }

      process.stdout.write(`\r  ⚡ ${stats.processed}/${count} (${Math.round(stats.processed/count*100)}%) | ✅ ${stats.updated} | ⚠️ ${stats.noData} | ❌ ${stats.failed}    `);
    }

    await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));

    // Progress var 500:e
    if (stats.processed % 500 === 0) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = stats.processed / elapsed;
      const remaining = (count - stats.processed) / rate;
      console.log(`\n📊 Progress: ${stats.processed}/${count} (${Math.round(stats.processed/count*100)}%)`);
      console.log(`   ⏱️ Hastighet: ${rate.toFixed(1)}/sek | Återstår: ~${Math.round(remaining/60)} min`);
    }
  }

  const totalTime = (Date.now() - startTime) / 1000;

  console.log("\n\n" + "=".repeat(60));
  console.log("✅ BACKFILL STAD KLAR!");
  console.log("=".repeat(60));
  console.log(`📊 STATISTIK:`);
  console.log(`   • Processade:   ${stats.processed}`);
  console.log(`   • Uppdaterade:  ${stats.updated}`);
  console.log(`   • Ingen stad:   ${stats.noData}`);
  console.log(`   • Misslyckade:  ${stats.failed}`);
  console.log(`   • Total tid:    ${Math.round(totalTime/60)} min ${Math.round(totalTime%60)} sek`);
  console.log(`   • Hastighet:    ${(stats.processed/totalTime).toFixed(1)} annonser/sek`);
  console.log("=".repeat(60) + "\n");

  // Visa slutstatus per region
  const { data: regionStats } = await supabase.rpc('exec_sql', {
    sql: `SELECT region, COUNT(*) as total, COUNT(stad) as med_stad,
          ROUND(100.0 * COUNT(stad) / COUNT(*), 1) as procent
          FROM blocket_annonser WHERE borttagen IS NULL
          GROUP BY region ORDER BY procent DESC`
  });

  if (regionStats) {
    console.log("\n📊 SLUTSTATUS PER REGION:");
    regionStats.forEach(r => {
      console.log(`   ${r.region}: ${r.procent}% (${r.med_stad}/${r.total})`);
    });
  }
}

backfillStad()
  .then(() => {
    console.log("\n✅ Backfill stad klar!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("💥 Kritiskt fel:", err);
    process.exit(1);
  });
