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
import { sokAllaSidor, sokNyaste, hamtaDetaljer, kollaOmSald, LAN_KODER } from "./blocket.js";
import {
  startScraperLog,
  finishScraperLog,
  findAnnons,
  createAnnons,
  updateAnnons,
  loggaPrisandring,
  markeraBorttagna,
  hamtaEjSeddaAnnonser,
  markeraAnnonsSald,
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
              // stad kommer nu från annons.stad (sök-API:et) via spread
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
              const stadText = annons.stad ? ` 📍 ${annons.stad}` : '';
              console.log(`  ✨ NY: ${annons.marke} ${annons.modell} - ${annons.pris?.toLocaleString()} kr${momsText} | ${detaljText || '-'} | ${region}${stadText}`);

              // Spara för slutrapport
              nyaAnnonserLista.push({
                marke: annons.marke,
                modell: annons.modell,
                pris: annons.pris,
                arsmodell: annons.arsmodell,
                region: region,
                stad: annons.stad,  // Kommer från sök-API:et
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
            // Uppdatera publicerad om den saknas
            const updates = {};
            if (!existing.publicerad && annons.publicerad) {
              updates.publicerad = annons.publicerad;
            }
            await updateAnnons(existing.id, updates);
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

            // Komplettera stad från API om den saknas
            if (!existing.stad && annons.stad) {
              await updateAnnons(existing.id, { stad: annons.stad });
              stats.kompletterade++;
              console.log(`  🔧 KOMPLETTERAD stad: ${annons.marke} ${annons.modell} | 📍 ${annons.stad}`);
            }

            // Komplettera detaljer om de saknas (växellåda, kaross, färg, eller stad som fallback)
            if ((!existing.vaxellada || !existing.stad) && annons.url) {
              const detaljer = await hamtaDetaljer(annons.url);

              const updates = {};
              if (detaljer.vaxellada) updates.vaxellada = detaljer.vaxellada;
              if (detaljer.kaross) updates.kaross = detaljer.kaross;
              if (detaljer.farg) updates.farg = detaljer.farg;
              if (detaljer.momsbil) updates.momsbil = detaljer.momsbil;
              if (detaljer.pris_exkl_moms) updates.pris_exkl_moms = detaljer.pris_exkl_moms;

              // Fallback: hämta stad från sidan om API saknar den
              if (!existing.stad && !annons.stad && detaljer.stad) {
                updates.stad = detaljer.stad;
              }

              if (Object.keys(updates).length > 0) {
                await updateAnnons(existing.id, updates);
                stats.kompletterade++;
                const detaljText = [detaljer.kaross, detaljer.farg, detaljer.vaxellada].filter(Boolean).join(', ');
                const stadText = updates.stad ? ` | 📍 ${updates.stad}` : '';
                console.log(`  🔧 KOMPLETTERAD: ${annons.marke} ${annons.modell}: ${detaljText}${stadText}`);
              }

              await new Promise((r) => setTimeout(r, 200));
            }
          }
        }

        // Vänta mellan sökningar
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // ========================================
    // KOLLA SÅLDA ANNONSER - besök URL:er
    // ========================================
    console.log("\n🔍 Kollar om annonser är sålda...");

    // Hämta annonser som INTE sågs i sökningen
    const ejSedda = await hamtaEjSeddaAnnonser(seddaIds);
    console.log(`   ${ejSedda.length} annonser att kontrollera`);

    let saldaCount = 0;
    const saldaLista = [];

    // Kolla varje annons (max 100 per körning för att inte överbelasta)
    const attKolla = ejSedda.slice(0, 100);

    for (const annons of attKolla) {
      const url = annons.url || `https://www.blocket.se/mobility/item/${annons.blocket_id}`;
      const { borttagen, anledning } = await kollaOmSald(url);

      if (borttagen) {
        await markeraAnnonsSald(annons.id, anledning);
        saldaCount++;
        saldaLista.push({
          ...annons,
          anledning,
        });
        console.log(`   🏷️  SÅLD: ${annons.marke} ${annons.modell} (${annons.regnummer || '-'}) - ${anledning}`);
      }

      // Vänta lite mellan requests
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log(`   ✅ ${saldaCount} annonser markerade som sålda`);

    // Fallback: Markera gamla som borttagna (ej sedda på 7 dagar)
    const borttagna = await markeraBorttagna(7);
    if (borttagna > 0) {
      console.log(`   🗑️  ${borttagna} gamla annonser markerade som borttagna (7+ dagar)`);
    }

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
    console.log(`   • SÅLDA (verifierat): ${saldaCount} 🏷️`);
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

    // Visa lista över SÅLDA annonser
    if (saldaLista.length > 0) {
      console.log("\n🏷️  SÅLDA ANNONSER DENNA KÖRNING:");
      console.log("-".repeat(60));
      saldaLista.slice(0, 10).forEach((bil, i) => {
        console.log(`${i + 1}. ${bil.marke} ${bil.modell} | 🔢 ${bil.regnummer || '-'} | ${bil.anledning}`);
      });
      if (saldaLista.length > 10) {
        console.log(`\n   ... och ${saldaLista.length - 10} fler sålda annonser`);
      }
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
// LIGHT SCRAPE - Snabb polling för nya bilar
// ============================================

async function runLightScrape() {
  const now = new Date();
  const hour = now.getHours();

  // Kör endast mellan 07:00-22:00
  if (hour < 7 || hour >= 22) {
    console.log(`⏸️  Light scrape pausad (kl ${hour}:00 - körs endast 07:00-22:00)`);
    return;
  }

  console.log("\n" + "-".repeat(40));
  console.log("⚡ LIGHT SCRAPE - Söker nya annonser");
  console.log(`📅 ${now.toLocaleString("sv-SE")}`);
  console.log("-".repeat(40));

  let nyaAnnonser = 0;
  let totaltHittade = 0;

  try {
    for (const region of REGIONER) {
      // Hämta endast sida 1 (nyaste annonser)
      const annonser = await sokNyaste({ lan: region });
      totaltHittade += annonser.length;

      for (const annons of annonser) {
        if (!annons.blocket_id) continue;

        // Kolla om den redan finns
        const existing = await findAnnons(annons.blocket_id);

        if (!existing) {
          // NY ANNONS - hämta detaljer och spara
          let detaljer = {
            vaxellada: null,
            kaross: null,
            farg: null,
            momsbil: false,
            pris_exkl_moms: null
          };

          if (annons.url) {
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
            nyaAnnonser++;
            const stadText = annons.stad ? ` | 📍 ${annons.stad}` : '';
            console.log(`  ✨ NY: ${annons.marke} ${annons.modell} - ${annons.pris?.toLocaleString()} kr | ${region}${stadText}`);
          }
        }
      }

      // Kort paus mellan regioner
      await new Promise((r) => setTimeout(r, 500));
    }

    console.log(`\n⚡ Light scrape klar: ${nyaAnnonser} nya av ${totaltHittade} scannade`);
    console.log("-".repeat(40) + "\n");

  } catch (error) {
    console.error("❌ Light scrape fel:", error.message);
  }
}

// ============================================
// HUVUDPROGRAM
// ============================================

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--cron")) {
    // Kör med cron-schema
    console.log("⏰ Startar cron-schema:");
    console.log("   📋 FULL SCRAPE: Kl 06:00 och 18:00 varje dag");
    console.log("   ⚡ LIGHT SCRAPE: Var 15:e minut (07:00-22:00)");
    console.log("   📍 Regioner: Norrbotten, Västerbotten, Jämtland, Västernorrland");
    console.log("   Kör full scrape direkt...\n");

    // Kör full scrape direkt vid start
    await runScraper();

    // ========================================
    // LIGHT SCRAPE - var 15:e minut (07:00-22:00)
    // ========================================
    cron.schedule("*/15 * * * *", async () => {
      await runLightScrape();
    });

    // ========================================
    // FULL SCRAPE - 2x per dag
    // ========================================

    // Morgon-körning kl 06:00
    cron.schedule("0 6 * * *", async () => {
      console.log("\n⏰ MORGON-KÖRNING (06:00) - Startar full scraping...");
      await runScraper();
    });

    // Kvälls-körning kl 18:00
    cron.schedule("0 18 * * *", async () => {
      console.log("\n⏰ KVÄLLS-KÖRNING (18:00) - Startar full scraping...");
      await runScraper();
    });

    // Håll processen igång
    console.log("\n🔄 Bot aktiv - Light scrape var 15:e min, Full scrape 06:00 & 18:00...");
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
