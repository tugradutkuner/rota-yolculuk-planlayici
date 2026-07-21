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

// Parses the page's visible body text, e.g.:
//   "Euro 95 petrol: €2.101 per liter (€7.95 per US gallon). Diesel: €2.015
//    per liter (€7.63 per US gallon). Updated: 13 Jul 2026."
//   "LATEST ECB RATE €1 = $1.1426 LIVE"
// This targets literal rendered copy (verified by hand for several
// countries) rather than guessing the exact <meta> attribute structure,
// which turned out not to match on the first deploy.
function parsePricesFromHtml(html: string): { e95: number; diesel: number; usdRate: number; date: string | null } | null {
  const priceLine = html.match(
    /Euro 95 petrol:\s*€\s*([\d.,]+)\s*per liter[^.]*\.\s*Diesel:\s*€\s*([\d.,]+)\s*per liter[^.]*\.\s*Updated:\s*([^.<\n]+)/i,
  );
  const rateLine = html.match(/€\s*1\s*=\s*\$\s*([\d.,]+)/i);
  if (!priceLine || !rateLine) return null;
  return {
    e95: parseFloat(priceLine[1].replace(",", ".")),
    diesel: parseFloat(priceLine[2].replace(",", ".")),
    usdRate: parseFloat(rateLine[1].replace(",", ".")),
    date: priceLine[3] ? priceLine[3].trim() : null,
  };
}

Deno.serve(async () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const results: { country: string; ok: boolean; error?: string }[] = [];

  for (const [slug, [code, trName]] of Object.entries(EU_COUNTRIES)) {
    try {
      const res = await fetch(`https://www.fuel-prices.eu/${slug}/`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();

      const parsed = parsePricesFromHtml(html);
      if (!parsed) {
        throw new Error(
          `Fiyat metni bulunamadı. Sayfa uzunluğu: ${html.length}, ilk 300 karakter: ${html.slice(0, 300).replace(/\s+/g, " ")}`,
        );
      }

      const gasolineUsd = parsed.e95 * parsed.usdRate;
      const dieselUsd = parsed.diesel * parsed.usdRate;

      const { error } = await supabase.from("fuel_prices").upsert({
        country_code: code,
        country_name: trName,
        gasoline_usd_per_liter: Math.round(gasolineUsd * 1000) / 1000,
        diesel_usd_per_liter: Math.round(dieselUsd * 1000) / 1000,
        source: "AB Komisyonu Haftalık Petrol Bülteni (otomatik, fuel-prices.eu)",
        updated_at: parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString(),
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
