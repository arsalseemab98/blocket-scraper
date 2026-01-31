#!/usr/bin/env node

/**
 * Blocket Scraper Bot
 * ===================
 * Daglig scraping av Blocket bilannonser för marknadsanalys
 *
 * Körs på DigitalOcean, sparar till Supabase
 *
 * Hämtar för VARJE annons:
 * - Grunddata från sökresultat: märke, modell, år, pris, miltal, bränsle, region
 * - Detaljer från annonssida: växellåda, kaross, färg, moms-info
 *
 * Användning:
 *   node src/index.js              # Kör scraping en gång
 *   node src/index.js --cron       # Starta med cron-schema
 */

import cron from "node-cron";
import { sokAllaSidor, hamtaDetaljer, LAN_KODER } from "./blocket.js";
import {
  startScraperLog,
  finishScraperLog,
  findAnnons,
  createAnnons,
  updateAnnons,
  loggaPrisandring,
  markeraBorttagna,
  beraknaMarknadsstatistik,
} from "./database.js";

// ============================================
// KONFIGURATION
// ============================================

// Regioner att scrapa - NORRLAND
const REGIONER = [
  "norrbotten",
  "vasterbotten",
  "jamtland",
  "vasternorrland",
];

// Märken att scrapa (null = alla märken i en sökning)
const MARKEN = [
  null, // Hämta ALLA bilar oavsett märke
];

// ============================================
// SCRAPER LOGIK
// ============================================

async function runScraper() {
  console.log("\n" + "=".repeat(60));
  console.log("🚗 BLOCKET NORRLAND-BEVAKNING");
  console.log("=".repeat(60));
  console.log(`📅 ${new Date().toLocaleString("sv-SE")}`);
  console.log(`📍 Regioner: ${REGIONER.join(", ").toUpperCase()}`);
  console.log(`🎯 Mål: Hitta NYA bilannonser + komplettera detaljer`);
  console.log("=".repeat(60) + "\n");

  // Samla alla nya annonser för slutrapport
  const nyaAnnonserLista = [];

  const stats = {
    hittade: 0,
    nya: 0,
    uppdaterade: 0,
    prisandringar: 0,
    kompletterade: 0,  // Befintliga annonser som fick detaljer
  };

  // Starta loggning
  const logId = await startScraperLog(REGIONER, MARKEN.filter(Boolean));

  try {
    // Håll koll på sedda blocket_id:n för denna körning
    const seddaIds = new Set();

    // Scrapa varje region
    for (const region of REGIONER) {
      console.log(`\n📍 REGION: ${region.toUpperCase()}`);
      console.log("-".repeat(40));

      // Scrapa varje märke (eller alla)
      for (const marke of MARKEN) {
        const label = marke || "alla märken";
        console.log(`\n🔍 Söker: ${label} i ${region}...`);

        const annonser = await sokAllaSidor({
          lan: region,
          marke: marke,
        });

        stats.hittade += annonser.length;

        // Processa varje annons
        for (const annons of annonser) {
          if (!annons.blocket_id) continue;

          // Hoppa över om vi redan sett denna i denna körning
          if (seddaIds.has(annons.blocket_id)) continue;
          seddaIds.add(annons.blocket_id);

          // Kolla om den finns i databasen
          const existing = await findAnnons(annons.blocket_id);

          if (!existing) {
            // ========================================
            // NY ANNONS - hämta ALLA detaljer
            // ========================================
            let detaljer = {
              vaxellada: null,
              kaross: null,
              farg: null,
              momsbil: false,
              pris_exkl_moms: null
            };

            if (annons.url) {
              console.log(`  🔍 Hämtar detaljer för ${annons.marke} ${annons.modell}...`);
              detaljer = await hamtaDetaljer(annons.url);
              await new Promise((r) => setTimeout(r, 200));
            }

            const created = await createAnnons({
              ...annons,
              region: region,
              vaxellada: detaljer.vaxellada,
              kaross: detaljer.kaross,
              farg: detaljer.farg,
              momsbil: detaljer.momsbil,
              pris_exkl_moms: detaljer.pris_exkl_moms,
            });

            if (created) {
              stats.nya++;
              const momsText = detaljer.momsbil ? ` 💵 MOMS` : '';
              const detaljText = [detaljer.kaross, detaljer.farg, detaljer.vaxellada].filter(Boolean).join(', ');
              console.log(`  ✨ NY: ${annons.marke} ${annons.modell} - ${annons.pris?.toLocaleString()} kr${momsText} | ${detaljText || '-'} | ${region}`);

              // Spara för slutrapport
              nyaAnnonserLista.push({
                marke: annons.marke,
                modell: annons.modell,
                pris: annons.pris,
                arsmodell: annons.arsmodell,
                region: region,
                regnummer: annons.regnummer,
                url: annons.url,
                momsbil: detaljer.momsbil,
                pris_exkl_moms: detaljer.pris_exkl_moms,
                vaxellada: detaljer.vaxellada,
                kaross: detaljer.kaross,
                farg: detaljer.farg,
              });
            }
          } else {
            // ========================================
            // BEFINTLIG ANNONS
            // ========================================
            await updateAnnons(existing.id, {});
            stats.uppdaterade++;

            // Kolla prisändring
            if (annons.pris && existing.pris && annons.pris !== existing.pris) {
              await loggaPrisandring(existing.id, annons.pris);
              await updateAnnons(existing.id, { pris: annons.pris });
              stats.prisandringar++;

              const diff = annons.pris - existing.pris;
              const sign = diff > 0 ? "+" : "";
              console.log(
                `  💰 PRISÄNDRING: ${annons.marke} ${annons.modell}: ${existing.pris} → ${annons.pris} (${sign}${diff})`
              );
            }

            // Komplettera detaljer om de saknas
            if (!existing.vaxellada && annons.url) {
              const detaljer = await hamtaDetaljer(annons.url);

              if (detaljer.vaxellada || detaljer.kaross || detaljer.farg) {
                await updateAnnons(existing.id, {
                  vaxellada: detaljer.vaxellada,
                  kaross: detaljer.kaross,
                  farg: detaljer.farg,
                  momsbil: detaljer.momsbil,
                  pris_exkl_moms: detaljer.pris_exkl_moms,
                });
                stats.kompletterade++;
                const detaljText = [detaljer.kaross, detaljer.farg, detaljer.vaxellada].filter(Boolean).join(', ');
                console.log(`  🔧 KOMPLETTERAD: ${annons.marke} ${annons.modell}: ${detaljText}`);
              }

              await new Promise((r) => setTimeout(r, 200));
            }
          }
        }

        // Vänta mellan sökningar
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Markera borttagna annonser (ej sedda på 2 dagar)
    console.log("\n🗑️  Markerar borttagna annonser...");
    const borttagna = await markeraBorttagna(2);
    console.log(`   ${borttagna} annonser markerade som borttagna`);

    // Beräkna daglig statistik
    console.log("\n📊 Beräknar marknadsstatistik...");
    await beraknaMarknadsstatistik();

    // Avsluta loggning
    if (logId) {
      await finishScraperLog(logId, stats);
    }

    // Sammanfattning
    console.log("\n" + "=".repeat(60));
    console.log("✅ SCRAPING KLAR!");
    console.log("=".repeat(60));
    console.log(`📊 STATISTIK:`);
    console.log(`   • Annonser scannade:  ${stats.hittade}`);
    console.log(`   • NYA annonser:       ${stats.nya} 🆕`);
    console.log(`   • Kompletterade:      ${stats.kompletterade} 🔧`);
    console.log(`   • Prisändringar:      ${stats.prisandringar} 💰`);
    console.log(`   • Borttagna (sålda?): ${borttagna} 🗑️`);
    console.log("=".repeat(60));

    // Visa lista över NYA annonser
    if (nyaAnnonserLista.length > 0) {
      console.log("\n🆕 NYA ANNONSER DENNA KÖRNING:");
      console.log("-".repeat(60));
      nyaAnnonserLista.slice(0, 20).forEach((bil, i) => {
        const momsText = bil.momsbil ? ' 💵' : '';
        const detaljText = [bil.kaross, bil.farg, bil.vaxellada].filter(Boolean).join(', ');
        console.log(`${i + 1}. ${bil.marke} ${bil.modell} ${bil.arsmodell || ''}`);
        console.log(`   💰 ${bil.pris?.toLocaleString()} kr${momsText} | 📍 ${bil.region} | 🔢 ${bil.regnummer || '-'}`);
        console.log(`   📋 ${detaljText || '-'}`);
      });
      if (nyaAnnonserLista.length > 20) {
        console.log(`\n   ... och ${nyaAnnonserLista.length - 20} fler nya annonser`);
      }
    } else {
      console.log("\n📭 Inga nya annonser sedan förra körningen");
    }

    console.log("\n" + "=".repeat(60) + "\n");

    return { stats, nyaAnnonser: nyaAnnonserLista };
  } catch (error) {
    console.error("\n❌ FEL:", error.message);

    if (logId) {
      await finishScraperLog(logId, stats, error.message);
    }

    throw error;
  }
}

// ============================================
// HUVUDPROGRAM
// ============================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--cron")) {
    // Kör med cron-schema: 2 gånger per dag (06:00 och 18:00)
    console.log("⏰ Startar cron-schema: Kl 06:00 och 18:00 varje dag");
    console.log("   Regioner: Norrbotten, Västerbotten, Jämtland, Västernorrland");
    console.log("   Kör även en gång direkt...\n");

    // Kör direkt vid start
    await runScraper();

    // Morgon-körning kl 06:00
    cron.schedule("0 6 * * *", async () => {
      console.log("\n⏰ MORGON-KÖRNING (06:00) - Startar scraping...");
      await runScraper();
    });

    // Kvälls-körning kl 18:00
    cron.schedule("0 18 * * *", async () => {
      console.log("\n⏰ KVÄLLS-KÖRNING (18:00) - Startar scraping...");
      await runScraper();
    });

    // Håll processen igång
    console.log("\n🔄 Bot aktiv - Väntar på nästa körning (06:00 eller 18:00)...");
  } else {
    // Kör en gång
    await runScraper();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("💥 Kritiskt fel:", error);
  process.exit(1);
});
