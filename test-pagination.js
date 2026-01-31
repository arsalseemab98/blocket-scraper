/**
 * Test pagination - hämtar alla annonser utan att spara till databas
 */

import { sokAllaSidor, LAN_KODER } from "./src/blocket.js";

const REGIONER = ["norrbotten", "vasterbotten", "jamtland", "vasternorrland"];

async function testPagination() {
  console.log("\n" + "=".repeat(60));
  console.log("🧪 TEST: HÄMTA ALLA ANNONSER FRÅN BLOCKET");
  console.log("=".repeat(60));
  console.log(`📅 ${new Date().toLocaleString("sv-SE")}`);
  console.log("=".repeat(60) + "\n");

  let totalAnnonser = 0;
  const results = {};

  for (const region of REGIONER) {
    console.log(`\n📍 REGION: ${region.toUpperCase()}`);
    console.log("-".repeat(40));

    const annonser = await sokAllaSidor({ lan: region });

    results[region] = annonser.length;
    totalAnnonser += annonser.length;

    // Visa några exempel
    console.log(`\n  Exempel på annonser:`);
    annonser.slice(0, 3).forEach((a, i) => {
      console.log(`    ${i+1}. ${a.marke} ${a.modell} - ${a.pris?.toLocaleString()} kr (${a.saljare_typ})`);
    });
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 RESULTAT");
  console.log("=".repeat(60));
  for (const [region, count] of Object.entries(results)) {
    console.log(`  ${region.padEnd(15)}: ${count.toLocaleString()} annonser`);
  }
  console.log("-".repeat(40));
  console.log(`  ${"TOTALT".padEnd(15)}: ${totalAnnonser.toLocaleString()} annonser`);
  console.log("=".repeat(60) + "\n");
}

testPagination().catch(console.error);
