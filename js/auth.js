/**
 * auth.js — Role-based route guards
 * Admin identity is stored ONLY in Supabase (profiles.role = 'admin').
 * No email addresses or passwords are stored here.
 */

async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  return user;
}

async function requireTutor() {
  const user = await requireAuth();
  if (!user) return null;
  const profile = await getUserProfile(user.id);
  if (!profile || profile.role !== 'tutor') {
    window.location.href = 'student.html';
    return null;
  }
  return { user, profile };
}

async function requireStudent() {
  const user = await requireAuth();
  if (!user) return null;
  const profile = await getUserProfile(user.id);
  return { user, profile };
}

/**
 * requireAdmin — Only profiles with role='admin' (set in Supabase) are allowed.
 * No email addresses are hardcoded here; identity is verified server-side.
 * Non-admin users are silently redirected without exposing any admin details.
 */
async function requireAdmin() {
  const user = await requireAuth();
  if (!user) return null;

  const profile = await getUserProfile(user.id);

  // Role is set exclusively in Supabase profiles table — no credential check in code
  if (!profile || profile.role !== 'admin') {
    // Redirect silently — do not reveal that an admin page exists
    if (profile && profile.role === 'tutor') {
      window.location.href = 'dashboard.html';
    } else {
      window.location.href = 'student.html';
    }
    return null;
  }

  return { user, profile };
}
