/**
 * Deal Hunter — snabb bevakning av nya privatannonser i Norrland
 *
 * Pollar var 30:e sekund, en parallell fetch per län.
 * Filter: privat säljare, 2000-2018, ≤ 23 000 mil, ≤ 150 000 kr.
 * Skickar Gmail-email per ny annons. Dedup via Supabase.
 */

import nodemailer from "nodemailer";
import { supabase } from "./database.js";
import { LAN_KODER } from "./blocket.js";

const POLL_INTERVAL_MS = 30_000;

const NORRLAND_LAN = [
  { key: "norrbotten",      label: "Norrbotten",      kod: LAN_KODER.norrbotten      },
  { key: "vasterbotten",    label: "Västerbotten",    kod: LAN_KODER.vasterbotten    },
  { key: "jamtland",        label: "Jämtland",        kod: LAN_KODER.jamtland        },
  { key: "vasternorrland",  label: "Västernorrland",  kod: LAN_KODER.vasternorrland  },
];

const FILTERS = {
  dealer_segment: 3,     // privat
  price_to:       150000,
  year_from:      2000,
  year_to:        2018,
  mileage_to:     23000, // mil
};

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
  "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
};

const SENDER_EMAIL          = process.env.SENDER_EMAIL;
const SENDER_EMAIL_PASSWORD = process.env.SENDER_EMAIL_PASSWORD;
const RECEIVER_EMAIL        = process.env.RECEIVER_EMAIL;

const transporter = SENDER_EMAIL && SENDER_EMAIL_PASSWORD
  ? nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: SENDER_EMAIL, pass: SENDER_EMAIL_PASSWORD },
    })
  : null;

function extractDocs(html) {
  const tags = html.match(/<script[^>]*type="application\/json"[^>]*>([^<]+)<\/script>/g) || [];
  for (const tag of tags) {
    const m = tag.match(/>([^<]+)</);
    if (!m) continue;
    try {
      const data = JSON.parse(Buffer.from(m[1], "base64").toString("utf-8"));
      for (const q of data.queries || []) {
        const docs = q?.state?.data?.docs;
        if (docs?.length) return docs;
      }
    } catch {}
  }
  return [];
}

async function fetchLan(lan) {
  const params = new URLSearchParams({
    location: lan.kod,
    sort:     "date",
    ...Object.fromEntries(Object.entries(FILTERS).map(([k, v]) => [k, String(v)])),
  });
  const url = `https://www.blocket.se/mobility/search/car?${params.toString()}`;

  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      console.error(`[deal-hunter] ${lan.key} HTTP ${res.status}`);
      return [];
    }
    const docs = extractDocs(await res.text());
    return docs.map((d) => ({
      blocket_id: String(d.id),
      marke:      d.make || null,
      modell:     d.model || null,
      arsmodell:  d.year || null,
      pris:       d.price?.amount ?? null,
      miltal:     d.mileage ?? null,
      bransle:    d.fuel || null,
      vaxellada:  d.transmission || null,
      stad:       d.location || null,
      lan:        lan.label,
      url:        d.canonical_url || `https://www.blocket.se/mobility/item/${d.id}`,
    }));
  } catch (e) {
    console.error(`[deal-hunter] ${lan.key} fetch error: ${e.message}`);
    return [];
  }
}

function formatPrice(n) {
  return n != null ? n.toLocaleString("sv-SE") : "?";
}

async function sendEmail(ad) {
  if (!transporter) {
    console.error("[deal-hunter] SMTP-credentials saknas, hoppar email");
    return false;
  }

  const subject = `Ny Bil: ${ad.marke ?? ""} ${ad.modell ?? ""} ${ad.arsmodell ?? ""} - ${formatPrice(ad.miltal)} mil - ${formatPrice(ad.pris)} kr - ${ad.lan}`.replace(/\s+/g, " ");

  const body = [
    "*** NY ANNONS ***",
    "",
    `Märke:     ${ad.marke ?? "-"}`,
    `Modell:    ${ad.modell ?? "-"}`,
    `Årsmodell: ${ad.arsmodell ?? "-"}`,
    `Pris:      ${formatPrice(ad.pris)} kr`,
    `Miltal:    ${formatPrice(ad.miltal)} mil`,
    `Län:       ${ad.lan}`,
    `Stad:      ${ad.stad ?? "-"}`,
    `Bränsle:   ${ad.bransle ?? "-"}`,
    `Växel:     ${ad.vaxellada ?? "-"}`,
    `Säljare:   Privat`,
    "",
    `Länk: ${ad.url}`,
    "",
  ].join("\n");

  try {
    await transporter.sendMail({
      from: SENDER_EMAIL,
      to:   RECEIVER_EMAIL,
      subject,
      text: body,
    });
    return true;
  } catch (e) {
    console.error(`[deal-hunter] email-fel (${ad.blocket_id}): ${e.message}`);
    return false;
  }
}

async function getSeenIds(ids) {
  if (ids.length === 0) return new Set();
  const seen = new Set();
  // Batcha i grupper om 100 för att undvika URL-längd
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { data, error } = await supabase
      .from("blocket_deal_hunter_seen")
      .select("blocket_id")
      .in("blocket_id", batch);
    if (error) {
      console.error(`[deal-hunter] dedup-fel: ${error.message}`);
      return new Set(ids); // failsafe: behandla allt som sett
    }
    for (const row of data || []) seen.add(row.blocket_id);
  }
  return seen;
}

async function insertSeen(rows) {
  if (rows.length === 0) return;
  const { error } = await supabase.from("blocket_deal_hunter_seen").upsert(rows, {
    onConflict: "blocket_id",
  });
  if (error) console.error(`[deal-hunter] insert-fel: ${error.message}`);
}

let isFirstRun = true;
let isRunning  = false;

export async function runDealHunter() {
  if (isRunning) {
    return; // hoppa över om förra cykeln tar längre än intervallet
  }
  isRunning = true;
  const start = Date.now();

  try {
    // Parallel fetch of all 4 län
    const results = await Promise.all(NORRLAND_LAN.map(fetchLan));
    const allAds = results.flat();

    if (allAds.length === 0) {
      console.log(`[deal-hunter] 0 ads (${((Date.now() - start) / 1000).toFixed(1)}s)`);
      return;
    }

    const seenIds = await getSeenIds(allAds.map((a) => a.blocket_id));
    const newAds  = allAds.filter((a) => !seenIds.has(a.blocket_id));

    if (newAds.length === 0) {
      console.log(`[deal-hunter] ${allAds.length} fetched, 0 nya (${((Date.now() - start) / 1000).toFixed(1)}s)`);
      return;
    }

    if (isFirstRun) {
      // SEED: bara markera som sedda, inga email
      console.log(`[deal-hunter] SEED – markerar ${newAds.length} befintliga som sedda`);
      await insertSeen(newAds.map((a) => ({
        blocket_id: a.blocket_id,
        marke: a.marke, modell: a.modell, arsmodell: a.arsmodell,
        pris: a.pris, miltal: a.miltal, stad: a.stad, lan: a.lan, url: a.url,
      })));
      isFirstRun = false;
      return;
    }

    // Skicka email + spara
    let sent = 0;
    for (const ad of newAds) {
      const ok = await sendEmail(ad);
      await insertSeen([{
        blocket_id:  ad.blocket_id,
        marke:       ad.marke,
        modell:      ad.modell,
        arsmodell:   ad.arsmodell,
        pris:        ad.pris,
        miltal:      ad.miltal,
        stad:        ad.stad,
        lan:         ad.lan,
        url:         ad.url,
        emailed_at:  ok ? new Date().toISOString() : null,
      }]);
      if (ok) sent++;
      console.log(`[deal-hunter] 📧 ${ad.marke} ${ad.modell} ${ad.arsmodell} | ${ad.miltal} mil | ${ad.pris} kr | ${ad.lan} – ${ok ? "sent" : "FAILED"}`);
    }
    console.log(`[deal-hunter] ${allAds.length} fetched, ${newAds.length} nya, ${sent} email skickade (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  } catch (e) {
    console.error(`[deal-hunter] cykel-fel: ${e.message}`);
  } finally {
    isRunning = false;
  }
}

export function startDealHunter() {
  if (!SENDER_EMAIL || !SENDER_EMAIL_PASSWORD || !RECEIVER_EMAIL) {
    console.error("[deal-hunter] saknar SENDER_EMAIL / SENDER_EMAIL_PASSWORD / RECEIVER_EMAIL — startar EJ");
    return;
  }
  console.log(`[deal-hunter] startar (${POLL_INTERVAL_MS / 1000}s intervall, ${NORRLAND_LAN.length} län)`);
  // Kör en gång direkt, sedan på intervall
  runDealHunter();
  setInterval(runDealHunter, POLL_INTERVAL_MS);
}
