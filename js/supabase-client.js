let supabaseClient = null;

function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const cfg = window.APP_CONFIG && window.APP_CONFIG.supabase;
  if (!cfg || !cfg.url || cfg.url.includes('YOUR_PROJECT')) {
    console.warn('Supabase not configured. Using demo mode.');
    return null;
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('Supabase JS library failed to load (window.supabase is missing).');
    return null;
  }
  supabaseClient = window.supabase.createClient(cfg.url, cfg.anonKey);
  return supabaseClient;
}

async function getCurrentUser() {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data: { session } } = await sb.auth.getSession();
    return session ? session.user : null;
  } catch {
    return null;
  }
}

async function getUserProfile(userId) {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
    return data;
  } catch {
    return null;
  }
}

async function signOut() {
  const sb = getSupabase();
  if (sb) await sb.auth.signOut();
  window.location.href = 'index.html';
}
