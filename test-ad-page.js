/**
 * Test script to analyze Blocket ad page structure
 */

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
};

async function analyzeAdPage(url) {
  console.log(`\n🔍 Analyserar: ${url}\n`);

  const response = await fetch(url, { headers: HEADERS });
  const html = await response.text();

  console.log(`📄 HTML längd: ${html.length} tecken\n`);

  // 1. Hitta alla base64-kodade JSON script-taggar
  const pattern = /<script[^>]*type="application\/json"[^>]*>([^<]+)<\/script>/g;
  let match;
  let scriptCount = 0;

  while ((match = pattern.exec(html)) !== null) {
    scriptCount++;
    try {
      const decoded = Buffer.from(match[1], "base64").toString("utf-8");
      const data = JSON.parse(decoded);

      console.log(`\n📦 Script #${scriptCount}:`);
      console.log(`   Keys: ${Object.keys(data).join(", ")}`);

      // Om det finns queries, visa strukturen
      if (data.queries) {
        console.log(`   Queries: ${data.queries.length}`);
        for (let i = 0; i < data.queries.length; i++) {
          const q = data.queries[i];
          const stateData = q?.state?.data;
          if (stateData) {
            console.log(`\n   Query ${i} state.data keys:`);
            console.log(`   ${Object.keys(stateData).join(", ")}`);

            // Visa värden för relevanta fält
            const relevantFields = ['gearbox', 'body_type', 'color', 'municipality', 'location', 'fuel', 'make', 'model'];
            for (const field of relevantFields) {
              if (stateData[field] !== undefined) {
                console.log(`   ${field}: ${stateData[field]}`);
              }
            }
          }
        }
      }
    } catch (e) {
      console.log(`   ⚠️ Kunde inte parsa script #${scriptCount}: ${e.message}`);
    }
  }

  console.log(`\n📊 Totalt ${scriptCount} script-taggar hittade\n`);

  // 2. Sök efter specifika mönster i HTML
  console.log("🔎 Söker efter mönster i HTML...\n");

  // Växellåda
  const gearPatterns = [
    /Växellåda[:\s]*([^<,\n]+)/i,
    /"gearbox"[:\s]*"([^"]+)"/i,
    /gearbox[:\s]*([^<,\n"]+)/i,
  ];

  for (const pat of gearPatterns) {
    const m = html.match(pat);
    if (m) console.log(`   Växellåda: "${m[1].trim()}"`);
  }

  // Kaross
  const bodyPatterns = [
    /Kaross[:\s]*([^<,\n]+)/i,
    /"body_type"[:\s]*"([^"]+)"/i,
  ];

  for (const pat of bodyPatterns) {
    const m = html.match(pat);
    if (m) console.log(`   Kaross: "${m[1].trim()}"`);
  }

  // Färg
  const colorPatterns = [
    /Färg[:\s]*([^<,\n]+)/i,
    /"color"[:\s]*"([^"]+)"/i,
  ];

  for (const pat of colorPatterns) {
    const m = html.match(pat);
    if (m) console.log(`   Färg: "${m[1].trim()}"`);
  }

  // Spara HTML för inspektion
  const fs = await import('fs');
  fs.writeFileSync('/tmp/blocket-ad.html', html);
  console.log("\n💾 HTML sparad till /tmp/blocket-ad.html");
}

// Testa med en riktig annons-URL
const testUrl = process.argv[2] || "https://www.blocket.se/mobility/item/19976494";
analyzeAdPage(testUrl).catch(console.error);
