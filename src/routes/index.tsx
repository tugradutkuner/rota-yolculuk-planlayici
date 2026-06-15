import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { MapPin, Plus, Trash2, Calendar, Route as RouteIcon, Clock, Navigation, Loader2 } from "lucide-react";

// ============================================================================
// GOOGLE MAPS API KEY — Buraya kendi Google Maps API anahtarınızı yapıştırın
// ============================================================================
const GOOGLE_MAPS_API_KEY = "YOUR_GOOGLE_MAPS_API_KEY_HERE";
const GOOGLE_MAPS_LIBRARIES = "places,geometry";
// ============================================================================

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
  datetime: string;
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
    if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY.includes("YOUR_GOOGLE_MAPS_API_KEY")) {
      reject(new Error("API_KEY_MISSING"));
      return;
    }
    window.initGMaps = () => resolve();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=${GOOGLE_MAPS_LIBRARIES}&language=tr&callback=initGMaps&loading=async`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("LOAD_ERROR"));
    document.head.appendChild(s);
  });
  return mapsLoaderPromise;
}

function RoutePlanner() {
  const [stops, setStops] = useState<Stop[]>([
    { id: uid(), address: "", datetime: "" },
    { id: uid(), address: "", datetime: "" },
  ]);
  const [metrics, setMetrics] = useState<Metrics>(null);
  const [calculating, setCalculating] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || !mapDivRef.current) return;
        const g = window.google;
        mapRef.current = new g.maps.Map(mapDivRef.current, {
          center: { lat: 39.9334, lng: 32.8597 }, // Ankara
          zoom: 6,
          disableDefaultUI: false,
          mapTypeControl: false,
          streetViewControl: false,
        });
        rendererRef.current = new g.maps.DirectionsRenderer({
          map: mapRef.current,
          polylineOptions: { strokeColor: "#2563eb", strokeWeight: 5, strokeOpacity: 0.85 },
        });
        setMapReady(true);
      })
      .catch((e) => {
        setMapError(
          e.message === "API_KEY_MISSING"
            ? "Google Maps API anahtarı tanımlanmamış. Lütfen kod içindeki GOOGLE_MAPS_API_KEY sabitini güncelleyin."
            : "Google Haritalar yüklenemedi. API anahtarınızı kontrol edin.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addStop = () => setStops((s) => [...s, { id: uid(), address: "", datetime: "" }]);
  const removeStop = (id: string) =>
    setStops((s) => (s.length <= 2 ? s : s.filter((x) => x.id !== id)));
  const updateStop = (id: string, patch: Partial<Stop>) =>
    setStops((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const calculate = () => {
    if (!mapReady || !window.google) return;
    const filled = stops.filter((s) => s.address.trim().length > 0);
    if (filled.length < 2) {
      alert("Lütfen en az iki durak girin.");
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
    service.route(
      {
        origin,
        destination,
        waypoints,
        travelMode: g.maps.TravelMode.DRIVING,
      },
      (result: any, status: string) => {
        setCalculating(false);
        if (status !== "OK" || !result) {
          alert("Rota hesaplanamadı: " + status);
          return;
        }
        rendererRef.current?.setDirections(result);
        let dist = 0;
        let dur = 0;
        for (const leg of result.routes[0].legs) {
          dist += leg.distance?.value ?? 0;
          dur += leg.duration?.value ?? 0;
        }
        setMetrics({ distanceKm: dist / 1000, durationMin: Math.round(dur / 60) });
      },
    );
  };

  const formatDuration = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
            <Navigation className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Rota Planlayıcı</h1>
            <p className="text-xs text-slate-500">Çok duraklı rotanızı kolayca planlayın</p>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[420px_1fr]">
        {/* Control Panel */}
        <section className="flex flex-col gap-4">
          {/* Metrics */}
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Özet</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <RouteIcon className="h-3.5 w-3.5" /> Toplam Mesafe
                </div>
                <div className="mt-1 text-xl font-semibold">
                  {metrics ? `${metrics.distanceKm.toFixed(1)} km` : "—"}
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" /> Toplam Süre
                </div>
                <div className="mt-1 text-xl font-semibold">
                  {metrics ? formatDuration(metrics.durationMin) : "—"}
                </div>
              </div>
            </div>
          </div>

          {/* Stops */}
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Duraklar</h2>
              <span className="text-xs text-slate-500">{stops.length} durak</span>
            </div>

            <div className="space-y-3">
              {stops.map((stop, i) => (
                <StopRow
                  key={stop.id}
                  index={i}
                  stop={stop}
                  canRemove={stops.length > 2}
                  mapReady={mapReady}
                  onChange={(patch) => updateStop(stop.id, patch)}
                  onRemove={() => removeStop(stop.id)}
                />
              ))}
            </div>

            <button
              onClick={addStop}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" /> Durak Ekle
            </button>

            <button
              onClick={calculate}
              disabled={!mapReady || calculating}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {calculating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Hesaplanıyor...
                </>
              ) : (
                <>
                  <Navigation className="h-4 w-4" /> Rotayı Hesapla
                </>
              )}
            </button>
          </div>
        </section>

        {/* Map */}
        <section className="relative min-h-[400px] overflow-hidden rounded-xl border bg-white shadow-sm lg:min-h-[600px]">
          <div ref={mapDivRef} className="absolute inset-0" />
          {!mapReady && !mapError && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Harita yükleniyor...
            </div>
          )}
          {mapError && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <div className="max-w-sm">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                  <MapPin className="h-6 w-6" />
                </div>
                <p className="text-sm text-slate-600">{mapError}</p>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function StopRow({
  index,
  stop,
  canRemove,
  mapReady,
  onChange,
  onRemove,
}: {
  index: number;
  stop: Stop;
  canRemove: boolean;
  mapReady: boolean;
  onChange: (patch: Partial<Stop>) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acRef = useRef<any>(null);

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

  const label = index === 0 ? "Başlangıç" : `Durak ${index + 1}`;

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
            {index + 1}
          </span>
          <span className="text-xs font-medium text-slate-600">{label}</span>
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            className="rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            aria-label="Durağı sil"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={stop.address}
            onChange={(e) => onChange({ address: e.target.value })}
            placeholder="Adres girin..."
            className="w-full rounded-md border border-slate-200 bg-white py-2 pl-8 pr-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div className="relative">
          <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="datetime-local"
            value={stop.datetime}
            onChange={(e) => onChange({ datetime: e.target.value })}
            className="w-full rounded-md border border-slate-200 bg-white py-2 pl-8 pr-2 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
      </div>
    </div>
  );
}
