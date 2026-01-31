import { hamtaDetaljer } from "./src/blocket.js";

const testUrls = [
  "https://www.blocket.se/mobility/item/19976494",
  "https://www.blocket.se/mobility/item/19562693",
  "https://www.blocket.se/mobility/item/19000209",
];

async function test() {
  for (const url of testUrls) {
    console.log(`\n🔍 ${url}`);
    const details = await hamtaDetaljer(url);
    console.log("   Resultat:", details);
    await new Promise(r => setTimeout(r, 500));
  }
}

test().catch(console.error);
