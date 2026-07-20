import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "Supabase yapılandırması eksik: VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY tanımlı değil. " +
      "Auth ve Keşfet feed'i gerçek verilerle çalışmayacak.",
  );
}

// Not: bu "anon/publishable" key tarayıcıya gömülecek şekilde tasarlanmıştır,
// gizli bir sır değildir — her tablonun gerçek erişim kontrolü Supabase'deki
// Row Level Security (RLS) politikalarıyla sağlanır, bu key'in kendisiyle değil.
export const supabase = createClient(supabaseUrl ?? "", supabaseKey ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
