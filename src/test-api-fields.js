#!/usr/bin/env node

/**
 * Test-skript för att undersöka vilka fält som finns i Blockets API-svar
 */

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
};

async function testApiFields() {
  const url = "https://www.blocket.se/mobility/search/car?location=0.300025";

  console.log("🔍 Hämtar Blocket-sida...");
  const response = await fetch(url, { headers: HEADERS });
  const html = await response.text();

  // Extrahera base64-kodad JSON
  const pattern = /<script[^>]*type="application\/json"[^>]*>([^<]+)<\/script>/g;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    try {
      const decoded = Buffer.from(match[1], "base64").toString("utf-8");
      const data = JSON.parse(decoded);

      if (data.queries) {
        for (const query of data.queries) {
          const docs = query?.state?.data?.docs;
          if (docs && Array.isArray(docs) && docs.length > 0) {
            console.log("\n✅ Hittade", docs.length, "annonser\n");

            // Visa alla fält i första annonsen
            const firstDoc = docs[0];
            console.log("📋 ALLA FÄLT I FÖRSTA ANNONSEN:");
            console.log("=".repeat(50));

            for (const [key, value] of Object.entries(firstDoc)) {
              const valueStr = typeof value === 'object'
                ? JSON.stringify(value)
                : String(value);
              console.log(`  ${key}: ${valueStr.substring(0, 80)}`);
            }

            // Sök efter plats-relaterade fält
            console.log("\n🗺️  PLATS-RELATERADE FÄLT:");
            console.log("=".repeat(50));
            const platsFields = ['location', 'municipality', 'city', 'town', 'place', 'area', 'region', 'kommun', 'stad', 'ort'];
            for (const field of platsFields) {
              if (firstDoc[field] !== undefined) {
                console.log(`  ✅ ${field}: ${JSON.stringify(firstDoc[field])}`);
              }
            }

            // Visa några exempel med olika städer
            console.log("\n📍 EXEMPEL PÅ ANNONSER MED PLATSINFO:");
            console.log("=".repeat(50));
            for (let i = 0; i < Math.min(5, docs.length); i++) {
              const doc = docs[i];
              console.log(`  ${i+1}. ${doc.make} ${doc.model}`);
              console.log(`     location: ${doc.location}`);
              console.log(`     municipality: ${doc.municipality}`);
              // Kolla om det finns andra plats-fält
              for (const key of Object.keys(doc)) {
                if (key.toLowerCase().includes('loc') ||
                    key.toLowerCase().includes('city') ||
                    key.toLowerCase().includes('place') ||
                    key.toLowerCase().includes('area') ||
                    key.toLowerCase().includes('muni')) {
                  console.log(`     ${key}: ${JSON.stringify(doc[key])}`);
                }
              }
              console.log("");
            }

            return;
          }
        }
      }
    } catch (e) {
      continue;
    }
  }

  console.log("❌ Kunde inte hitta API-data");
}

testApiFields().catch(console.error);
