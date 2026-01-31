#!/usr/bin/env node

/**
 * Backfill-skript för att uppdatera befintliga annonser med detaljer
 * Hämtar växellåda, kaross, färg, kommun för alla annonser som saknar dessa
 */

import { createClient } from "@supabase/supabase-js";
import { hamtaDetaljer } from "./blocket.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BATCH_SIZE = 100;
const DELAY_MS = 300;

async function backfillDetails() {
  console.log("\n" + "=".repeat(60));
  console.log("🔄 BACKFILL: Uppdaterar befintliga annonser med detaljer");
  console.log("=".repeat(60));
  console.log(`📅 ${new Date().toLocaleString("sv-SE")}`);
  console.log("=".repeat(60) + "\n");

  // Hämta alla annonser som saknar detaljer
  const { count } = await supabase
    .from("blocket_annonser")
    .select("*", { count: "exact", head: true })
    .is("vaxellada", null)
    .is("borttagen", false);

  console.log(`📊 Totalt ${count} annonser saknar detaljer\n`);

  let processed = 0;
  let updated = 0;
  let failed = 0;
  let offset = 0;

  while (offset < count) {
    // Hämta en batch
    const { data: annonser, error } = await supabase
      .from("blocket_annonser")
      .select("id, blocket_id, url, marke, modell")
      .is("vaxellada", null)
      .is("borttagen", false)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error("❌ Fel vid hämtning:", error.message);
      break;
    }

    if (!annonser || annonser.length === 0) break;

    console.log(`\n📦 Batch ${Math.floor(offset / BATCH_SIZE) + 1}: ${annonser.length} annonser`);

    for (const annons of annonser) {
      processed++;

      if (!annons.url) {
        // Bygg URL om den saknas
        annons.url = `https://www.blocket.se/mobility/item/${annons.blocket_id}`;
      }

      try {
        const detaljer = await hamtaDetaljer(annons.url);

        // Uppdatera om vi fick några detaljer
        if (detaljer.vaxellada || detaljer.kaross || detaljer.farg || detaljer.kommun) {
          const { error: updateError } = await supabase
            .from("blocket_annonser")
            .update({
              vaxellada: detaljer.vaxellada,
              kaross: detaljer.kaross,
              farg: detaljer.farg,
              kommun: detaljer.kommun,
              momsbil: detaljer.momsbil,
              pris_exkl_moms: detaljer.pris_exkl_moms,
            })
            .eq("id", annons.id);

          if (!updateError) {
            updated++;
            const info = [detaljer.kaross, detaljer.farg, detaljer.vaxellada].filter(Boolean).join(", ");
            process.stdout.write(`\r  ✅ ${processed}/${count} - ${annons.marke} ${annons.modell}: ${info || "partial"}                    `);
          } else {
            failed++;
          }
        } else {
          // Ingen data hittades - markera som försökt genom att sätta tom sträng
          await supabase
            .from("blocket_annonser")
            .update({ vaxellada: "" })
            .eq("id", annons.id);

          process.stdout.write(`\r  ⚠️  ${processed}/${count} - ${annons.marke} ${annons.modell}: ingen data                    `);
        }

        // Vänta mellan requests
        await new Promise((r) => setTimeout(r, DELAY_MS));

      } catch (err) {
        failed++;
        process.stdout.write(`\r  ❌ ${processed}/${count} - ${annons.marke} ${annons.modell}: ${err.message}                    `);
      }

      // Progress var 100:e
      if (processed % 100 === 0) {
        console.log(`\n📊 Progress: ${processed}/${count} (${Math.round(processed/count*100)}%) - Uppdaterade: ${updated}, Misslyckade: ${failed}`);
      }
    }

    offset += BATCH_SIZE;
  }

  console.log("\n\n" + "=".repeat(60));
  console.log("✅ BACKFILL KLAR!");
  console.log("=".repeat(60));
  console.log(`📊 STATISTIK:`);
  console.log(`   • Processade:   ${processed}`);
  console.log(`   • Uppdaterade:  ${updated}`);
  console.log(`   • Misslyckade:  ${failed}`);
  console.log("=".repeat(60) + "\n");
}

backfillDetails()
  .then(() => {
    console.log("✅ Backfill klar! Håller containern igång...");
    console.log("   Du kan nu byta tillbaka till cron-mode i DigitalOcean.");
    // Håll processen igång så att DO inte startar om
    setInterval(() => {
      console.log(`💤 Idle... ${new Date().toISOString()}`);
    }, 60000);
  })
  .catch((err) => {
    console.error("💥 Kritiskt fel:", err);
    // Håll igång även vid fel så vi kan se loggarna
    setInterval(() => {
      console.log(`❌ Error state... ${new Date().toISOString()}`);
    }, 60000);
  });
