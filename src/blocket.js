/**
 * Blocket Scraper - Hämtar bilannonser från Blocket.se
 * Baserad på reverse-engineered Blocket API
 */

// Länskoder för Blocket
export const LAN_KODER = {
  norrbotten: "0.300025",
  vasterbotten: "0.300024",
  jamtland: "0.300023",
  vasternorrland: "0.300022",
  gavleborg: "0.300021",
  dalarna: "0.300020",
  vastmanland: "0.300019",
  orebro: "0.300018",
  varmland: "0.300017",
  vastra_gotaland: "0.300014",
  halland: "0.300013",
  skane: "0.300012",
  blekinge: "0.300010",
  gotland: "0.300009",
  kalmar: "0.300008",
  kronoberg: "0.300007",
  jonkoping: "0.300006",
  ostergotland: "0.300005",
  sodermanland: "0.300004",
  uppsala: "0.300003",
  stockholm: "0.300001",
};

// Bränsletyper
export const BRANSLE = {
  bensin: "gasoline",
  diesel: "diesel",
  el: "electric",
  hybrid: "hybrid",
  laddhybrid: "plug_in_hybrid",
  etanol: "ethanol",
  gas: "gas",
};

// Växellåda
export const VAXELLADA = {
  automat: "automatic",
  manuell: "manual",
};

// Kaross
export const KAROSS = {
  sedan: "sedan",
  kombi: "estate",
  suv: "suv",
  cab: "convertible",
  coupe: "coupe",
  halvkombi: "hatchback",
  minibuss: "minivan",
  pickup: "pickup",
};

const BASE_URL = "https://www.blocket.se/mobility/search/car";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
};

/**
 * Extrahera data från Blockets base64-kodade JSON
 * Returnerar { docs: [], metadata: {} }
 */
function extractData(html) {
  const pattern = /<script[^>]*type="application\/json"[^>]*>([^<]+)<\/script>/g;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    try {
      const decoded = Buffer.from(match[1], "base64").toString("utf-8");
      const data = JSON.parse(decoded);

      if (data.queries) {
        for (const query of data.queries) {
          const stateData = query?.state?.data;
          const docs = stateData?.docs;
          if (docs && Array.isArray(docs) && docs.length > 0) {
            return {
              docs,
              metadata: stateData?.metadata || {},
            };
          }
        }
      }
    } catch (e) {
      continue;
    }
  }

  return { docs: [], metadata: {} };
}

/**
 * Bygg URL med filter-parametrar
 */
function buildUrl(params) {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([_, v]) => v !== null && v !== undefined)
  );

  if (Object.keys(filtered).length > 0) {
    const searchParams = new URLSearchParams(filtered);
    return `${BASE_URL}?${searchParams.toString()}`;
  }
  return BASE_URL;
}

/**
 * Formatera annons till standardformat
 */
export function formateraAnnons(annons) {
  const pris = annons.price?.amount || null;
  const bild = annons.image?.url || null;

  // Konstruera URL
  let url = annons.canonical_url;
  if (!url && annons.id) {
    url = `https://www.blocket.se/mobility/item/${annons.id}`;
  }

  // Konvertera timestamp till ISO-datum
  const publicerad = annons.timestamp
    ? new Date(annons.timestamp).toISOString()
    : null;

  return {
    blocket_id: annons.id?.toString(),
    regnummer: annons.regno || null,

    // Bildata
    marke: annons.make || null,
    modell: annons.model || null,
    arsmodell: annons.year || null,
    miltal: annons.mileage || null,
    bransle: annons.fuel || null,
    vaxellada: annons.gearbox || null,
    kaross: annons.body_type || null,
    farg: annons.color || null,
    effekt: annons.engine_power || null,

    // Pris & plats
    pris: pris,
    stad: annons.location || null,  // Staden från API:et (Luleå, Boden, etc.)

    // Säljare
    saljare_namn: annons.organisation_name || null,
    saljare_typ: annons.organisation_name ? "handlare" : "privat",

    // Datum
    publicerad: publicerad,

    // URLs
    url: url,
    bild_url: bild,
  };
}

/**
 * Sök bilar på Blocket
 */
export async function sokBilar(options = {}) {
  const {
    lan,
    marke,
    modell,
    pris_min,
    pris_max,
    arsmodell_min,
    arsmodell_max,
    miltal_min,
    miltal_max,
    bransle,
    kaross,
    vaxellada,
    sida = 1,
  } = options;

  const params = {};

  // Plats/Län
  if (lan && LAN_KODER[lan.toLowerCase()]) {
    params.location = LAN_KODER[lan.toLowerCase()];
  }

  // Märke och modell
  if (marke) params.make = marke.toLowerCase();
  if (modell) params.model = modell.toLowerCase();

  // Pris
  if (pris_min) params.price_from = pris_min;
  if (pris_max) params.price_to = pris_max;

  // Årsmodell
  if (arsmodell_min) params.year_from = arsmodell_min;
  if (arsmodell_max) params.year_to = arsmodell_max;

  // Miltal
  if (miltal_min) params.mileage_from = miltal_min;
  if (miltal_max) params.mileage_to = miltal_max;

  // Bränsle
  if (bransle && BRANSLE[bransle.toLowerCase()]) {
    params.fuel = BRANSLE[bransle.toLowerCase()];
  }

  // Kaross
  if (kaross && KAROSS[kaross.toLowerCase()]) {
    params.body_type = KAROSS[kaross.toLowerCase()];
  }

  // Växellåda
  if (vaxellada && VAXELLADA[vaxellada.toLowerCase()]) {
    params.gearbox = VAXELLADA[vaxellada.toLowerCase()];
  }

  // Sida
  if (sida > 1) params.page = sida;

  const url = buildUrl(params);
  console.log(`🔍 Söker: ${url}`);

  try {
    const response = await fetch(url, { headers: HEADERS });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const { docs, metadata } = extractData(html);

    console.log(`✅ Hittade ${docs.length} bilar`);

    return {
      annonser: docs.map(formateraAnnons),
      metadata,
    };
  } catch (error) {
    console.error(`❌ Fel vid sökning: ${error.message}`);
    return { annonser: [], metadata: {} };
  }
}

/**
 * Hämta alla sidor för en sökning
 * Hämtar först metadata för att veta totalt antal sidor
 */
export async function sokAllaSidor(options = {}) {
  const allaAnnonser = [];

  // Hämta första sidan för att få metadata med totalt antal sidor
  const firstPage = await sokBilar({ ...options, sida: 1 });

  if (firstPage.annonser.length === 0) {
    return allaAnnonser;
  }

  allaAnnonser.push(...firstPage.annonser);

  // Hämta totalt antal sidor från metadata
  const totalPages = firstPage.metadata?.paging?.last || 1;
  const totalAds = firstPage.metadata?.result_size?.match_count || firstPage.annonser.length;

  console.log(`📊 Totalt ${totalAds} annonser på ${totalPages} sidor`);

  // Hämta resterande sidor
  for (let sida = 2; sida <= totalPages; sida++) {
    console.log(`📄 Hämtar sida ${sida}/${totalPages}...`);

    const { annonser } = await sokBilar({ ...options, sida });

    if (annonser.length === 0) break;

    allaAnnonser.push(...annonser);

    // Vänta mellan requests för att inte överbelasta
    await new Promise((r) => setTimeout(r, 800));
  }

  console.log(`✅ Totalt hämtat: ${allaAnnonser.length} annonser`);
  return allaAnnonser;
}

/**
 * Hämta moms-info från enskild annons-sida
 * Returnerar { momsbil: true/false, pris_exkl_moms: number|null }
 */
export async function hamtaMomsInfo(url) {
  try {
    const response = await fetch(url, { headers: HEADERS });

    if (!response.ok) {
      return { momsbil: false, pris_exkl_moms: null };
    }

    const html = await response.text();

    // Ersätt &nbsp; med vanligt mellanslag
    const cleanHtml = html.replace(/&nbsp;/g, ' ');

    // Sök efter moms-mönster: "(255 920 kr exkl. moms)"
    const momsMatch = cleanHtml.match(/\((\d[\d\s]*)\s*kr\s*exkl\.?\s*moms\)/i);

    if (momsMatch) {
      const prisExkl = parseInt(momsMatch[1].replace(/\s/g, ''));
      return {
        momsbil: true,
        pris_exkl_moms: prisExkl,
      };
    }

    return { momsbil: false, pris_exkl_moms: null };
  } catch (error) {
    console.error(`❌ Fel vid hämtning av moms: ${error.message}`);
    return { momsbil: false, pris_exkl_moms: null };
  }
}

/**
 * Hämta ALLA detaljer från enskild annons-sida
 * Returnerar { vaxellada, kaross, farg, momsbil, pris_exkl_moms }
 *
 * OBS: stad hämtas nu från sök-API:et (annons.location) istället för från sidan
 */
export async function hamtaDetaljer(url) {
  const result = {
    vaxellada: null,
    kaross: null,
    farg: null,
    stad: null,  // Fallback när API saknar location
    momsbil: false,
    pris_exkl_moms: null,
  };

  try {
    const response = await fetch(url, { headers: HEADERS });

    if (!response.ok) {
      return result;
    }

    const html = await response.text();
    const cleanHtml = html.replace(/&nbsp;/g, ' ');

    // 1. Extrahera från og:title - format: "Märke Modell - År - Färg - Hk - Kaross | BLOCKET"
    const ogTitleMatch = cleanHtml.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
    if (ogTitleMatch) {
      const title = ogTitleMatch[1];
      // Parsa titel: "Begagnad bil till salu: Kia Sportage - 2023 - Blå - 265 Hk - Kombi | BLOCKET"
      const parts = title.split(' - ');
      if (parts.length >= 4) {
        // Färg är oftast 3:e delen (efter märke/modell och år)
        const possibleColor = parts[2]?.trim();
        if (possibleColor && !possibleColor.match(/^\d+$/) && possibleColor.length < 20) {
          result.farg = possibleColor;
        }
        // Kaross är oftast sista delen före " | BLOCKET"
        const lastPart = parts[parts.length - 1]?.replace(/\s*\|.*$/, '').trim();
        const karossTypes = ['Sedan', 'Kombi', 'SUV', 'Halvkombi', 'Cab', 'Coupé', 'Coupe', 'Minibuss', 'Pickup'];
        if (karossTypes.some(k => lastPart?.toLowerCase().includes(k.toLowerCase()))) {
          result.kaross = lastPart;
        }
      }
    }

    // 2. Extrahera växellåda - först från HTML-struktur, sen från description
    // Mönster: <span>Växellåda</span><p>Automatisk</p> eller <dt>Växellåda</dt><dd>Automatisk</dd>
    const gearMatch = cleanHtml.match(/Växellåda<\/(?:span|dt)><(?:p|dd)[^>]*>([^<]+)/i);
    if (gearMatch) {
      const gearValue = gearMatch[1].trim();
      if (gearValue.toLowerCase().includes('automat')) {
        result.vaxellada = 'Automat';
      } else if (gearValue.toLowerCase().includes('manuell')) {
        result.vaxellada = 'Manuell';
      }
    }

    // Fallback: kolla description
    if (!result.vaxellada) {
      const descMatch = cleanHtml.match(/<meta\s+(?:name="description"|property="og:description")\s+content="([^"]+)"/i);
      if (descMatch) {
        const desc = descMatch[1].toLowerCase();
        if (desc.includes('automat')) {
          result.vaxellada = 'Automat';
        } else if (desc.includes('manuell')) {
          result.vaxellada = 'Manuell';
        }
      }
    }

    // 3. Extrahera färg från HTML-struktur om inte från title
    if (!result.farg) {
      const colorMatch = cleanHtml.match(/Färg<\/(?:span|dt)><(?:p|dd)[^>]*>([^<]+)/i);
      if (colorMatch) {
        result.farg = colorMatch[1].trim();
      }
    }

    // 4. Extrahera kaross från HTML-struktur om inte från title
    if (!result.kaross) {
      const bodyMatch = cleanHtml.match(/Kaross<\/(?:span|dt)><(?:p|dd)[^>]*>([^<]+)/i);
      if (bodyMatch) {
        result.kaross = bodyMatch[1].trim();
      }
    }

    // 5. Moms-info
    const momsMatch = cleanHtml.match(/\((\d[\d\s]*)\s*kr\s*exkl\.?\s*moms\)/i);
    if (momsMatch) {
      result.momsbil = true;
      result.pris_exkl_moms = parseInt(momsMatch[1].replace(/\s/g, ''));
    }

    // 6. Extrahera stad från adress (FALLBACK när API saknar location)
    // Mönster: Google Maps länk med postnr+stad "...query=83171%20%C3%96stersund"
    const mapsMatch = cleanHtml.match(/maps\/search\/\?api=1[^"]*query=(\d{5})%20([^"&]+)/i);
    if (mapsMatch) {
      try {
        const stad = decodeURIComponent(mapsMatch[2]);
        // Formatera: ÖSTERSUND → Östersund
        result.stad = stad.charAt(0).toUpperCase() + stad.slice(1).toLowerCase();
      } catch (e) {
        // Fallback om decoding misslyckas
      }
    }

    return result;
  } catch (error) {
    console.error(`❌ Fel vid hämtning av detaljer: ${error.message}`);
    return result;
  }
}

/**
 * Kolla om en annons är såld/borttagen genom att besöka URL:en
 * Baserad på: https://www.blocket.se/mobility/item/20486291
 *
 * Returnerar { borttagen: true/false, anledning: "SÅLD"|"404"|null }
 */
export async function kollaOmSald(url) {
  try {
    const response = await fetch(url, { headers: HEADERS });
    const html = await response.text();

    // Mönster 1: "Den här annonsen är inte längre tillgänglig"
    // Varan har sålts eller tagits bort från marknaden av säljaren
    if (html.includes("annonsen är inte längre tillgänglig") ||
        html.includes("har sålts eller tagits bort")) {
      return { borttagen: true, anledning: "SÅLD" };
    }

    // Mönster 2: 404 sida
    if (html.includes("Sidan hittades inte") ||
        html.includes("<title>404</title>") ||
        html.includes("Här hittar du allt, förutom den sidan")) {
      return { borttagen: true, anledning: "404" };
    }

    // Annonsen finns fortfarande
    return { borttagen: false, anledning: null };

  } catch (error) {
    console.error(`❌ Fel vid kontroll av ${url}: ${error.message}`);
    // Vid nätverksfel, anta att annonsen fortfarande finns
    return { borttagen: false, anledning: null };
  }
}
