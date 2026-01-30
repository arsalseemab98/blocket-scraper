/**
 * Supabase Database Handler
 * Hanterar alla databasoperationer för Blocket-scrapern
 */

import { createClient } from "@supabase/supabase-js";

// Supabase config - sätt via miljövariabler
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rueqiiqxkazocconmnwp.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_KEY) {
  console.error("❌ SUPABASE_SERVICE_KEY saknas i miljövariabler!");
  process.exit(1);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Starta ny scraper-körning och logga
 */
export async function startScraperLog(regioner, marken) {
  const { data, error } = await supabase
    .from("blocket_scraper_log")
    .insert({
      status: "running",
      regioner_sokta: regioner,
      marken_sokta: marken,
    })
    .select()
    .single();

  if (error) {
    console.error("❌ Kunde inte skapa log:", error.message);
    return null;
  }

  return data.id;
}

/**
 * Avsluta scraper-körning
 */
export async function finishScraperLog(logId, stats, error = null) {
  const { error: updateError } = await supabase
    .from("blocket_scraper_log")
    .update({
      finished_at: new Date().toISOString(),
      status: error ? "failed" : "completed",
      annonser_hittade: stats.hittade || 0,
      nya_annonser: stats.nya || 0,
      uppdaterade_annonser: stats.uppdaterade || 0,
      prisandringar: stats.prisandringar || 0,
      error_message: error,
    })
    .eq("id", logId);

  if (updateError) {
    console.error("❌ Kunde inte uppdatera log:", updateError.message);
  }
}

/**
 * Hitta befintlig annons via blocket_id
 */
export async function findAnnons(blocketId) {
  const { data, error } = await supabase
    .from("blocket_annonser")
    .select("*")
    .eq("blocket_id", blocketId)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = no rows
    console.error("❌ Fel vid sökning:", error.message);
  }

  return data;
}

/**
 * Skapa ny annons
 */
export async function createAnnons(annons) {
  const { data, error } = await supabase
    .from("blocket_annonser")
    .insert(annons)
    .select()
    .single();

  if (error) {
    console.error("❌ Kunde inte skapa annons:", error.message);
    return null;
  }

  // Skapa första prishistorik-posten
  if (annons.pris) {
    await supabase.from("blocket_prishistorik").insert({
      annons_id: data.id,
      pris: annons.pris,
    });
  }

  return data;
}

/**
 * Uppdatera befintlig annons
 */
export async function updateAnnons(id, updates) {
  const { error } = await supabase
    .from("blocket_annonser")
    .update({
      ...updates,
      senast_sedd: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("❌ Kunde inte uppdatera annons:", error.message);
    return false;
  }

  return true;
}

/**
 * Logga prisändring
 */
export async function loggaPrisandring(annonsId, nyttPris) {
  const { error } = await supabase.from("blocket_prishistorik").insert({
    annons_id: annonsId,
    pris: nyttPris,
  });

  if (error) {
    console.error("❌ Kunde inte logga prisändring:", error.message);
    return false;
  }

  return true;
}

/**
 * Markera annonser som borttagna (ej sedda på X dagar)
 */
export async function markeraBorttagna(dagarSedanSedd = 2) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - dagarSedanSedd);

  const { data, error } = await supabase
    .from("blocket_annonser")
    .update({ borttagen: new Date().toISOString() })
    .is("borttagen", null)
    .lt("senast_sedd", cutoff.toISOString())
    .select("id");

  if (error) {
    console.error("❌ Kunde inte markera borttagna:", error.message);
    return 0;
  }

  return data?.length || 0;
}

/**
 * Spara daglig marknadsstatistik
 */
export async function sparaMarknadsdata(datum, region, marke, stats) {
  const { error } = await supabase.from("blocket_marknadsdata").upsert(
    {
      datum,
      region,
      marke,
      ...stats,
    },
    {
      onConflict: "datum,region,marke",
    }
  );

  if (error) {
    console.error("❌ Kunde inte spara marknadsdata:", error.message);
  }
}

/**
 * Beräkna och spara marknadsstatistik för dagen
 */
export async function beraknaMarknadsstatistik() {
  const idag = new Date().toISOString().split("T")[0];

  // Hämta alla aktiva annonser grupperade per region och märke
  const { data, error } = await supabase
    .from("blocket_annonser")
    .select("region, marke, pris, saljare_typ")
    .is("borttagen", null);

  if (error || !data) {
    console.error("❌ Kunde inte hämta data för statistik:", error?.message);
    return;
  }

  // Gruppera per region + märke
  const grupper = {};

  for (const annons of data) {
    const key = `${annons.region || "okand"}|${annons.marke || "okant"}`;

    if (!grupper[key]) {
      grupper[key] = {
        region: annons.region || "okand",
        marke: annons.marke || "okant",
        priser: [],
        privat: 0,
        handlare: 0,
      };
    }

    if (annons.pris) {
      grupper[key].priser.push(annons.pris);
    }

    if (annons.saljare_typ === "handlare") {
      grupper[key].handlare++;
    } else {
      grupper[key].privat++;
    }
  }

  // Spara statistik för varje grupp
  for (const [_, grupp] of Object.entries(grupper)) {
    const priser = grupp.priser.sort((a, b) => a - b);

    const stats = {
      antal_annonser: grupp.privat + grupp.handlare,
      medelpris: priser.length
        ? Math.round(priser.reduce((a, b) => a + b, 0) / priser.length)
        : null,
      medianpris: priser.length
        ? priser[Math.floor(priser.length / 2)]
        : null,
      min_pris: priser.length ? priser[0] : null,
      max_pris: priser.length ? priser[priser.length - 1] : null,
      antal_privat: grupp.privat,
      antal_handlare: grupp.handlare,
    };

    await sparaMarknadsdata(idag, grupp.region, grupp.marke, stats);
  }

  console.log(`📊 Sparade marknadsstatistik för ${Object.keys(grupper).length} grupper`);
}
