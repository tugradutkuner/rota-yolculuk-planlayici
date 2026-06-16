import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";

// ============================================================================
// GOOGLE MAPS API KEY — Buraya kendi Google Maps API anahtarınızı yapıştırın
// ============================================================================
const GOOGLE_MAPS_API_KEY = "AIzaSyC1Wp8TBZcVcwKikraqgslNwGcTogjgPYk";
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

function RoutePlanner() {
  const [stops, setStops] = useState<Stop[]>([
    { id: uid(), address: "", datetime: "" },
    { id: uid(), address: "", datetime: "" },
  ]);
  const [metrics, setMetrics] = useState<Metrics>(null);
  const [calculating, setCalculating] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const altPolylinesRef = useRef<any[]>([]);
  const lastResultRef = useRef<any>(null);

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

  // Trigger map resize on sidebar toggle so Google Maps fills new space
  useEffect(() => {
    if (!mapRef.current || !window.google) return;
    const t = setTimeout(() => {
      window.google.maps.event.trigger(mapRef.current, "resize");
    }, 320);
    return () => clearTimeout(t);
  }, [sidebarOpen]);

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
          setStatusMsg("Rota hesaplanamadı: " + status);
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
    <div className="relative flex h-screen flex-col bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-100 text-slate-900 lg:flex-row">
      {/* Sidebar */}
      <aside
        className={`flex flex-col overflow-hidden border-slate-200/70 bg-white/70 backdrop-blur-xl shadow-xl shadow-slate-900/5 transition-all duration-300 ease-in-out lg:h-screen lg:border-r ${
          sidebarOpen
            ? "w-full border-b lg:w-[420px]"
            : "h-0 w-full border-b-0 lg:h-screen lg:w-0 lg:border-r-0"
        }`}
      >
        <div className="flex h-full w-full flex-col lg:w-[420px]">
          {/* Header */}
          <header className="flex items-center gap-3 border-b border-slate-100/80 px-5 py-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md shadow-blue-300/40">
              <Navigation className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold leading-tight">Rota Planlayıcı</h1>
              <p className="truncate text-xs text-slate-500">Çok duraklı rotanızı planlayın</p>
            </div>
          </header>

          {/* Scrollable controls */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* Metrics */}
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

            {/* Stops */}
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Duraklar
                </h2>
                <span className="text-xs text-slate-400">{stops.length} nokta</span>
              </div>

              <div className="space-y-2.5">
                {stops.map((stop, i) => (
                  <StopRow
                    key={stop.id}
                    index={i}
                    total={stops.length}
                    stop={stop}
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
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {statusMsg}
              </div>
            )}
          </div>

          {/* Sticky CTA */}
          <div className="border-t border-slate-100/80 bg-white/60 p-4 backdrop-blur">
            <button
              onClick={calculate}
              disabled={!mapReady || calculating}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-blue-300/40 transition hover:shadow-lg hover:shadow-blue-400/50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
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

      {/* Map */}
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

        {/* Floating sidebar toggle */}
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label={sidebarOpen ? "Paneli gizle" : "Paneli göster"}
          className="absolute left-3 top-3 z-10 hidden h-10 w-10 items-center justify-center rounded-full border border-slate-200/70 bg-white/90 text-slate-700 shadow-lg shadow-slate-900/10 backdrop-blur transition hover:bg-white hover:text-blue-600 lg:flex"
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
      ? "from-blue-500/10 via-blue-500/5 to-transparent"
      : "from-indigo-500/10 via-indigo-500/5 to-transparent";
  const tone =
    accent === "blue"
      ? "text-blue-600 bg-blue-100/80"
      : "text-indigo-600 bg-indigo-100/80";
  return (
    <div
      className={`group relative overflow-hidden rounded-xl border border-slate-200/70 bg-gradient-to-br ${gradient} bg-white/70 p-3 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md`}
    >
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {label}
        </span>
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}

function StopRow({
  index,
  total,
  stop,
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
      className={`group rounded-xl border bg-white/80 p-3 backdrop-blur transition ${
        isDragging
          ? "border-blue-400 opacity-50"
          : isDragOver
            ? "border-blue-400 ring-2 ring-blue-200"
            : "border-slate-200/80 hover:border-slate-300 hover:shadow-sm"
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onMouseDown={() => setDraggable(true)}
            onMouseUp={() => setDraggable(false)}
            onTouchStart={() => setDraggable(true)}
            onTouchEnd={() => setDraggable(false)}
            aria-label="Sürükle"
            className="cursor-grab touch-none rounded p-0.5 text-slate-300 transition hover:text-slate-500 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${badgeTone}`}
          >
            {index + 1}
          </span>
          <span className="text-xs font-medium text-slate-600">{label}</span>
        </div>
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

      <div className="space-y-2">
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={stop.address}
            onChange={(e) => onChange({ address: e.target.value })}
            placeholder="Adres girin..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/70 py-2 pl-8 pr-2 text-sm outline-none transition focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
          />
        </div>
        <div className="relative">
          <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="datetime-local"
            value={stop.datetime}
            onChange={(e) => onChange({ datetime: e.target.value })}
            className="w-full rounded-lg border border-slate-200 bg-slate-50/70 py-2 pl-8 pr-2 text-sm text-slate-700 outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
          />
        </div>
      </div>
    </div>
  );
}
