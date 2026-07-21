// Supabase Edge Function: fetch-fuel-prices
//
// Fetches the public, CC BY 4.0 licensed country pages from fuel-prices.eu
// (sourced from the European Commission's Weekly Oil Bulletin) for all 27
// EU member states, parses the structured <head> meta tags each page
// already exposes for machine consumption, converts EUR -> USD using the
// page's own quoted ECB rate, and upserts the result into public.fuel_prices.
//
// NOT automated here (documented limitation, left as manual/periodic seed):
// Turkey, Switzerland, UK, USA, and other non-EU countries — no equally
// clean free official machine-readable weekly source was confirmed for
// them. Attribution: "AB Komisyonu Haftalık Petrol Bülteni (fuel-prices.eu
// üzerinden, CC BY 4.0)".
//
// Deploy: paste this file's content into Supabase Dashboard > Edge
// Functions > Create a new function named "fetch-fuel-prices", or via
// `supabase functions deploy fetch-fuel-prices` if using the CLI.

import { createClient } from "jsr:@supabase/supabase-js@2";

// English URL slug -> [ISO 3166-1 alpha-2, Turkish display name]
const EU_COUNTRIES: Record<string, [string, string]> = {
  Austria: ["AT", "Avusturya"],
  Belgium: ["BE", "Belçika"],
  Bulgaria: ["BG", "Bulgaristan"],
  Croatia: ["HR", "Hırvatistan"],
  Cyprus: ["CY", "Kıbrıs"],
  Czechia: ["CZ", "Çekya"],
  Denmark: ["DK", "Danimarka"],
  Estonia: ["EE", "Estonya"],
  Finland: ["FI", "Finlandiya"],
  France: ["FR", "Fransa"],
  Germany: ["DE", "Almanya"],
  Greece: ["GR", "Yunanistan"],
  Hungary: ["HU", "Macaristan"],
  Ireland: ["IE", "İrlanda"],
  Italy: ["IT", "İtalya"],
  Latvia: ["LV", "Letonya"],
  Lithuania: ["LT", "Litvanya"],
  Luxembourg: ["LU", "Lüksemburg"],
  Malta: ["MT", "Malta"],
  Netherlands: ["NL", "Hollanda"],
  Poland: ["PL", "Polonya"],
  Portugal: ["PT", "Portekiz"],
  Romania: ["RO", "Romanya"],
  Slovakia: ["SK", "Slovakya"],
  Slovenia: ["SI", "Slovenya"],
  Spain: ["ES", "İspanya"],
  Sweden: ["SE", "İsveç"],
};

function extractMeta(html: string, key: string): string | null {
  const re = new RegExp(`meta-data-${key}:\\s*([^\\n]+)`, "i");
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const results: { country: string; ok: boolean; error?: string }[] = [];

  for (const [slug, [code, trName]] of Object.entries(EU_COUNTRIES)) {
    try {
      const res = await fetch(`https://www.fuel-prices.eu/${slug}/`, {
        headers: { "User-Agent": "RotaPlanlayici-FuelPriceBot/1.0 (+https://rota-yolculuk-planlayici.lovable.app)" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      const e95 = extractMeta(html, "e95-price");
      const diesel = extractMeta(html, "diesel-price");
      const usdRate = extractMeta(html, "usd-rate");
      const latestDate = extractMeta(html, "latest-date");

      if (!e95 || !diesel || !usdRate) throw new Error("Beklenen meta etiketleri bulunamadı");

      const rate = parseFloat(usdRate);
      const gasolineUsd = parseFloat(e95) * rate;
      const dieselUsd = parseFloat(diesel) * rate;

      const { error } = await supabase.from("fuel_prices").upsert({
        country_code: code,
        country_name: trName,
        gasoline_usd_per_liter: Math.round(gasolineUsd * 1000) / 1000,
        diesel_usd_per_liter: Math.round(dieselUsd * 1000) / 1000,
        source: "AB Komisyonu Haftalık Petrol Bülteni (otomatik, fuel-prices.eu)",
        updated_at: latestDate ? new Date(latestDate).toISOString() : new Date().toISOString(),
      });
      if (error) throw error;

      results.push({ country: code, ok: true });
    } catch (e) {
      results.push({ country: code, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    // Be a polite, rate-limited client — small delay between requests.
    await new Promise((r) => setTimeout(r, 300));
  }

  const okCount = results.filter((r) => r.ok).length;
  return new Response(
    JSON.stringify({ updated: okCount, total: results.length, results }),
    { headers: { "Content-Type": "application/json" } },
  );
});
