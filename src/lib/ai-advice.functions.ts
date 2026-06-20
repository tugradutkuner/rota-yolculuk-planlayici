import { createServerFn } from "@tanstack/react-start";

export const generateTravelAdvice = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    const data = input as { stops?: unknown };
    if (!data || !Array.isArray(data.stops)) throw new Error("invalid_input");
    const stops = (data.stops as unknown[])
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s) => s.length > 0);
    if (stops.length < 2) throw new Error("not_enough_stops");
    return { stops };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("missing_api_key");
    }
    const prompt = `Aşağıdaki rotada seyahat edeceğim. Bana bu şehirlerde mutlaka yapılması gerekenler, gizli kalmış lezzet durakları ve yolculuk için pratik tavsiyeler içeren kısa, Türkçe bir rehber hazırla: ${data.stops.join(" → ")}`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Sen deneyimli bir Türk seyahat rehberisin. Yanıtların her zaman Türkçe, net ve markdown formatında olsun.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.8,
      }),
    });

    if (res.status === 429) {
      throw new Error("rate_limited");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("unauthorized");
    }
    if (!res.ok) {
      throw new Error("upstream_error");
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("empty_response");
    return { text };
  });
