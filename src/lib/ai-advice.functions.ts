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
      const body = await res.text().catch(() => "");
      console.error("OpenAI auth error", res.status, body);
      throw new Error("unauthorized");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("OpenAI upstream error", res.status, body);
      throw new Error("upstream_error");
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("empty_response");
    return { text };
  });

// Conversational follow-up: lets the user ask things like "İzmir'i çıkarsam
// ne olur?" or "çocuklu aile için uygun mu?" about the same route, with the
// initial advice + prior turns as context. Kept separate from
// generateTravelAdvice so the original one-shot advice flow is untouched.
export const chatWithAdvisor = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    const data = input as {
      stops?: unknown;
      initialAdvice?: unknown;
      history?: unknown;
      message?: unknown;
    };
    if (!data || !Array.isArray(data.stops)) throw new Error("invalid_input");
    const stops = (data.stops as unknown[])
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s) => s.length > 0);
    if (stops.length < 2) throw new Error("not_enough_stops");

    const message = typeof data.message === "string" ? data.message.trim() : "";
    if (!message) throw new Error("empty_message");

    const initialAdvice = typeof data.initialAdvice === "string" ? data.initialAdvice : "";

    const rawHistory = Array.isArray(data.history) ? data.history : [];
    const history = rawHistory
      .filter(
        (m): m is { role: "user" | "assistant"; content: string } =>
          !!m &&
          typeof m === "object" &&
          (m as { role?: unknown }).role !== undefined &&
          ((m as { role?: unknown }).role === "user" || (m as { role?: unknown }).role === "assistant") &&
          typeof (m as { content?: unknown }).content === "string",
      )
      .slice(-12); // keep the last 12 turns so the request stays small

    return { stops, initialAdvice, history, message };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("missing_api_key");
    }

    const systemContent = `Sen deneyimli bir Türk seyahat rehberisin ve bir kullanıcıyla birlikte şu rotayı planlıyorsun: ${data.stops.join(" → ")}.${
      data.initialAdvice
        ? ` Daha önce şu genel tavsiyeyi vermiştin: """${data.initialAdvice}""". Bu tavsiyeyle tutarlı, onu tamamlayan cevaplar ver.`
        : ""
    } Kullanıcı rotada değişiklik önerebilir (bir durağı çıkarmak/eklemek), belirli bir grup için (çocuklu aile, bütçe, evcil hayvan vb.) uygunluk sorabilir ya da pratik bir soru sorabilir. Kısa, net, Türkçe ve markdown formatında, sohbet havasında cevap ver — genel bir rehber değil, doğrudan sorulan soruya odaklı bir cevap ver.`;

    const messages = [
      { role: "system", content: systemContent },
      ...data.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: data.message },
    ];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.7,
      }),
    });

    if (res.status === 429) {
      throw new Error("rate_limited");
    }
    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      console.error("OpenAI auth error", res.status, body);
      throw new Error("unauthorized");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("OpenAI upstream error", res.status, body);
      throw new Error("upstream_error");
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("empty_response");
    return { text };
  });

// Route enrichment: given the ordered list of stop addresses, ask the model
// for real, well-known, named points of interest that sit near the route
// between consecutive stops — scenic viewpoints, local specialties, and
// lesser-known spots (the "keşif" axis). Returns structured JSON (name +
// city so the client can geocode each one for a real lat/lng via the Places
// / Geocoding API — the model is not trusted to produce coordinates
// itself, only names, which are much less likely to be hallucinated for
// well-known places).
export const enrichRoute = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    const data = input as {
      stops?: unknown;
      communityPlaces?: unknown;
      communityComments?: unknown;
      acceptedPlaces?: unknown;
      avoidPlaces?: unknown;
    };
    if (!data || !Array.isArray(data.stops)) throw new Error("invalid_input");
    const stops = (data.stops as unknown[])
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s) => s.length > 0);
    if (stops.length < 2) throw new Error("not_enough_stops");

    const communityPlaces = Array.isArray(data.communityPlaces)
      ? (data.communityPlaces as unknown[])
          .map((p) => {
            const o = p as Record<string, unknown>;
            return {
              name: typeof o.name === "string" ? o.name.trim().slice(0, 120) : "",
              rating: typeof o.rating === "number" ? o.rating : null,
              ratingCount: typeof o.ratingCount === "number" ? o.ratingCount : 0,
            };
          })
          .filter((p) => p.name.length > 0)
          .slice(0, 20)
      : [];

    const communityComments = Array.isArray(data.communityComments)
      ? (data.communityComments as unknown[])
          .map((c) => (typeof c === "string" ? c.trim().slice(0, 200) : ""))
          .filter((c) => c.length > 0)
          .slice(0, 15)
      : [];

    const strList = (v: unknown, max: number) =>
      Array.isArray(v)
        ? (v as unknown[])
            .map((x) => (typeof x === "string" ? x.trim().slice(0, 120) : ""))
            .filter((x) => x.length > 0)
            .slice(0, max)
        : [];
    const acceptedPlaces = strList(data.acceptedPlaces, 8);
    const avoidPlaces = strList(data.avoidPlaces, 8);

    return { stops, communityPlaces, communityComments, acceptedPlaces, avoidPlaces };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("missing_api_key");
    }

    const legs = data.stops.slice(0, -1).map((s, i) => `${s} → ${data.stops[i + 1]}`);

    const communityBlock = data.communityPlaces.length
      ? `\n\nVialume TOPLULUK VERİSİ (gerçek kullanıcı puanları — uydurma değil, veritabanından geliyor):\n${data.communityPlaces
          .map((p) => `- "${p.name}" — ${p.ratingCount} kullanıcıdan ortalama ${p.rating?.toFixed(1) ?? "?"}/5 puan`)
          .join("\n")}${
          data.communityComments.length
            ? `\n\nGerçek kullanıcı yorumlarından örnekler:\n${data.communityComments.map((c) => `- "${c}"`).join("\n")}`
            : ""
        }\n\nBu topluluk verisindeki yerlerden rotaya coğrafi olarak uygun olanları MUTLAKA önerilerin arasına dahil et ve bunlar için "topluluk_onayli": true koy; "reason" alanında gerçek puana atıfta bulun (örn: "Vialume topluluğunda 12 kullanıcıdan 4.6/5 puan aldı"). Topluluk verisi rotaya uygun değilse ya da tüm önerileri dolduramıyorsan, kalanları kendi bilgine dayanarak ekle ve bunlara "topluluk_onayli": false koy.`
      : `\n\nHenüz bu rota için topluluk verisi yok, tüm önerilere "topluluk_onayli": false koy.`;

    const feedbackBlock =
      data.acceptedPlaces.length || data.avoidPlaces.length
        ? `\n\nDAVRANIŞSAL GERİ BİLDİRİM (Vialume kullanıcılarının geçmişte önerilere gerçekte ne yaptığı):${
            data.acceptedPlaces.length
              ? `\n- Kullanıcılar önerildiğinde gerçekten rotalarına eklediği yerler (rotaya uygunsa öncelik ver): ${data.acceptedPlaces.join(", ")}`
              : ""
          }${
            data.avoidPlaces.length
              ? `\n- Kullanıcılar önerildiğinde sürekli reddettiği/geçtiği yerler (bunları ÖNERME, rotaya coğrafi olarak uygun olsa bile): ${data.avoidPlaces.join(", ")}`
              : ""
          }`
        : "";

    const prompt = `Şu rotayı planlıyorum: ${data.stops.join(" → ")}.
Rotadaki her bacak için (${legs.join(" | ")}) ana yoldan çok fazla sapmayan, GERÇEK ve tanınmış (uydurma olmayan) 1-2 keşif noktası öner: manzara noktaları, yerel lezzet durakları, ya da az bilinen/gizli kalmış yerler. Sadece Türkiye'de değil, rotanın geçtiği her ülkede gerçekten var olan, doğrulanabilir yerler seç.${communityBlock}${feedbackBlock}

SADECE şu JSON formatında, başka hiçbir metin olmadan cevap ver:
{"suggestions": [{"name": "Yer adı", "city": "En yakın şehir/kasaba, ülke", "category": "manzara" | "yerel_lezzet" | "gizli_yer", "reason": "Neden mutlaka uğranmalı, tek cümle, Türkçe", "topluluk_onayli": true | false}]}

Toplam en fazla 6 öneri ver. Yerler kesinlikle gerçek olmalı, uydurma isim kullanma.`;

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
              "Sen gerçek, doğrulanabilir coğrafi yer bilgisi veren bir seyahat uzmanısın. Sadece gerçekten var olan yerleri önerirsin, asla uydurmazsın. Sana verilen topluluk verisini (gerçek kullanıcı puanları/yorumları) önerilerinde önceliklendirmekle yükümlüsün, bunu görmezden gelemezsin. Sadece istenen JSON formatında cevap verirsin, başka hiçbir açıklama eklemezsin.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });

    if (res.status === 429) {
      throw new Error("rate_limited");
    }
    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      console.error("OpenAI auth error", res.status, body);
      throw new Error("unauthorized");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("OpenAI upstream error", res.status, body);
      throw new Error("upstream_error");
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!raw) throw new Error("empty_response");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("bad_json");
    }
    const list = (parsed as { suggestions?: unknown })?.suggestions;
    if (!Array.isArray(list)) throw new Error("bad_json");

    const suggestions = list
      .map((s) => {
        const o = s as Record<string, unknown>;
        const name = typeof o.name === "string" ? o.name.trim() : "";
        const city = typeof o.city === "string" ? o.city.trim() : "";
        const reason = typeof o.reason === "string" ? o.reason.trim() : "";
        const category =
          o.category === "manzara" || o.category === "yerel_lezzet" || o.category === "gizli_yer"
            ? o.category
            : "gizli_yer";
        const topluluk_onayli = o.topluluk_onayli === true;
        return { name, city, reason, category, topluluk_onayli };
      })
      .filter((s) => s.name.length > 0 && s.city.length > 0)
      .slice(0, 6);

    if (!suggestions.length) throw new Error("empty_response");
    return { suggestions };
  });
