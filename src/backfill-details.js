#!/usr/bin/env node

/**
 * Backfill-skript för att uppdatera befintliga annonser med detaljer
 * Hämtar växellåda, kaross, färg för alla annonser som saknar dessa
 *
 * PARALLEL VERSION - 5 samtidiga requests för snabbare processing
 */

import { createClient } from "@supabase/supabase-js";
import { hamtaDetaljer } from "./blocket.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BATCH_SIZE = 100;
const CONCURRENCY = 5;  // Antal parallella requests
const DELAY_BETWEEN_BATCHES_MS = 500;  // Delay mellan batchar

// Process en annons
async function processAnnons(annons, stats, total) {
  if (!annons.url) {
    annons.url = `https://www.blocket.se/mobility/item/${annons.blocket_id}`;
  }

  try {
    const detaljer = await hamtaDetaljer(annons.url);

    if (detaljer.vaxellada || detaljer.kaross || detaljer.farg || detaljer.stad) {
      const { error: updateError } = await supabase
        .from("blocket_annonser")
        .update({
          vaxellada: detaljer.vaxellada,
          kaross: detaljer.kaross,
          farg: detaljer.farg,
          stad: detaljer.stad,
          momsbil: detaljer.momsbil,
          pris_exkl_moms: detaljer.pris_exkl_moms,
        })
        .eq("id", annons.id);

      if (!updateError) {
        stats.updated++;
        return { success: true, annons, detaljer };
      } else {
        stats.failed++;
        return { success: false, annons, error: updateError.message };
      }
    } else {
      // Ingen data - markera som försökt
      await supabase
        .from("blocket_annonser")
        .update({ vaxellada: "" })
        .eq("id", annons.id);

      stats.noData++;
      return { success: true, annons, noData: true };
    }
  } catch (err) {
    stats.failed++;
    return { success: false, annons, error: err.message };
  }
}

// Process en chunk parallellt
async function processChunk(chunk, stats, total) {
  const promises = chunk.map(annons => processAnnons(annons, stats, total));
  return Promise.all(promises);
}

async function backfillDetails() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 BACKFILL PARALLEL: Uppdaterar annonser med detaljer");
  console.log("=".repeat(60));
  console.log(`📅 ${new Date().toLocaleString("sv-SE")}`);
  console.log(`⚡ Concurrency: ${CONCURRENCY} parallella requests`);
  console.log("=".repeat(60) + "\n");

  // Hämta alla annonser som saknar detaljer
  const { count } = await supabase
    .from("blocket_annonser")
    .select("*", { count: "exact", head: true })
    .is("vaxellada", null)
    .is("borttagen", null);

  console.log(`📊 Totalt ${count} annonser saknar detaljer\n`);

  if (!count || count === 0) {
    console.log("⚠️ Inga annonser att uppdatera!");
    return;
  }

  const stats = { processed: 0, updated: 0, failed: 0, noData: 0 };
  let batchNum = 0;
  const startTime = Date.now();

  // Ingen offset! Processade annonser matchar inte längre WHERE vaxellada IS NULL
  while (true) {
    batchNum++;

    // Hämta en batch - alltid från början (processade försvinner från resultatet)
    const { data: annonser, error } = await supabase
      .from("blocket_annonser")
      .select("id, blocket_id, url, marke, modell")
      .is("vaxellada", null)
      .is("borttagen", null)
      .limit(BATCH_SIZE);

    if (error) {
      console.error("❌ Fel vid hämtning:", error.message);
      break;
    }

    if (!annonser || annonser.length === 0) break;

    console.log(`\n📦 Batch ${batchNum}: ${annonser.length} annonser`);

    // Dela upp i chunks för parallell processing
    for (let i = 0; i < annonser.length; i += CONCURRENCY) {
      const chunk = annonser.slice(i, i + CONCURRENCY);
      const results = await processChunk(chunk, stats, count);

      stats.processed += chunk.length;

      // Visa progress
      const successCount = results.filter(r => r.success && !r.noData).length;
      const noDataCount = results.filter(r => r.noData).length;

      process.stdout.write(`\r  ⚡ ${stats.processed}/${count} (${Math.round(stats.processed/count*100)}%) | ✅ ${stats.updated} | ⚠️ ${stats.noData} | ❌ ${stats.failed}    `);
    }

    // Kort paus mellan batchar
    await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));

    // Progress-rapport var 500:e
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
  console.log("✅ BACKFILL KLAR!");
  console.log("=".repeat(60));
  console.log(`📊 STATISTIK:`);
  console.log(`   • Processade:   ${stats.processed}`);
  console.log(`   • Uppdaterade:  ${stats.updated}`);
  console.log(`   • Ingen data:   ${stats.noData}`);
  console.log(`   • Misslyckade:  ${stats.failed}`);
  console.log(`   • Total tid:    ${Math.round(totalTime/60)} min ${Math.round(totalTime%60)} sek`);
  console.log(`   • Hastighet:    ${(stats.processed/totalTime).toFixed(1)} annonser/sek`);
  console.log("=".repeat(60) + "\n");
}

backfillDetails()
  .then(() => {
    console.log("✅ Backfill klar! Håller containern igång...");
    console.log("   Du kan nu byta tillbaka till cron-mode i DigitalOcean.");
    setInterval(() => {
      console.log(`💤 Idle... ${new Date().toISOString()}`);
    }, 60000);
  })
  .catch((err) => {
    console.error("💥 Kritiskt fel:", err);
    setInterval(() => {
      console.log(`❌ Error state... ${new Date().toISOString()}`);
    }, 60000);
  });
