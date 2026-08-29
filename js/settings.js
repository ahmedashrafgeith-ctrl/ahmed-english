window.EnrollmentSettings = (function () {
  function sb() {
    try { return getSupabase(); } catch (e) { return null; }
  }

  async function get() {
    const client = sb();
    if (!client) return 'open';
    try {
      const { data, error } = await client
        .from('site_settings')
        .select('value')
        .eq('key', 'enrollment_status')
        .maybeSingle();
      if (error || !data || !data.value) return 'open';
      return data.value;
    } catch (e) {
      console.warn('Failed to read enrollment status:', e);
      return 'open';
    }
  }

  async function set(value) {
    const client = sb();
    if (!client) throw new Error('Supabase unavailable');
    const { error } = await client
      .from('site_settings')
      .upsert({ key: 'enrollment_status', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    syncBadge(value);
    return value;
  }

  async function syncBadge(overrideValue) {
    const badges = document.querySelectorAll('.hero-badge, [data-enrollment-badge]');
    if (!badges || badges.length === 0) return;
    const val = overrideValue || await get();
    badges.forEach(badge => {
      if (val === 'closed') {
        badge.classList.add('closed');
        badge.innerHTML = '<span class="live"></span> Not Accepting Students Currently';
        badge.setAttribute('title', 'Enrollment is currently paused');
      } else {
        badge.classList.remove('closed');
        badge.innerHTML = '<span class="live"></span> Accepting New Students';
        badge.setAttribute('title', 'Enrollment is open for new students');
      }
    });
  }

  // Auto-sync badge on page load if elements exist
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => syncBadge());
    } else {
      syncBadge();
    }
  }

  return { get, set, syncBadge };
})();
