import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudFog,
  CloudSun,
  Bookmark,
  FolderOpen,
  Inbox,
  X,
  Check,
  LogIn,
  LogOut,
  User as UserIcon,
  Heart,
  Copy,
  Share2,
  Globe,
  Compass,
  Mail,
  Lock,
  Pin,
  Flag,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Live Weather (Google Weather API) — fetched per stop using coordinates
// and the stop's selected/calculated date. Uses current conditions only when
// there is no future target, otherwise prefers hourly forecast for the exact
// selected ETA/departure hour and falls back to daily day/night forecast.
// ---------------------------------------------------------------------------
type WeatherOk = {
  status: "ok";
  tempC: number;
  description: string;
  type: string;
  approx?: boolean;
  source?: "current" | "hourly" | "daily";
};
type WeatherInfo = WeatherOk | null;


const weatherCache = new Map<string, WeatherInfo>();
const weatherInflight = new Map<string, Promise<WeatherInfo>>();

const FORECAST_DAYS = 10;
const FORECAST_HOURS = 240;

// Local YYYY-MM-DD for a Date (used as a cache/day key).
function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// How many whole local days from today (negative = past).
function daysFromToday(target: Date): number {
  const a = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const today = new Date();
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

function hourKey(d: Date): string {
  return `${localDayKey(d)}T${String(d.getHours()).padStart(2, "0")}`;
}

function displayDateKey(displayDate: any): string | null {
  if (!displayDate?.year || !displayDate?.month || !displayDate?.day) return null;
  return `${displayDate.year}-${String(displayDate.month).padStart(2, "0")}-${String(displayDate.day).padStart(2, "0")}`;
}

async function fetchCurrentWeather(lat: number, lng: number, approx = false): Promise<WeatherInfo> {
  const url = `https://weather.googleapis.com/v1/currentConditions:lookup?key=${GOOGLE_MAPS_API_KEY}&location.latitude=${lat}&location.longitude=${lng}&languageCode=tr`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const tempC = j?.temperature?.degrees;
  const description = j?.weatherCondition?.description?.text ?? "";
  const type = j?.weatherCondition?.type ?? "";
  if (typeof tempC !== "number") return null;
  return { status: "ok", tempC, description, type, approx, source: "current" };
}

async function fetchHourlyWeather(lat: number, lng: number, target: Date): Promise<WeatherInfo> {
  const now = new Date();
  const hoursAhead = Math.ceil((target.getTime() - now.getTime()) / 3_600_000) + 1;
  const hours = Math.min(FORECAST_HOURS, Math.max(1, hoursAhead));
  const url = `https://weather.googleapis.com/v1/forecast/hours:lookup?key=${GOOGLE_MAPS_API_KEY}&location.latitude=${lat}&location.longitude=${lng}&hours=${hours}&languageCode=tr`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const list: any[] = Array.isArray(j?.forecastHours) ? j.forecastHours : [];
  if (!list.length) return null;
  const targetMs = target.getTime();
  const match = list.reduce<any | null>((best, item) => {
    const start = item?.interval?.startTime ? new Date(item.interval.startTime).getTime() : NaN;
    if (!Number.isFinite(start)) return best;
    if (!best) return item;
    const bestStart = new Date(best.interval.startTime).getTime();
    return Math.abs(start - targetMs) < Math.abs(bestStart - targetMs) ? item : best;
  }, null);
  const tempC = match?.temperature?.degrees;
  const description = match?.weatherCondition?.description?.text ?? "";
  const type = match?.weatherCondition?.type ?? "";
  if (typeof tempC !== "number") return null;
  return { status: "ok", tempC, description, type, source: "hourly" };
}

async function fetchDailyWeather(lat: number, lng: number, target: Date, offset: number): Promise<WeatherInfo> {
  const days = Math.min(FORECAST_DAYS, Math.max(1, offset + 1));
  const dayKey = localDayKey(target);
  const url = `https://weather.googleapis.com/v1/forecast/days:lookup?key=${GOOGLE_MAPS_API_KEY}&location.latitude=${lat}&location.longitude=${lng}&days=${days}&languageCode=tr`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  const list: any[] = Array.isArray(j?.forecastDays) ? j.forecastDays : [];
  const match = list.find((d) => displayDateKey(d?.displayDate) === dayKey);
  if (!match) return null;

  const targetMs = target.getTime();
  const inInterval = (part: any) => {
    const start = part?.interval?.startTime ? new Date(part.interval.startTime).getTime() : NaN;
    const end = part?.interval?.endTime ? new Date(part.interval.endTime).getTime() : NaN;
    return Number.isFinite(start) && Number.isFinite(end) && targetMs >= start && targetMs < end;
  };
  const isDaytime = inInterval(match.daytimeForecast)
    ? true
    : inInterval(match.nighttimeForecast)
      ? false
      : target.getHours() >= 6 && target.getHours() < 18;
  const part = isDaytime ? match.daytimeForecast : match.nighttimeForecast;
  const tempC =
    part?.temperature?.degrees ??
    (isDaytime ? match?.maxTemperature?.degrees : match?.minTemperature?.degrees) ??
    match?.maxTemperature?.degrees ??
    match?.minTemperature?.degrees;
  const description = part?.weatherCondition?.description?.text ?? "";
  const type = part?.weatherCondition?.type ?? "";
  if (typeof tempC !== "number") return null;
  return { status: "ok", tempC, description, type, source: "daily" };
}

async function fetchWeather(
  lat: number,
  lng: number,
  target: Date | null,
): Promise<WeatherInfo> {
  const now = new Date();
  const offset = target ? daysFromToday(target) : 0;
  const isFutureTarget = !!target && target.getTime() > now.getTime() + 15 * 60_000;
  const withinForecastWindow = !!target && offset >= 0 && offset < FORECAST_DAYS;
  const dayKey = target
    ? withinForecastWindow
      ? hourKey(target)
      : `guncel-${localDayKey(target)}`
    : "current";
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}|${dayKey}`;
  if (weatherCache.has(key)) return weatherCache.get(key)!;
  if (weatherInflight.has(key)) return weatherInflight.get(key)!;

  const p = (async (): Promise<WeatherInfo> => {
    try {
      if (!target || !isFutureTarget) return fetchCurrentWeather(lat, lng);
      if (!withinForecastWindow) return fetchCurrentWeather(lat, lng, true);
      const hourly = await fetchHourlyWeather(lat, lng, target);
      if (hourly) return hourly;
      return fetchDailyWeather(lat, lng, target, offset);
    } catch {
      return null;
    }
  })().then((v) => {
    weatherCache.set(key, v);
    weatherInflight.delete(key);
    return v;
  });

  weatherInflight.set(key, p);
  return p;
}


function WeatherIcon({ type, className }: { type: string; className?: string }) {
  const t = type.toUpperCase();
  if (t.includes("THUNDER")) return <CloudLightning className={className} />;
  if (t.includes("SNOW") || t.includes("SLEET") || t.includes("HAIL"))
    return <CloudSnow className={className} />;
  if (t.includes("RAIN") || t.includes("SHOWER") || t.includes("DRIZZLE"))
    return <CloudRain className={className} />;
  if (t.includes("FOG") || t.includes("MIST") || t.includes("HAZE") || t.includes("SMOKE"))
    return <CloudFog className={className} />;
  if (t.includes("PARTLY") || t.includes("MOSTLY_CLEAR")) return <CloudSun className={className} />;
  if (t.includes("CLOUD")) return <Cloud className={className} />;
  if (t.includes("CLEAR") || t.includes("SUN")) return <Sun className={className} />;
  return <Cloud className={className} />;
}

function WeatherBadge({
  location,
  targetDate,
}: {
  location?: { lat: number; lng: number };
  targetDate?: Date | null;
}) {
  const [data, setData] = useState<WeatherInfo>(null);
  const [loading, setLoading] = useState(false);

  const targetKey = targetDate ? targetDate.getTime() : 0;

  useEffect(() => {
    if (!location) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchWeather(location.lat, location.lng, targetDate ?? null)
      .then((w) => {
        if (!cancelled) setData(w);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [location?.lat, location?.lng, targetKey]);

  if (!location) return null;
  if (loading) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg bg-slate-100/70 px-2 py-1">
        <div className="h-3 w-3 animate-pulse rounded-full bg-slate-300" />
        <div className="h-2.5 w-10 animate-pulse rounded bg-slate-300" />
      </div>
    );
  }
  if (!data) return null;
  return (
    <div
      className="flex items-center gap-1.5 rounded-lg border border-sky-100 bg-sky-50/70 px-2 py-1 text-[11px] font-medium text-slate-600 animate-fade-in"
      title={data.approx ? `${data.description} (yaklaşık)` : data.description}
    >
      <WeatherIcon type={data.type} className="h-3.5 w-3.5 text-sky-600" />
      <span className="tabular-nums font-semibold text-slate-700">
        {data.approx ? "~" : ""}{Math.round(data.tempC)}°C
      </span>
      {data.description && (
        <span className="hidden text-slate-500 sm:inline">· {data.description}</span>
      )}
    </div>
  );
}


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
  socialNote?: string;
  socialNoteOpen?: boolean;
  placeId?: string;
  location?: { lat: number; lng: number };
};

type Metrics = { distanceKm: number; durationMin: number } | null;

interface SavedTrip {
  id: string;
  title: string;
  createdAt: string;
  stops: Stop[];
  metrics: { distance: string; duration: string };
}

const SAVED_TRIPS_KEY = "trip_planner_saved_trips";

function loadSavedTrips(): SavedTrip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_TRIPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSavedTrips(trips: SavedTrip[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVED_TRIPS_KEY, JSON.stringify(trips));
  } catch {
    /* ignore quota */
  }
}

// ---------------------------------------------------------------------------
// Simulated Auth + Public Shared Feed (localStorage-backed social layer).
// ---------------------------------------------------------------------------
interface AppUser {
  username: string;
  email: string;
  bio: string;
  avatarUrl: string;
}

interface StoredUser extends AppUser {
  passwordHash: string;
}

interface SharedTrip {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  publisher: AppUser;
  stops: Stop[];
  metrics: { distance: string; duration: string };
  likes: number;
  likedByMe?: boolean;
}

const AUTH_KEY = "trip_planner_current_user";
const USERS_KEY = "trip_planner_users";
const FEED_KEY = "public_shared_feed";

const AVATAR_PALETTE = [
  "6366f1,ffffff", "8b5cf6,ffffff", "ec4899,ffffff",
  "f97316,ffffff", "10b981,ffffff", "0ea5e9,ffffff",
];
function avatarFor(username: string): string {
  const hash = Array.from(username).reduce((a, c) => a + c.charCodeAt(0), 0);
  const palette = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  const [bg, fg] = palette.split(",");
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=${bg}&color=${fg}&bold=true&size=128`;
}

// Lightweight non-cryptographic hash — sufficient for a client-only demo layer.
function hashPassword(pw: string): string {
  let h = 5381;
  for (let i = 0; i < pw.length; i++) h = ((h << 5) + h + pw.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(36)}_${pw.length}`;
}

function loadCurrentUser(): AppUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AppUser) : null;
  } catch {
    return null;
  }
}
function persistCurrentUser(u: AppUser | null) {
  if (typeof window === "undefined") return;
  try {
    if (u) window.localStorage.setItem(AUTH_KEY, JSON.stringify(u));
    else window.localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignore */
  }
}
function loadUsers(): StoredUser[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function persistUsers(users: StoredUser[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch {
    /* ignore */
  }
}

const SEED_FEED: SharedTrip[] = [
  {
    id: "seed-ege",
    title: "Ege Kıyıları Kaçamağı",
    description: "İzmir'den başlayıp Çeşme, Alaçatı ve Kuşadası'nda mola vererek Bodrum'a inen 3 günlük rüya rota. Deniz, mezeler ve gün batımları eşliğinde.",
    publishedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    publisher: {
      username: "deniz.gezgin", email: "deniz@example.com",
      bio: "Kıyı yolları koleksiyoncusu",
      avatarUrl: avatarFor("deniz.gezgin"),
    },
    stops: [
      { id: uidLocal(), address: "İzmir, Türkiye", datetime: "" },
      { id: uidLocal(), address: "Çeşme, İzmir, Türkiye", datetime: "" },
      { id: uidLocal(), address: "Kuşadası, Aydın, Türkiye", datetime: "" },
      { id: uidLocal(), address: "Bodrum, Muğla, Türkiye", datetime: "" },
    ],
    metrics: { distance: "412.6 km", duration: "5 sa 40 dk" },
    likes: 128,
  },
  {
    id: "seed-alp",
    title: "Alp Dağları Sürüşü",
    description: "İnnsbruck'tan Zürih'e, virajlı dağ yollarında panoramik bir Avrupa turu. Fotoğraf molaları kaçırılmamalı!",
    publishedAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
    publisher: {
      username: "mira.wanders", email: "mira@example.com",
      bio: "Dağ yolu meraklısı",
      avatarUrl: avatarFor("mira.wanders"),
    },
    stops: [
      { id: uidLocal(), address: "Innsbruck, Avusturya", datetime: "" },
      { id: uidLocal(), address: "St. Moritz, İsviçre", datetime: "" },
      { id: uidLocal(), address: "Andermatt, İsviçre", datetime: "" },
      { id: uidLocal(), address: "Zürih, İsviçre", datetime: "" },
    ],
    metrics: { distance: "486.2 km", duration: "7 sa 15 dk" },
    likes: 214,
  },
  {
    id: "seed-kapadokya",
    title: "Kapadokya & İç Anadolu",
    description: "Ankara'dan başlayıp Tuz Gölü ve Aksaray üzerinden peri bacalarına ulaşan sakin bir hafta sonu rotası.",
    publishedAt: new Date(Date.now() - 12 * 86_400_000).toISOString(),
    publisher: {
      username: "anadolu.notlari", email: "anadolu@example.com",
      bio: "Sessiz rotalar, uzun sohbetler",
      avatarUrl: avatarFor("anadolu.notlari"),
    },
    stops: [
      { id: uidLocal(), address: "Ankara, Türkiye", datetime: "" },
      { id: uidLocal(), address: "Tuz Gölü, Türkiye", datetime: "" },
      { id: uidLocal(), address: "Aksaray, Türkiye", datetime: "" },
      { id: uidLocal(), address: "Göreme, Nevşehir, Türkiye", datetime: "" },
    ],
    metrics: { distance: "329.4 km", duration: "4 sa 20 dk" },
    likes: 87,
  },
];

function uidLocal() {
  return Math.random().toString(36).slice(2, 9);
}

function loadFeed(): SharedTrip[] {
  if (typeof window === "undefined") return SEED_FEED;
  try {
    const raw = window.localStorage.getItem(FEED_KEY);
    if (!raw) {
      window.localStorage.setItem(FEED_KEY, JSON.stringify(SEED_FEED));
      return SEED_FEED;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : SEED_FEED;
  } catch {
    return SEED_FEED;
  }
}
function persistFeed(feed: SharedTrip[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FEED_KEY, JSON.stringify(feed));
  } catch {
    /* ignore */
  }
}

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

// Smart Turkish date/time: "Bugün, 14:30" / "Yarın, 09:00" / "23 Haziran 2026, 11:15"
const TR_MONTHS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
];
function fmtSmartTR(d: Date): string {
  const time = fmtTime(d);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return `Bugün, ${time}`;
  if (sameDay(d, tomorrow)) return `Yarın, ${time}`;
  return `${d.getDate()} ${TR_MONTHS[d.getMonth()]} ${d.getFullYear()}, ${time}`;
}

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
  const [activeTab, setActiveTab] = useState<"new" | "trips" | "discover">("new");
  const [savedTrips, setSavedTrips] = useState<SavedTrip[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // ── Social layer state ───────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [feed, setFeed] = useState<SharedTrip[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [shareTrip, setShareTrip] = useState<SavedTrip | null>(null);
  const [shareDesc, setShareDesc] = useState("");
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

  useEffect(() => {
    setSavedTrips(loadSavedTrips());
  }, []);

  const commitSavedTrips = (next: SavedTrip[]) => {
    setSavedTrips(next);
    persistSavedTrips(next);
  };

  const openSaveModal = () => {
    if (!currentUser) {
      toast.error("Geziyi kaydetmek için giriş yapmalısın.");
      openLogin("signin");
      return;
    }
    const filled = stops.filter((s) => s.address.trim().length > 0);
    if (filled.length < 2) {
      toast.error("Kaydetmek için en az 2 dolu durak gereklidir.");
      return;
    }
    const defaultTitle = `Gezi • ${new Date().toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    })}`;
    setSaveTitle(defaultTitle);
    setSaveModalOpen(true);
  };

  const confirmSaveTrip = () => {
    const title = saveTitle.trim();
    if (!title) {
      toast.error("Lütfen bir gezi başlığı girin.");
      return;
    }
    const trip: SavedTrip = {
      id: uid(),
      title,
      createdAt: new Date().toISOString(),
      stops: stops.map((s) => ({ ...s })),
      metrics: {
        distance: metrics ? `${metrics.distanceKm.toFixed(1)} km` : "—",
        duration: metrics ? formatDuration(metrics.durationMin) : "—",
      },
    };
    commitSavedTrips([trip, ...savedTrips]);
    setSaveModalOpen(false);
    setSaveTitle("");
    toast.success("Gezi başarıyla kaydedildi!");
  };

  const loadTrip = (trip: SavedTrip) => {
    setStops(trip.stops.map((s) => ({ ...s, id: s.id || uid() })));
    setMetrics(null);
    setLegDurations([]);
    setStatusMsg("Kayıtlı gezi yüklendi. Güncel rota için 'Rotayı Hesapla' butonunu kullanın.");
    setActiveTab("new");
    toast.success(`"${trip.title}" yüklendi.`);
  };

  const deleteTrip = (id: string) => {
    commitSavedTrips(savedTrips.filter((t) => t.id !== id));
    setConfirmDeleteId(null);
    toast.success("Gezi silindi.");
  };

  // ── Auth handlers ────────────────────────────────────────────────────
  useEffect(() => {
    setCurrentUser(loadCurrentUser());
    setFeed(loadFeed());
  }, []);

  const openLogin = (mode: "signin" | "signup" = "signin") => {
    setAuthMode(mode);
    setAuthEmail("");
    setAuthPassword("");
    setAuthUsername("");
    setAuthError(null);
    setLoginOpen(true);
  };
  const confirmAuth = () => {
    const email = authEmail.trim().toLowerCase();
    const password = authPassword;
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setAuthError("Geçerli bir e-posta girin.");
      return;
    }
    if (password.length < 6) {
      setAuthError("Şifre en az 6 karakter olmalıdır.");
      return;
    }
    const users = loadUsers();
    if (authMode === "signup") {
      const uname = authUsername.trim().replace(/\s+/g, ".").toLowerCase();
      if (uname.length < 3) {
        setAuthError("Kullanıcı adı en az 3 karakter olmalıdır.");
        return;
      }
      if (users.some((u) => u.email === email)) {
        setAuthError("Bu e-posta zaten kayıtlı. Giriş yapmayı deneyin.");
        return;
      }
      if (users.some((u) => u.username === uname)) {
        setAuthError("Bu kullanıcı adı zaten alınmış.");
        return;
      }
      const stored: StoredUser = {
        username: uname,
        email,
        bio: "Rotalarını topluluğa açan gezgin.",
        avatarUrl: avatarFor(uname),
        passwordHash: hashPassword(password),
      };
      persistUsers([stored, ...users]);
      const { passwordHash, ...pub } = stored;
      setCurrentUser(pub);
      persistCurrentUser(pub);
      setLoginOpen(false);
      toast.success(`Hoş geldin, @${pub.username}!`);
      return;
    }
    // Sign in
    const found = users.find((u) => u.email === email);
    if (!found || found.passwordHash !== hashPassword(password)) {
      setAuthError("E-posta veya şifre hatalı.");
      return;
    }
    const { passwordHash, ...pub } = found;
    setCurrentUser(pub);
    persistCurrentUser(pub);
    setLoginOpen(false);
    toast.success(`Tekrar hoş geldin, @${pub.username}!`);
  };
  const logout = () => {
    setActiveTab("new");
    setCurrentUser(null);
    persistCurrentUser(null);
    setUserMenuOpen(false);
    toast.success("Çıkış yapıldı.");
  };

  // ── Feed handlers ────────────────────────────────────────────────────
  const commitFeed = (next: SharedTrip[]) => {
    setFeed(next);
    persistFeed(next);
  };

  const openShareModal = (trip: SavedTrip) => {
    if (!currentUser) {
      toast.error("Paylaşmak için önce giriş yapmalısın.");
      openLogin();
      return;
    }
    setShareTrip(trip);
    setShareDesc("");
  };
  const confirmShareTrip = () => {
    if (!shareTrip || !currentUser) return;
    const shared: SharedTrip = {
      id: uid(),
      title: shareTrip.title,
      description: shareDesc.trim() || "Yeni bir rota paylaştım — beğenirseniz kopyalayın!",
      publishedAt: new Date().toISOString(),
      publisher: currentUser,
      stops: shareTrip.stops.map((s) => ({ ...s })),
      metrics: shareTrip.metrics,
      likes: 0,
    };
    commitFeed([shared, ...feed]);
    setShareTrip(null);
    setShareDesc("");
    toast.success("Gezi toplulukta paylaşıldı!");
  };

  const toggleLike = (id: string) => {
    commitFeed(
      feed.map((t) =>
        t.id === id
          ? { ...t, likedByMe: !t.likedByMe, likes: t.likes + (t.likedByMe ? -1 : 1) }
          : t,
      ),
    );
  };

  const cloneSharedTrip = (trip: SharedTrip) => {
    setStops(trip.stops.map((s) => ({ ...s, id: uid() })));
    setMetrics(null);
    setLegDurations([]);
    setActiveTab("new");
    setStatusMsg(`"${trip.title}" rotası kendi planına kopyalandı. Hesaplamak için 'Rotayı Hesapla' butonunu kullan.`);
    toast.success(`"${trip.title}" rotan kopyalandı!`);
  };

  const switchToDiscover = () => {
    setActiveTab("discover");
    setFeedLoading(true);
    setTimeout(() => setFeedLoading(false), 550);
  };



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
        style={{ backgroundColor: "rgba(255,255,255,0.8)", willChange: "transform, width" }}
        className={`flex flex-col overflow-hidden border-slate-200/50 shadow-2xl shadow-slate-900/[0.04] backdrop-blur-2xl transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] transform-gpu lg:h-screen lg:border-r ${
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

          <div className="border-b border-slate-200/60 px-6 pt-4 pb-3">
            <div className="relative flex items-center gap-1 rounded-xl bg-slate-100/80 p-1 shadow-inner">
              <span
                aria-hidden
                className="absolute top-1 bottom-1 w-[calc(33.333%-3px)] rounded-lg bg-white shadow-sm shadow-slate-900/10 ring-1 ring-slate-200/60 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] transform-gpu"
                style={{
                  transform: `translateX(${
                    activeTab === "new" ? "0%" : activeTab === "trips" ? "100%" : "200%"
                  })`,
                }}
              />
              <button
                type="button"
                onClick={() => setActiveTab("new")}
                className={`relative z-[1] flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold transition-colors duration-200 ${
                  activeTab === "new" ? "text-violet-700" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Navigation className="h-3.5 w-3.5" /> Yeni Rota
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!currentUser) {
                    toast.error("Gezilerini görmek için giriş yapmalısın.");
                    openLogin("signin");
                    return;
                  }
                  setActiveTab("trips");
                }}
                className={`relative z-[1] flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold transition-colors duration-200 ${
                  activeTab === "trips" ? "text-violet-700" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Bookmark className="h-3.5 w-3.5" /> Gezilerim
                {savedTrips.length > 0 && (
                  <span className="ml-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">
                    {savedTrips.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={switchToDiscover}
                className={`relative z-[1] flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold transition-colors duration-200 ${
                  activeTab === "discover" ? "text-violet-700" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Compass className="h-3.5 w-3.5" /> Keşfet
              </button>
            </div>
          </div>

          {activeTab === "trips" ? (
            <SavedTripsPanel
              trips={savedTrips}
              confirmDeleteId={confirmDeleteId}
              setConfirmDeleteId={setConfirmDeleteId}
              onLoad={loadTrip}
              onDelete={deleteTrip}
              onShare={openShareModal}
              onNew={() => setActiveTab("new")}
            />
          ) : activeTab === "discover" ? (
            <DiscoverPanel
              feed={feed}
              loading={feedLoading}
              currentUser={currentUser}
              onLike={toggleLike}
              onClone={cloneSharedTrip}
              onLoginPrompt={openLogin}
            />
          ) : (
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

              <div className="relative space-y-4 pl-7">
                <div
                  aria-hidden
                  className="pointer-events-none absolute left-[10px] top-4 bottom-4 border-l-2 border-dashed border-violet-200/80"
                />
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
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white/50 px-3 py-3 text-sm font-semibold text-slate-600 transition-all duration-200 hover:border-violet-400 hover:bg-violet-50/60 hover:text-violet-700 active:scale-[0.99]"
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
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-all duration-200 hover:shadow-xl hover:shadow-violet-500/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 transform-gpu"
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
                    <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200/60 bg-white p-6 text-[14px] leading-[1.7] text-slate-700 shadow-sm animate-fade-in [&_strong]:font-semibold [&_strong]:text-slate-900 [&_ul]:my-3 [&_ul]:space-y-1.5 [&_li]:leading-[1.65] [&_p]:my-2.5 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-slate-800 [&_blockquote]:my-3 [&_blockquote]:border-l-[3px] [&_blockquote]:border-violet-300 [&_blockquote]:bg-violet-50/40 [&_blockquote]:py-1 [&_blockquote]:pl-4 [&_blockquote]:text-slate-600 [&_blockquote]:italic">
                      <MiniMarkdown text={aiText} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          )}

          {activeTab === "new" && (
          <div className="border-t border-slate-200/60 bg-white/70 p-5 backdrop-blur">
            <div className="flex gap-2">
              <button
                onClick={openSaveModal}
                className="group flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold tracking-tight text-slate-700 shadow-sm transition-all duration-200 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 active:scale-[0.97] transform-gpu"
                title="Bu geziyi kaydet"
              >
                <Bookmark className="h-4 w-4 transition group-hover:scale-110" />
                <span className="hidden sm:inline">Geziyi Kaydet</span>
              </button>
              <button
                onClick={calculate}
                disabled={!mapReady || calculating}
                className="group flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 px-4 py-3 text-sm font-semibold tracking-tight text-white shadow-lg shadow-indigo-500/30 transition-all duration-200 hover:shadow-xl hover:shadow-indigo-500/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none transform-gpu"
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
          )}
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
          className="absolute left-4 top-4 z-10 hidden h-11 w-11 items-center justify-center rounded-full border border-slate-200/50 bg-white/90 text-slate-600 shadow-xl shadow-violet-500/20 backdrop-blur-xl transition-all duration-300 hover:scale-105 hover:bg-white hover:text-violet-600 hover:shadow-2xl hover:shadow-violet-500/30 active:scale-95 lg:flex transform-gpu"
        >
          {sidebarOpen ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>

        {/* Top-right auth affordance */}
        <div className="absolute right-4 top-4 z-20">
          {currentUser ? (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border border-slate-200/60 bg-white/90 py-1 pl-1 pr-3 text-[13px] font-semibold text-slate-700 shadow-xl shadow-violet-500/10 backdrop-blur-xl transition-all duration-200 hover:bg-white hover:shadow-2xl hover:shadow-violet-500/20 active:scale-[0.97] transform-gpu"
              >
                <img
                  src={currentUser.avatarUrl}
                  alt={currentUser.username}
                  className="h-8 w-8 rounded-full ring-2 ring-white"
                />
                <span className="hidden max-w-[120px] truncate sm:inline">@{currentUser.username}</span>
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 transition-transform ${userMenuOpen ? "rotate-180" : ""}`}
                />
              </button>
              {userMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setUserMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-64 origin-top-right rounded-2xl border border-slate-200/60 bg-white/95 p-2 shadow-2xl backdrop-blur-2xl animate-fade-in z-20">
                    <div className="flex items-center gap-3 rounded-xl px-3 py-3">
                      <img
                        src={currentUser.avatarUrl}
                        alt={currentUser.username}
                        className="h-11 w-11 rounded-full ring-2 ring-violet-100"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-bold text-slate-900">
                          @{currentUser.username}
                        </p>
                        <p className="truncate text-[11px] text-slate-500">{currentUser.bio}</p>
                      </div>
                    </div>
                    <div className="my-1 h-px bg-slate-100" />
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        toast("Profil sayfası yakında geliyor ✨");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-slate-700 transition hover:bg-violet-50 hover:text-violet-700"
                    >
                      <UserIcon className="h-4 w-4" /> Profilim
                    </button>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        setActiveTab("trips");
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-slate-700 transition hover:bg-violet-50 hover:text-violet-700"
                    >
                      <Bookmark className="h-4 w-4" /> Gezilerim
                    </button>
                    <div className="my-1 h-px bg-slate-100" />
                    <button
                      onClick={logout}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-rose-600 transition hover:bg-rose-50"
                    >
                      <LogOut className="h-4 w-4" /> Çıkış Yap
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              onClick={() => openLogin("signin")}
              className="flex items-center gap-2 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-violet-500/30 transition-all duration-200 hover:shadow-xl hover:shadow-violet-500/40 active:scale-[0.97] transform-gpu"
            >
              <LogIn className="h-4 w-4" /> Giriş Yap
            </button>
          )}
        </div>
      </section>

      {saveModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => setSaveModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200/60 bg-white/95 p-6 shadow-2xl backdrop-blur-2xl transform-gpu"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/30">
                <Bookmark className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-slate-900">Geziyi Kaydet</h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Bu rota, duraklar ve zamanlar tarayıcınıza kaydedilecek.
                </p>
              </div>
              <button
                onClick={() => setSaveModalOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
              Gezi Başlığı
            </label>
            <input
              autoFocus
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmSaveTrip();
                if (e.key === "Escape") setSaveModalOpen(false);
              }}
              placeholder="Örn. Balkan Turu 2026"
              className="w-full rounded-xl border-0 bg-slate-50/70 px-4 py-3 text-sm text-slate-800 outline-none ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-violet-500/40"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setSaveModalOpen(false)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                İptal
              </button>
              <button
                onClick={confirmSaveTrip}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-all duration-200 hover:shadow-xl hover:shadow-violet-500/40 active:scale-[0.97] transform-gpu"
              >
                <Check className="h-4 w-4" /> Kaydet
              </button>
            </div>
          </div>
        </div>
      )}

      {loginOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => setLoginOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/60 bg-white/80 p-6 shadow-2xl backdrop-blur-2xl transform-gpu ring-1 ring-slate-200/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/30">
                <LogIn className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-slate-900">
                  {authMode === "signin" ? "Tekrar Hoş Geldin" : "Topluluğa Katıl"}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {authMode === "signin"
                    ? "E-posta ve şifrenle giriş yap."
                    : "Kısa bir kayıt sonrası rotalarını paylaşmaya başla."}
                </p>
              </div>
              <button
                onClick={() => setLoginOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 inline-flex w-full rounded-xl bg-slate-100/80 p-1 text-[12px] font-semibold">
              <button
                type="button"
                onClick={() => { setAuthMode("signin"); setAuthError(null); }}
                className={`flex-1 rounded-lg px-3 py-1.5 transition ${authMode === "signin" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                Giriş Yap
              </button>
              <button
                type="button"
                onClick={() => { setAuthMode("signup"); setAuthError(null); }}
                className={`flex-1 rounded-lg px-3 py-1.5 transition ${authMode === "signup" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                Kayıt Ol
              </button>
            </div>

            <div className="space-y-3">
              {authMode === "signup" && (
                <div className="relative">
                  <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    autoFocus
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value.replace(/\s+/g, "."))}
                    placeholder="Kullanıcı adı"
                    className="w-full rounded-xl border-0 bg-slate-50/70 py-3 pl-9 pr-3 text-sm text-slate-800 outline-none ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-violet-500/40"
                  />
                </div>
              )}
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  autoFocus={authMode === "signin"}
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="E-posta adresi"
                  className="w-full rounded-xl border-0 bg-slate-50/70 py-3 pl-9 pr-3 text-sm text-slate-800 outline-none ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-violet-500/40"
                />
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmAuth();
                    if (e.key === "Escape") setLoginOpen(false);
                  }}
                  placeholder="Şifre (en az 6 karakter)"
                  className="w-full rounded-xl border-0 bg-slate-50/70 py-3 pl-9 pr-3 text-sm text-slate-800 outline-none ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-violet-500/40"
                />
              </div>
            </div>

            {authError && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-medium text-rose-700 ring-1 ring-rose-100 animate-fade-in">
                {authError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setLoginOpen(false)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                İptal
              </button>
              <button
                onClick={confirmAuth}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-all duration-200 hover:shadow-xl hover:shadow-violet-500/40 active:scale-[0.97] transform-gpu"
              >
                <LogIn className="h-4 w-4" /> {authMode === "signin" ? "Giriş Yap" : "Kayıt Ol"}
              </button>
            </div>
          </div>
        </div>
      )}

      {shareTrip && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => setShareTrip(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/60 bg-white/85 p-6 shadow-2xl backdrop-blur-2xl transform-gpu ring-1 ring-slate-200/60"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/30">
                <Share2 className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="truncate text-base font-bold text-slate-900">Toplulukta Paylaş</h3>
                <p className="mt-0.5 truncate text-xs text-slate-500">"{shareTrip.title}"</p>
              </div>
              <button
                onClick={() => setShareTrip(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
              Kısa Açıklama
            </label>
            <textarea
              autoFocus
              rows={3}
              value={shareDesc}
              onChange={(e) => setShareDesc(e.target.value)}
              placeholder="Örn. Yaz için mükemmel Balkan rotası!"
              className="w-full resize-none rounded-xl border-0 bg-slate-50/70 px-4 py-3 text-sm text-slate-800 outline-none ring-1 ring-slate-200 transition placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-violet-500/40"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShareTrip(null)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
              >
                İptal
              </button>
              <button
                onClick={confirmShareTrip}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-all duration-200 hover:shadow-xl hover:shadow-violet-500/40 active:scale-[0.97] transform-gpu"
              >
                <Share2 className="h-4 w-4" /> Paylaş
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

  );
}

function SavedTripsPanel({
  trips,
  confirmDeleteId,
  setConfirmDeleteId,
  onLoad,
  onDelete,
  onShare,
  onNew,
}: {
  trips: SavedTrip[];
  confirmDeleteId: string | null;
  setConfirmDeleteId: (id: string | null) => void;
  onLoad: (t: SavedTrip) => void;
  onDelete: (id: string) => void;
  onShare: (t: SavedTrip) => void;
  onNew: () => void;
}) {
  const fmtDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("tr-TR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
    } catch {
      return "";
    }
  };

  if (trips.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-10 text-center animate-fade-in">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-100 via-indigo-50 to-fuchsia-100 text-violet-500 shadow-inner">
          <Inbox className="h-9 w-9" />
        </div>
        <h3 className="text-[15px] font-bold text-slate-800">Henüz kayıtlı gezi yok</h3>
        <p className="mt-2 max-w-[280px] text-[13px] leading-relaxed text-slate-500">
          Henüz kaydedilmiş bir geziniz yok. İlk rotanızı oluşturup hemen kaydedin!
        </p>
        <button
          onClick={onNew}
          className="mt-6 flex items-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-all duration-200 hover:shadow-xl hover:shadow-violet-500/40 active:scale-[0.97] transform-gpu"
        >
          <Plus className="h-4 w-4" /> Yeni Rota Oluştur
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-3">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
          Kayıtlı Geziler
        </h2>
        <span className="text-[11px] font-medium text-slate-400">{trips.length} gezi</span>
      </div>
      {trips.map((trip) => {
        const filledStops = trip.stops.filter((s) => s.address.trim().length > 0);
        const isConfirming = confirmDeleteId === trip.id;
        return (
          <div
            key={trip.id}
            className="group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-lg hover:shadow-violet-500/10 transform-gpu"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-[14px] font-bold tracking-tight text-slate-900">
                  {trip.title}
                </h3>
                <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                  {fmtDate(trip.createdAt)}
                </p>
              </div>
              {isConfirming ? (
                <div className="flex items-center gap-1 rounded-lg bg-rose-50 p-0.5 ring-1 ring-rose-200">
                  <button
                    onClick={() => onDelete(trip.id)}
                    className="rounded-md bg-rose-600 px-2 py-1 text-[11px] font-bold text-white transition hover:bg-rose-700"
                  >
                    Sil
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="rounded-md px-2 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
                  >
                    Vazgeç
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteId(trip.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-rose-50 hover:text-rose-500"
                  aria-label="Sil"
                  title="Geziyi sil"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-violet-700 ring-1 ring-violet-100">
                <MapPin className="h-3 w-3" /> {filledStops.length} Durak
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-blue-700 ring-1 ring-blue-100">
                <RouteIcon className="h-3 w-3" /> {trip.metrics.distance}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700 ring-1 ring-indigo-100">
                <Clock className="h-3 w-3" /> {trip.metrics.duration}
              </span>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => onLoad(trip)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-md active:scale-[0.98] transform-gpu"
              >
                <FolderOpen className="h-4 w-4" /> Yükle
              </button>
              <button
                onClick={() => onShare(trip)}
                className="flex items-center justify-center gap-2 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-indigo-50 px-3 py-2 text-[13px] font-semibold text-violet-700 shadow-sm transition-all duration-200 hover:border-violet-300 hover:from-violet-100 hover:to-indigo-100 hover:shadow-md active:scale-[0.98] transform-gpu"
                title="Toplulukta paylaş"
              >
                <Share2 className="h-4 w-4" /> Toplulukta Paylaş
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function extractCountry(address: string): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

interface RouteBadge {
  label: string;
  tone: string;
}
function computeRouteBadges(trip: SharedTrip): RouteBadge[] {
  const badges: RouteBadge[] = [];
  const countries = new Set<string>();
  for (const s of trip.stops) {
    const c = extractCountry(s.address);
    if (c) countries.add(c);
  }
  const countryCount = countries.size;
  const kmMatch = trip.metrics.distance.match(/([\d.,]+)\s*km/i);
  const km = kmMatch ? parseFloat(kmMatch[1].replace(",", ".")) : NaN;

  if (countryCount > 1) {
    badges.push({ label: `#${countryCount} Ülke`, tone: "bg-amber-50 text-amber-700 ring-amber-100" });
    badges.push({ label: "#Sınır Geçişi", tone: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100" });
  }
  if (!isNaN(km) && km > 500) {
    badges.push({ label: "#Uzun Yol", tone: "bg-emerald-50 text-emerald-700 ring-emerald-100" });
  }
  if (!isNaN(km)) {
    badges.push({ label: `#${Math.round(km)} km`, tone: "bg-slate-100 text-slate-700 ring-slate-200" });
  }
  const socialCount = trip.stops.filter((s) => s.socialNote?.trim()).length;
  if (socialCount > 0) {
    badges.push({ label: `#${socialCount} Sosyal Not`, tone: "bg-indigo-50 text-indigo-700 ring-indigo-100" });
  }
  return badges;
}

function DiscoverPanel({
  feed,
  loading,
  currentUser,
  onLike,
  onClone,
  onLoginPrompt,
}: {
  feed: SharedTrip[];
  loading: boolean;
  currentUser: AppUser | null;
  onLike: (id: string) => void;
  onClone: (t: SharedTrip) => void;
  onLoginPrompt: () => void;
}) {
  const fmtRel = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days <= 0) return "bugün";
    if (days === 1) return "1 gün önce";
    if (days < 30) return `${days} gün önce`;
    const months = Math.floor(days / 30);
    return `${months} ay önce`;
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
          Topluluk Rotaları
        </h2>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
          <Globe className="h-3 w-3" /> {feed.length} paylaşım
        </span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-slate-200" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-24 rounded bg-slate-200" />
                  <div className="h-2.5 w-16 rounded bg-slate-100" />
                </div>
              </div>
              <div className="mt-4 h-3 w-3/4 rounded bg-slate-200" />
              <div className="mt-2 h-2.5 w-full rounded bg-slate-100" />
              <div className="mt-1.5 h-2.5 w-5/6 rounded bg-slate-100" />
              <div className="mt-4 flex gap-2">
                <div className="h-6 w-16 rounded-full bg-slate-100" />
                <div className="h-6 w-20 rounded-full bg-slate-100" />
                <div className="h-6 w-16 rounded-full bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : feed.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center animate-fade-in">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-100 via-indigo-50 to-fuchsia-100 text-violet-500 shadow-inner">
            <Compass className="h-9 w-9" />
          </div>
          <h3 className="text-[15px] font-bold text-slate-800">Henüz paylaşılan gezi yok</h3>
          <p className="mt-2 max-w-[280px] text-[13px] leading-relaxed text-slate-500">
            Toplulukla paylaşılan ilk rota sen olabilirsin. "Gezilerim" sekmesinden bir rotayı paylaş!
          </p>
        </div>
      ) : (
        feed.map((trip) => {
          const filled = trip.stops.filter((s) => s.address.trim().length > 0);
          return (
            <article
              key={trip.id}
              className="group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-lg hover:shadow-violet-500/10 transform-gpu animate-fade-in"
            >
              <header className="mb-2 flex items-center gap-2.5">
                <img
                  src={trip.publisher.avatarUrl}
                  alt={trip.publisher.username}
                  className="h-9 w-9 rounded-full ring-2 ring-white shadow-sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold tracking-tight text-slate-900">
                    @{trip.publisher.username}
                  </p>
                  <p className="truncate text-[11px] font-medium text-slate-400">
                    {fmtRel(trip.publishedAt)} · {trip.publisher.bio}
                  </p>
                </div>
              </header>

              <h3 className="text-[14px] font-bold tracking-tight text-slate-900">
                {trip.title}
              </h3>
              <p className="mt-1 line-clamp-3 text-[12.5px] leading-relaxed text-slate-600">
                {trip.description}
              </p>

              <div className="mt-3 rounded-xl bg-slate-50/70 p-2.5 ring-1 ring-slate-100">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-600">
                  {filled.slice(0, 4).map((s, i) => (
                    <span key={s.id} className="inline-flex items-center gap-1">
                      {i > 0 && <span className="text-slate-300">›</span>}
                      <span className="inline-flex max-w-[130px] items-center gap-1 truncate rounded-md bg-white px-1.5 py-0.5 ring-1 ring-slate-200">
                        <span className="truncate">{s.address.split(",")[0]}</span>
                        {s.socialNote?.trim() && (
                          <span
                            title={s.socialNote}
                            className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-white shadow-sm"
                          >
                            <Pin className="h-2 w-2" />
                          </span>
                        )}
                      </span>
                    </span>
                  ))}
                  {filled.length > 4 && (
                    <span className="text-slate-400">+{filled.length - 4}</span>
                  )}
                </div>
              </div>

              {/* Smart Route Badges */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[10.5px] font-semibold">
                {computeRouteBadges(trip).map((b, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center rounded-full px-2 py-0.5 ring-1 ${b.tone}`}
                  >
                    {b.label}
                  </span>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-violet-700 ring-1 ring-violet-100">
                  <MapPin className="h-3 w-3" /> {filled.length} Durak
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-700 ring-1 ring-blue-100">
                  <RouteIcon className="h-3 w-3" /> {trip.metrics.distance}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700 ring-1 ring-indigo-100">
                  <Clock className="h-3 w-3" /> {trip.metrics.duration}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => (currentUser ? onLike(trip.id) : onLoginPrompt())}
                  className={`group/like flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12.5px] font-semibold transition-all duration-200 active:scale-[0.95] transform-gpu ${
                    trip.likedByMe
                      ? "border-rose-200 bg-rose-50 text-rose-600"
                      : "border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                  }`}
                >
                  <Heart
                    className={`h-4 w-4 transition-transform duration-200 group-hover/like:scale-110 ${
                      trip.likedByMe ? "fill-rose-500 text-rose-500 animate-fade-in" : ""
                    }`}
                  />
                  {trip.likes}
                </button>
                <button
                  onClick={() => onClone(trip)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 px-3 py-2 text-[13px] font-semibold text-white shadow-md shadow-violet-500/30 transition-all duration-200 hover:shadow-lg hover:shadow-violet-500/40 active:scale-[0.97] transform-gpu"
                  title="Kendi rotana kopyala"
                >
                  <Copy className="h-4 w-4" /> Kendi Rotama Kopyala
                </button>
              </div>
            </article>
          );
        })
      )}
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
      ? "from-violet-50/60 via-white to-blue-50/60"
      : "from-indigo-50/60 via-white to-violet-50/60";
  const tone =
    accent === "blue"
      ? "text-indigo-600 bg-indigo-100/70"
      : "text-violet-600 bg-violet-100/70";
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl border border-slate-200/50 bg-gradient-to-br ${gradient} p-5 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:shadow-violet-500/10 transform-gpu`}
    >
      <div className="flex items-center gap-2">
        <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
        <span className="text-sm font-medium text-slate-500">
          {label}
        </span>
      </div>
      <div key={value} className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-slate-900 animate-fade-in transform-gpu">
        {value}
      </div>
    </div>
  );
}

// Thumbnail: Places API (New) photo → Street View Static fallback → MapPin placeholder.
const photoUrlCache = new Map<string, string>();
function StopThumbnail({ placeId, location }: { placeId?: string; location?: { lat: number; lng: number } }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!placeId && !location) {
      setUrl(null);
      return;
    }
    const cacheKey = placeId ?? `${location!.lat.toFixed(4)},${location!.lng.toFixed(4)}`;
    const cached = photoUrlCache.get(cacheKey);
    if (cached) {
      setUrl(cached);
      return;
    }
    const streetView = location
      ? `https://maps.googleapis.com/maps/api/streetview?size=160x160&location=${location.lat},${location.lng}&fov=80&key=${GOOGLE_MAPS_API_KEY}`
      : null;
    setLoading(true);
    (async () => {
      try {
        if (placeId) {
          const res = await fetch(
            `https://places.googleapis.com/v1/places/${placeId}?key=${GOOGLE_MAPS_API_KEY}&languageCode=tr`,
            { headers: { "X-Goog-FieldMask": "photos.name" } },
          );
          if (res.ok) {
            const j = await res.json();
            const name = j?.photos?.[0]?.name;
            if (name) {
              const photoUrl = `https://places.googleapis.com/v1/${name}/media?maxHeightPx=200&maxWidthPx=200&key=${GOOGLE_MAPS_API_KEY}`;
              photoUrlCache.set(cacheKey, photoUrl);
              if (!cancelled) {
                setUrl(photoUrl);
                setLoading(false);
              }
              return;
            }
          }
        }
        if (streetView) {
          photoUrlCache.set(cacheKey, streetView);
          if (!cancelled) {
            setUrl(streetView);
            setLoading(false);
          }
          return;
        }
        if (!cancelled) {
          setUrl(null);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          if (streetView) {
            setUrl(streetView);
          } else {
            setFailed(true);
          }
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [placeId, location?.lat, location?.lng]);

  const base =
    "relative h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-slate-200/70 bg-gradient-to-br from-slate-100 to-slate-50";

  if (loading) {
    return (
      <div className={`${base} animate-pulse`}>
        <div className="absolute inset-0 bg-gradient-to-r from-slate-100 via-slate-200/70 to-slate-100 bg-[length:200%_100%] animate-[shimmer_1.4s_infinite]" />
      </div>
    );
  }
  if (url && !failed) {
    return (
      <div className={base}>
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transform-gpu transition-transform duration-500 hover:scale-105"
        />
      </div>
    );
  }
  return (
    <div className={`${base} flex items-center justify-center`}>
      <MapPin className="h-5 w-5 text-slate-400" />
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

  const dotTone = isStart
    ? "bg-emerald-500 ring-emerald-200"
    : isEnd
      ? "bg-rose-500 ring-rose-200"
      : "bg-violet-500 ring-violet-200";

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
      className={`group relative rounded-2xl border border-l-4 bg-white p-4 transition-all duration-300 ease-out transform-gpu ${
        isDragging
          ? "border-violet-400 border-l-violet-500 opacity-50 shadow-lg"
          : isDragOver
            ? "border-violet-400 border-l-violet-500 ring-2 ring-violet-500/15 shadow-md"
            : "border-slate-200/60 border-l-violet-500/70 shadow-sm hover:shadow-lg hover:shadow-slate-900/[0.06] hover:border-l-violet-600 hover:-translate-y-0.5"
      }`}
    >
      {/* Timeline dot — sits on the dashed connector line */}
      <span
        aria-hidden
        className={`absolute -left-[22px] top-5 h-3 w-3 rounded-full ring-4 shadow-sm ${dotTone}`}
      />

      {/* Premium floating ETA badge — anchored on the timeline */}
      {showEta && (
        <div className="absolute -top-3 left-3 z-10 flex items-center gap-1.5 rounded-full border border-indigo-200/70 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 shadow-[0_4px_16px_-4px_rgba(99,102,241,0.35)] backdrop-blur-md animate-fade-in">
          <Timer className="h-3 w-3 text-indigo-500" />
          <span className="uppercase tracking-[0.06em] text-indigo-500/80">Varış</span>
          <span className="tabular-nums text-indigo-900">{fmtSmartTR(eta!)}</span>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onMouseDown={() => setDraggable(true)}
            onMouseUp={() => setDraggable(false)}
            onTouchStart={() => setDraggable(true)}
            onTouchEnd={() => setDraggable(false)}
            aria-label="Sürükle"
            className="cursor-grab touch-none rounded-md p-1 text-slate-400 transition-all duration-200 hover:scale-110 hover:bg-violet-50 hover:text-violet-600 active:cursor-grabbing active:text-violet-700 transform-gpu"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${badgeTone}`}
          >
            {index + 1}
          </span>
          <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-slate-700">
            <span>{label}</span>
            <WeatherBadge
              location={stop.location}
              targetDate={
                isStart
                  ? stop.datetime
                    ? new Date(stop.datetime)
                    : null
                  : (eta ?? (stop.datetime ? new Date(stop.datetime) : null))
              }
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange({ socialNoteOpen: !stop.socialNoteOpen })}
            aria-label="Sosyal Not Ekle"
            title="Sosyal Not (topluluğa göster)"
            className={`rounded-md p-1 transition ${
              stop.socialNoteOpen || stop.socialNote
                ? "bg-gradient-to-br from-violet-100 to-indigo-100 text-indigo-600 ring-1 ring-indigo-200"
                : "text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
            }`}
          >
            <Pin className="h-4 w-4" />
          </button>
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
              className="rounded-md p-1 text-slate-400 transition-all duration-200 hover:scale-110 hover:bg-rose-50 hover:text-rose-600 transform-gpu"
              aria-label="Durağı sil"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <StopThumbnail placeId={stop.placeId} location={stop.location} />
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-violet-500" />
            <input
              ref={inputRef}
              type="text"
              value={stop.address}
              onChange={(e) => onChange({ address: e.target.value })}
              placeholder="Adres girin..."
              className="w-full rounded-xl border-0 bg-slate-50/70 py-2.5 pl-9 pr-3 text-sm font-medium text-slate-800 placeholder:font-normal placeholder:text-slate-400 outline-none ring-1 ring-transparent transition-all duration-200 focus:bg-white focus:ring-2 focus:ring-violet-500/40"
            />
          </div>

          {showDepartureInput && (
            <div className="group/time relative">
              <span className="pointer-events-none absolute -top-2 left-3 z-10 rounded-md bg-white px-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">
                {depLabel}
              </span>
              <Clock className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-violet-500/80 transition-colors group-focus-within/time:text-violet-600" />
              <input
                type="datetime-local"
                value={stop.datetime}
                onChange={(e) => onChange({ datetime: e.target.value })}
                aria-label={depLabel}
                className="w-full rounded-xl border-0 bg-slate-50/70 py-2.5 pl-10 pr-3 text-sm font-semibold tabular-nums tracking-tight text-transparent outline-none ring-1 ring-transparent transition-all duration-200 focus:bg-white focus:ring-2 focus:ring-violet-500/40 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-datetime-edit]:opacity-0"
              />
              <span
                className={`pointer-events-none absolute left-10 right-3 top-1/2 -translate-y-1/2 truncate text-sm font-semibold ${
                  stop.datetime ? "text-slate-800" : "font-medium text-slate-400"
                }`}
              >
                {stop.datetime
                  ? fmtSmartTR(new Date(stop.datetime))
                  : "Yolculuk başlangıç zamanını seçin..."}
              </span>
            </div>
          )}

          {stop.socialNote && !stop.socialNoteOpen && (
            <div
              title={stop.socialNote}
              className="flex items-start gap-1.5 rounded-lg bg-gradient-to-br from-violet-50 to-indigo-50 px-2.5 py-1.5 text-[11.5px] font-medium text-indigo-700 ring-1 ring-indigo-200/70 animate-fade-in"
            >
              <Pin className="mt-0.5 h-3 w-3 shrink-0 text-indigo-500" />
              <span className="line-clamp-2 leading-snug">{stop.socialNote}</span>
            </div>
          )}

          {stop.socialNoteOpen && (
            <div className="relative">
              <span className="pointer-events-none absolute -top-2 left-3 z-10 inline-flex items-center gap-1 rounded-md bg-white px-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-indigo-500">
                <Pin className="h-2.5 w-2.5" /> Sosyal Not
              </span>
              <textarea
                autoFocus
                value={stop.socialNote ?? ""}
                onChange={(e) => onChange({ socialNote: e.target.value })}
                placeholder="Örn. Ucuz benzin, Kapıkule bekleme, güzel kahve..."
                rows={2}
                className="w-full resize-none rounded-lg border border-indigo-200 bg-indigo-50/50 px-2.5 py-2 text-xs text-slate-700 outline-none transition placeholder:text-indigo-300 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
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
