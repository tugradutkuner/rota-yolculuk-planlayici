import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { generateTravelAdvice } from "@/lib/ai-advice.functions";
import {
  MapPin,
  Plus,
  Trash2,
  Calendar,
  Route as RouteIcon,
  Clock,
  Navigation,
  Loader2,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  FileText,
  Timer,
  Sparkles,
  ChevronDown,
} from "lucide-react";

// ============================================================================
// GOOGLE MAPS API KEY — Buraya kendi Google Maps API anahtarınızı yapıştırın
// ============================================================================
const GOOGLE_MAPS_API_KEY = "AIzaSyC1Wp8TBZcVcwKikraqgslNwGcTogjgPYk";
const GOOGLE_MAPS_LIBRARIES = "places,geometry";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Rota Planlayıcı" },
      { name: "description", content: "Google Haritalar ile çok duraklı rota planlama uygulaması." },
    ],
  }),
  component: RoutePlanner,
});

type Stop = {
  id: string;
  address: string;
  datetime: string; // departure time (manual input)
  note?: string;
  noteOpen?: boolean;
  placeId?: string;
  location?: { lat: number; lng: number };
};

type Metrics = { distanceKm: number; durationMin: number } | null;

const uid = () => Math.random().toString(36).slice(2, 9);

declare global {
  interface Window {
    google?: any;
    initGMaps?: () => void;
  }
}

let mapsLoaderPromise: Promise<void> | null = null;
function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.google?.maps) return Promise.resolve();
  if (mapsLoaderPromise) return mapsLoaderPromise;
  mapsLoaderPromise = new Promise((resolve, reject) => {
    if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY.includes("YOUR_API_KEY")) {
      reject(new Error("API_KEY_MISSING"));
      return;
    }
    window.initGMaps = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=${GOOGLE_MAPS_LIBRARIES}&language=tr&region=TR&callback=initGMaps&loading=async`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("LOAD_ERROR"));
    document.head.appendChild(s);
  });
  return mapsLoaderPromise;
}

const fmtTime = (d: Date) =>
  d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
const fmtDateTime = (d: Date) =>
  d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function RoutePlanner() {
  const [stops, setStops] = useState<Stop[]>([
    { id: uid(), address: "", datetime: "" },
    { id: uid(), address: "", datetime: "" },
  ]);
  const [metrics, setMetrics] = useState<Metrics>(null);
  const [legDurations, setLegDurations] = useState<number[]>([]); // seconds per leg
  const [calculating, setCalculating] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLocked, setAiLocked] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const callAdvice = useServerFn(generateTravelAdvice);

  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const altPolylinesRef = useRef<any[]>([]);
  const lastResultRef = useRef<any>(null);
  const aiLockRef = useRef(false);
  const aiLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapDivRef.current) return;
        const g = window.google;
        mapRef.current = new g.maps.Map(mapDivRef.current, {
          center: { lat: 39.9334, lng: 32.8597 },
          zoom: 6,
          disableDefaultUI: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          styles: [
            { featureType: "poi", stylers: [{ visibility: "simplified" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
        rendererRef.current = new g.maps.DirectionsRenderer({
          map: mapRef.current,
          suppressMarkers: false,
          polylineOptions: {
            strokeColor: "#2563eb",
            strokeWeight: 6,
            strokeOpacity: 0.9,
          },
        });
        setMapReady(true);
      })
      .catch((e) => {
        setMapError(
          e.message === "API_KEY_MISSING"
            ? "Google Maps API anahtarı tanımlanmamış. Lütfen src/routes/index.tsx içindeki GOOGLE_MAPS_API_KEY sabitini güncelleyin."
            : "Google Haritalar yüklenemedi. API anahtarınızı kontrol edin.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !window.google) return;
    const t = setTimeout(() => {
      window.google.maps.event.trigger(mapRef.current, "resize");
    }, 320);
    return () => clearTimeout(t);
  }, [sidebarOpen]);

  useEffect(() => {
    return () => {
      if (aiLockTimerRef.current) clearTimeout(aiLockTimerRef.current);
    };
  }, []);

  const addStop = () => setStops((s) => [...s, { id: uid(), address: "", datetime: "" }]);
  const removeStop = (id: string) =>
    setStops((s) => (s.length <= 2 ? s : s.filter((x) => x.id !== id)));
  const updateStop = (id: string, patch: Partial<Stop>) =>
    setStops((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const onDragStart = (id: string) => setDragId(id);
  const onDragOver = (id: string, e: React.DragEvent) => {
    e.preventDefault();
    if (dragOverId !== id) setDragOverId(id);
  };
  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    setStops((arr) => {
      const from = arr.findIndex((x) => x.id === dragId);
      const to = arr.findIndex((x) => x.id === targetId);
      if (from < 0 || to < 0) return arr;
      const next = arr.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragId(null);
    setDragOverId(null);
  };
  const onDragEnd = () => {
    setDragId(null);
    setDragOverId(null);
  };

  // Compute ETA chain from departure times + leg durations
  const etas = useMemo(() => {
    const arr: (Date | null)[] = new Array(stops.length).fill(null);
    if (!legDurations.length) return arr;
    let cursor: Date | null = stops[0]?.datetime ? new Date(stops[0].datetime) : null;
    for (let i = 0; i < stops.length - 1; i++) {
      if (!cursor) break;
      const dur = legDurations[i];
      if (dur == null) break;
      const arrival = new Date(cursor.getTime() + dur * 1000);
      arr[i + 1] = arrival;
      // Next leg departs at user-input datetime if set (>= arrival), else arrival itself
      const nextDep = stops[i + 1]?.datetime ? new Date(stops[i + 1].datetime) : null;
      cursor = nextDep && nextDep > arrival ? nextDep : arrival;
    }
    return arr;
  }, [stops, legDurations]);

  const calculate = () => {
    setStatusMsg(null);
    if (!mapReady || !window.google) return;
    const filled = stops.filter((s) => s.address.trim().length > 0);
    if (filled.length < 2) {
      setStatusMsg("Lütfen en az iki durak girin.");
      return;
    }
    setCalculating(true);
    const g = window.google;
    const service = new g.maps.DirectionsService();
    const origin = filled[0].location ?? filled[0].address;
    const destination = filled[filled.length - 1].location ?? filled[filled.length - 1].address;
    const waypoints = filled.slice(1, -1).map((s) => ({
      location: s.location ?? s.address,
      stopover: true,
    }));

    // Dynamic traffic via drivingOptions (requires future departureTime)
    const depRaw = stops[0]?.datetime ? new Date(stops[0].datetime) : null;
    const now = new Date();
    const departureTime = depRaw && depRaw > now ? depRaw : new Date(now.getTime() + 60_000);

    service.route(
      {
        origin,
        destination,
        waypoints,
        travelMode: g.maps.TravelMode.DRIVING,
        provideRouteAlternatives: true,
        drivingOptions: {
          departureTime,
          trafficModel: g.maps.TrafficModel.BEST_GUESS,
        },
      },
      (result: any, status: string) => {
        setCalculating(false);
        if (status !== "OK" || !result) {
          setStatusMsg("Rota hesaplanamadı: " + status);
          return;
        }
        lastResultRef.current = result;
        applyRoute(0);
      },
    );
  };

  const applyRoute = (idx: number) => {
    const result = lastResultRef.current;
    const g = window.google;
    if (!result || !g || !mapRef.current) return;

    altPolylinesRef.current.forEach((p) => p.setMap(null));
    altPolylinesRef.current = [];

    rendererRef.current?.setDirections(result);
    rendererRef.current?.setRouteIndex(idx);

    result.routes.forEach((route: any, i: number) => {
      if (i === idx) return;
      const poly = new g.maps.Polyline({
        path: route.overview_path,
        map: mapRef.current,
        strokeColor: "#64748b",
        strokeOpacity: 0.55,
        strokeWeight: 5,
        zIndex: 1,
        clickable: true,
      });
      poly.addListener("mouseover", () => poly.setOptions({ strokeOpacity: 0.85, strokeWeight: 6 }));
      poly.addListener("mouseout", () => poly.setOptions({ strokeOpacity: 0.55, strokeWeight: 5 }));
      poly.addListener("click", () => applyRoute(i));
      altPolylinesRef.current.push(poly);
    });

    let dist = 0;
    let dur = 0;
    const legs: number[] = [];
    for (const leg of result.routes[idx].legs) {
      dist += leg.distance?.value ?? 0;
      const d = leg.duration_in_traffic?.value ?? leg.duration?.value ?? 0;
      dur += d;
      legs.push(d);
    }
    setLegDurations(legs);
    setMetrics({ distanceKm: dist / 1000, durationMin: Math.round(dur / 60) });
    setStatusMsg(
      result.routes.length > 1
        ? `${result.routes.length} rota bulundu. Alternatifi seçmek için haritadaki gri çizgiye tıklayın. (Seçili: ${idx + 1})`
        : null,
    );
  };

  const formatDuration = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
  };

  const generateAdvice = async () => {
    const list = stops.map((s) => s.address.trim()).filter(Boolean);
    if (list.length < 2) {
      setAiError("Lütfen en az iki durak girin.");
      setAiText(null);
      return;
    }
    if (aiLoading || aiLockRef.current) return;
    aiLockRef.current = true;
    setAiLocked(true);
    if (aiLockTimerRef.current) clearTimeout(aiLockTimerRef.current);
    aiLockTimerRef.current = setTimeout(() => {
      aiLockRef.current = false;
      setAiLocked(false);
    }, 5000);
    setAiLoading(true);
    setAiError(null);
    setAiText(null);
    try {
      const result = await callAdvice({ data: { stops: list } });
      setAiText(result.text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("rate_limited")) {
        setAiError("OpenAI API kota sınırına ulaşıldı. Lütfen 30 saniye bekleyip tekrar deneyin.");
      } else if (msg.includes("unauthorized") || msg.includes("missing_api_key")) {
        setAiError("OpenAI API anahtarı geçersiz veya tanımlı değil.");
      } else if (msg.includes("empty_response")) {
        setAiError("Yapay zekadan boş yanıt alındı. Lütfen tekrar deneyiniz.");
      } else {
        setAiError("Tavsiyeler alınamadı. Lütfen daha sonra tekrar deneyiniz.");
      }
    } finally {
      setAiLoading(false);
    }
  };



  return (
    <div className="relative flex h-screen flex-col bg-gradient-to-br from-slate-50 via-indigo-50/40 to-violet-50/40 text-slate-900 lg:flex-row">
      <aside
        style={{ backgroundColor: "rgba(255,255,255,0.75)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", willChange: "transform, width" }}
        className={`flex flex-col overflow-hidden border-slate-200/60 shadow-2xl shadow-slate-900/[0.04] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] transform-gpu lg:h-screen lg:border-r ${
          sidebarOpen
            ? "w-full border-b lg:w-[440px]"
            : "h-0 w-full border-b-0 lg:h-screen lg:w-0 lg:border-r-0"
        }`}
      >
        <div className="flex h-full w-full flex-col lg:w-[440px]">
          <header className="flex items-center gap-3 border-b border-slate-200/60 px-6 py-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-500/30">
              <Navigation className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-bold leading-tight tracking-tight text-slate-900">Rota Planlayıcı</h1>
              <p className="truncate text-xs font-medium text-slate-500">Çok duraklı rotanızı planlayın</p>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                icon={<RouteIcon className="h-4 w-4" />}
                label="Toplam Mesafe"
                value={metrics ? `${metrics.distanceKm.toFixed(1)} km` : "—"}
                accent="blue"
              />
              <MetricCard
                icon={<Clock className="h-4 w-4" />}
                label="Toplam Süre"
                value={metrics ? formatDuration(metrics.durationMin) : "—"}
                accent="indigo"
              />
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
                  Duraklar
                </h2>
                <span className="text-[11px] font-medium text-slate-400">{stops.length} nokta</span>
              </div>

              <div className="space-y-2.5">
                {stops.map((stop, i) => (
                  <StopRow
                    key={stop.id}
                    index={i}
                    total={stops.length}
                    stop={stop}
                    eta={etas[i]}
                    canRemove={stops.length > 2}
                    mapReady={mapReady}
                    isDragging={dragId === stop.id}
                    isDragOver={dragOverId === stop.id && dragId !== stop.id}
                    onChange={(patch) => updateStop(stop.id, patch)}
                    onRemove={() => removeStop(stop.id)}
                    onDragStart={() => onDragStart(stop.id)}
                    onDragOver={(e) => onDragOver(stop.id, e)}
                    onDrop={() => onDrop(stop.id)}
                    onDragEnd={onDragEnd}
                  />
                ))}
              </div>

              <button
                onClick={addStop}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white/50 px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" /> Durak Ekle
              </button>
            </div>

            {statusMsg && (
              <div className="rounded-xl border border-amber-200/70 bg-amber-50/80 px-3.5 py-2.5 text-xs font-medium text-amber-800">
                {statusMsg}
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border border-violet-200/60 bg-gradient-to-br from-violet-50/80 via-fuchsia-50/60 to-transparent shadow-sm">
              <button
                type="button"
                onClick={() => setAiOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-violet-800 transition hover:bg-violet-100/40"
              >
                <Sparkles className="h-4 w-4 text-violet-600" />
                <span className="flex-1">🤖 Yapay Zeka Rota Tavsiyeleri</span>
                <ChevronDown
                  className={`h-4 w-4 text-violet-500 transition-transform ${aiOpen ? "rotate-180" : ""}`}
                />
              </button>
              {aiOpen && (
                <div className="space-y-3 border-t border-violet-200/60 bg-white/60 p-3 backdrop-blur">
                  <button
                    onClick={generateAdvice}
                    disabled={aiLoading || aiLocked}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 via-violet-600 to-fuchsia-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition-all duration-200 hover:shadow-lg hover:shadow-violet-500/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 transform-gpu"
                  >
                    {aiLoading || aiLocked ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Düşünülüyor...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" /> Tavsiyeleri Oluştur
                      </>
                    )}
                  </button>
                  {aiError && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs font-medium text-rose-700 animate-fade-in">
                      {aiError}
                    </div>
                  )}
                  {aiText && (
                    <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200/70 bg-white p-5 text-[13.5px] leading-[1.75] text-slate-700 shadow-sm animate-fade-in [&_strong]:text-slate-900 [&_ul]:my-2.5 [&_p]:my-2 [&_code]:bg-slate-100">
                      <MiniMarkdown text={aiText} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>


          <div className="border-t border-slate-200/60 bg-white/70 p-5 backdrop-blur">
            <button
              onClick={calculate}
              disabled={!mapReady || calculating}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-700 px-4 py-3 text-sm font-semibold tracking-tight text-white shadow-lg shadow-indigo-500/30 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/40 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none transform-gpu"
            >
              {calculating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Hesaplanıyor...
                </>
              ) : (
                <>
                  <Navigation className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  Rotayı Hesapla
                </>
              )}
            </button>
          </div>
        </div>
      </aside>

      <section className="relative flex-1 min-h-[50vh] lg:min-h-0">
        <div ref={mapDivRef} className="absolute inset-0 h-full w-full" />
        {!mapReady && !mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Harita yükleniyor...
          </div>
        )}
        {mapError && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-100 p-6 text-center">
            <div className="max-w-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <MapPin className="h-6 w-6" />
              </div>
              <p className="text-sm text-slate-600">{mapError}</p>
            </div>
          </div>
        )}

        <button
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label={sidebarOpen ? "Paneli gizle" : "Paneli göster"}
          className="absolute left-4 top-4 z-10 hidden h-11 w-11 items-center justify-center rounded-full border border-slate-200/60 bg-white/80 text-slate-700 shadow-xl shadow-slate-900/10 backdrop-blur-xl transition-all duration-200 hover:scale-105 hover:bg-white hover:text-indigo-600 active:scale-95 lg:flex transform-gpu"
        >
          {sidebarOpen ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>
      </section>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: "blue" | "indigo";
}) {
  const gradient =
    accent === "blue"
      ? "from-indigo-50 via-white to-violet-50/60"
      : "from-violet-50 via-white to-fuchsia-50/60";
  const tone =
    accent === "blue"
      ? "text-indigo-600 bg-indigo-100/70"
      : "text-violet-600 bg-violet-100/70";
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-slate-200/60 bg-gradient-to-br ${gradient} p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md transform-gpu`}
    >
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          {label}
        </span>
      </div>
      <div key={value} className="mt-3 text-2xl font-bold tabular-nums tracking-tight text-slate-900 animate-fade-in">
        {value}
      </div>
    </div>
  );
}

function StopRow({
  index,
  total,
  stop,
  eta,
  canRemove,
  mapReady,
  isDragging,
  isDragOver,
  onChange,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  index: number;
  total: number;
  stop: Stop;
  eta: Date | null;
  canRemove: boolean;
  mapReady: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onChange: (patch: Partial<Stop>) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acRef = useRef<any>(null);
  const [draggable, setDraggable] = useState(false);

  useEffect(() => {
    if (!mapReady || !inputRef.current || acRef.current || !window.google?.maps?.places) return;
    const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
      fields: ["place_id", "formatted_address", "geometry"],
    });
    ac.addListener("place_changed", () => {
      const p = ac.getPlace();
      onChange({
        address: p.formatted_address ?? inputRef.current?.value ?? "",
        placeId: p.place_id,
        location: p.geometry?.location
          ? { lat: p.geometry.location.lat(), lng: p.geometry.location.lng() }
          : undefined,
      });
    });
    acRef.current = ac;
  }, [mapReady, onChange]);

  const isStart = index === 0;
  const isEnd = index === total - 1;
  const label = isStart ? "Başlangıç" : isEnd ? "Varış" : `Durak ${index}`;
  const badgeTone = isStart
    ? "bg-emerald-100 text-emerald-700"
    : isEnd
      ? "bg-rose-100 text-rose-700"
      : "bg-blue-100 text-blue-700";

  // Time input behaviour:
  // - Start (index 0): manual departure time only.
  // - End (last): show ETA badge, no manual input.
  // - Intermediate: show ETA badge + manual "Mola Sonrası Kalkış".
  const showEta = !isStart && eta != null;
  const showDepartureInput = !isEnd; // start + intermediates
  const depLabel = isStart ? "Kalkış Saati" : "Mola Sonrası Kalkış";

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={() => {
        setDraggable(false);
        onDragEnd();
      }}
      className={`group rounded-2xl border bg-white p-4 transition-all duration-200 transform-gpu ${
        isDragging
          ? "border-violet-400 opacity-50 shadow-lg"
          : isDragOver
            ? "border-violet-400 ring-2 ring-violet-500/15 shadow-md"
            : "border-slate-200/70 shadow-sm hover:shadow-md hover:border-slate-300/80"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onMouseDown={() => setDraggable(true)}
            onMouseUp={() => setDraggable(false)}
            onTouchStart={() => setDraggable(true)}
            onTouchEnd={() => setDraggable(false)}
            aria-label="Sürükle"
            className="cursor-grab touch-none rounded-md p-1 text-slate-300 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing active:text-slate-700"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${badgeTone}`}
          >
            {index + 1}
          </span>
          <span className="text-[13px] font-semibold tracking-tight text-slate-700">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange({ noteOpen: !stop.noteOpen })}
            aria-label="Not Ekle"
            title="Not Ekle"
            className={`rounded-md p-1 transition ${
              stop.noteOpen || stop.note
                ? "bg-amber-50 text-amber-600"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            }`}
          >
            <FileText className="h-4 w-4" />
          </button>
          {canRemove && (
            <button
              onClick={onRemove}
              className="rounded-md p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              aria-label="Durağı sil"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors" />
          <input
            ref={inputRef}
            type="text"
            value={stop.address}
            onChange={(e) => onChange({ address: e.target.value })}
            placeholder="Adres girin..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-9 pr-3 text-sm font-medium text-slate-800 placeholder:font-normal placeholder:text-slate-400 outline-none transition-all duration-200 focus:border-violet-500 focus:bg-white focus:ring-2 focus:ring-violet-500/10"
          />
        </div>

        {showEta && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700">
            <Timer className="h-3.5 w-3.5" />
            <span className="text-[11px] uppercase tracking-wide opacity-80">Tahmini Varış</span>
            <span className="ml-auto tabular-nums">
              {eta!.toDateString() === new Date().toDateString()
                ? fmtTime(eta!)
                : fmtDateTime(eta!)}
            </span>
          </div>
        )}

        {showDepartureInput && (
          <div className="relative pt-2">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 mt-1 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="datetime-local"
              value={stop.datetime}
              onChange={(e) => onChange({ datetime: e.target.value })}
              placeholder={depLabel}
              aria-label={depLabel}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2.5 pl-9 pr-3 text-sm font-medium text-slate-700 outline-none transition-all duration-200 focus:border-violet-500 focus:bg-white focus:ring-2 focus:ring-violet-500/10 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-50 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
            />
            <span className="pointer-events-none absolute -top-0.5 left-3 rounded bg-white px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              {depLabel}
            </span>
          </div>
        )}

        {stop.noteOpen && (
          <textarea
            value={stop.note ?? ""}
            onChange={(e) => onChange({ note: e.target.value })}
            placeholder="Bu durağa özel notlar (otel, hatırlatma, alışveriş...)"
            rows={2}
            className="w-full resize-none rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-xs text-slate-700 outline-none transition focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
          />
        )}
      </div>
    </div>
  );
}

function MiniMarkdown({ text }: { text: string }) {
  const renderInline = (s: string, keyPrefix: string) => {
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = regex.exec(s)) !== null) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith("**"))
        parts.push(<strong key={`${keyPrefix}-${i}`} className="font-semibold text-slate-900">{tok.slice(2, -2)}</strong>);
      else if (tok.startsWith("`"))
        parts.push(<code key={`${keyPrefix}-${i}`} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px]">{tok.slice(1, -1)}</code>);
      else
        parts.push(<em key={`${keyPrefix}-${i}`}>{tok.slice(1, -1)}</em>);
      last = m.index + tok.length;
      i++;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts;
  };

  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flushList = (key: string) => {
    if (!list.length) return;
    out.push(
      <ul key={key} className="my-2 list-disc space-y-1 pl-5">
        {list.map((it, i) => (
          <li key={i}>{renderInline(it, `${key}-${i}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) {
      flushList(`l-${idx}`);
      return;
    }
    const bullet = line.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flushList(`l-${idx}`);
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls =
        lvl === 1
          ? "mt-3 mb-1 text-base font-bold text-slate-900"
          : lvl === 2
            ? "mt-3 mb-1 text-sm font-bold text-slate-900"
            : "mt-2 mb-1 text-sm font-semibold text-slate-800";
      out.push(<p key={idx} className={cls}>{renderInline(h[2], `h-${idx}`)}</p>);
    } else {
      out.push(<p key={idx} className="my-1.5">{renderInline(line, `p-${idx}`)}</p>);
    }
  });
  flushList("l-end");
  return <div>{out}</div>;
}
