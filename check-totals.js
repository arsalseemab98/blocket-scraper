const LAN_KODER = {
  norrbotten: '0.300025',
  vasterbotten: '0.300024',
  jamtland: '0.300023',
  vasternorrland: '0.300022',
};

async function checkTotal(region, kod) {
  const url = 'https://www.blocket.se/mobility/search/car?location=' + kod;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
  });
  const html = await res.text();

  // Extract base64 JSON
  const pattern = /<script[^>]*type="application\/json"[^>]*>([^<]+)<\/script>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
      const data = JSON.parse(decoded);
      if (data.queries) {
        for (const query of data.queries) {
          const state = query?.state?.data;
          if (state?.docs) {
            console.log(`\n=== ${region.toUpperCase()} ===`);
            console.log('docs length (per page):', state.docs.length);
            console.log('metadata:', JSON.stringify(state.metadata, null, 2));
            return;
          }
        }
      }
    } catch (e) {
      continue;
    }
  }
  console.log(`${region}: kunde inte hitta data`);
}

(async () => {
  for (const [region, kod] of Object.entries(LAN_KODER)) {
    await checkTotal(region, kod);
  }
})();
