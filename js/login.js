document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('auth-form');
  const submitBtn = document.getElementById('submit-btn');
  const message = document.getElementById('message');
  const switcher = document.getElementById('switcher');
  const fullNameGroup = document.getElementById('full-name-group');
  const modeTitle = document.getElementById('mode-title');
  const modeSub = document.getElementById('mode-sub');

  let isSignUp = false;

  function toggleAuthMode() {
    isSignUp = !isSignUp;
    if (fullNameGroup) fullNameGroup.style.display = isSignUp ? 'block' : 'none';
    if (modeTitle) modeTitle.textContent = isSignUp ? 'Create Account' : 'Welcome Back';
    if (modeSub) {
      modeSub.textContent = isSignUp
        ? 'Register to access your student portal, track lessons, and manage your learning.'
        : 'Sign in to view your scheduled lessons, homework assignments, and study notes.';
    }
    if (submitBtn) submitBtn.textContent = isSignUp ? 'Create Account' : 'Sign In';
    if (switcher) {
      switcher.textContent = isSignUp
        ? 'Already have an account? Sign in'
        : "Don't have an account? Create one";
    }
    if (message) {
      message.textContent = '';
      message.className = 'msg';
    }
  }

  window.toggleAuthMode = toggleAuthMode;
  if (switcher) switcher.addEventListener('click', toggleAuthMode);

  async function routeUserByRole(user) {
    if (!user || !user.id) return;
    let sb = null;
    try { sb = getSupabase(); } catch (e) { sb = null; }
    if (!sb) return;

    try {
      let { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (!profile) {
        // First-time OAuth or unprofiled user: auto-create default profile
        const metaRole = (user.user_metadata && user.user_metadata.role) || 'student';
        const metaName = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || (user.email ? user.email.split('@')[0] : 'Student');
        await sb.from('profiles').upsert({
          id: user.id,
          email: user.email,
          full_name: metaName,
          role: metaRole
        }, { onConflict: 'id' }).catch(() => {});
        profile = { role: metaRole };
      }

      if (profile && profile.role === 'admin') {
        window.location.href = 'admin.html';
      } else if (profile && profile.role === 'tutor') {
        window.location.href = 'dashboard.html';
      } else {
        window.location.href = 'student.html';
      }
    } catch (e) {
      console.warn('Role routing error:', e);
      window.location.href = 'student.html';
    }
  }

  // Check for active session or OAuth redirect return
  (async function checkExistingSession() {
    let sb = null;
    try { sb = getSupabase(); } catch (e) { sb = null; }
    if (!sb) return;

    try {
      const { data: { session } } = await sb.auth.getSession();
      if (session && session.user) {
        if (message) {
          message.className = 'msg ok';
          message.textContent = 'Authenticated! Redirecting...';
        }
        await routeUserByRole(session.user);
      }

      // Also listen for auth changes (such as OAuth hash token parsing)
      sb.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session && session.user) {
          if (message) {
            message.className = 'msg ok';
            message.textContent = 'Authenticated! Redirecting...';
          }
          await routeUserByRole(session.user);
        }
      });
    } catch (e) {
      console.warn('Session verification check:', e);
    }
  })();

  window.continueWithGoogle = async function () {
    const message = document.getElementById('message');
    let sb = null;
    try { sb = getSupabase(); } catch (e) { sb = null; }
    if (!sb) {
      if (message) { message.className = 'msg err'; message.textContent = 'Sign-in service unavailable. Please reload.'; }
      return;
    }
    const googleBtn = document.getElementById('google-btn');
    if (googleBtn) { googleBtn.disabled = true; googleBtn.style.opacity = '.6'; }
    try {
      const redirectUri = window.location.origin + window.location.pathname;
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUri }
      });
      if (error && message) {
        message.className = 'msg err';
        message.textContent = error.message || 'Google sign-in failed.';
      }
    } catch (err) {
      if (message) {
        message.className = 'msg err';
        message.textContent = (err && err.message) || 'Google sign-in encountered an error.';
      }
    } finally {
      if (googleBtn) { googleBtn.disabled = false; googleBtn.style.opacity = '1'; }
    }
  };

  const googleBtn = document.getElementById('google-btn');
  if (googleBtn) googleBtn.addEventListener('click', continueWithGoogle);

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const fullName = (document.getElementById('full_name') ? document.getElementById('full_name').value.trim() : '');
      const role = 'student';

      submitBtn.disabled = true;
      submitBtn.textContent = isSignUp ? 'Creating...' : 'Signing in...';
      message.textContent = '';
      message.className = 'msg';

      let sb = null;
      try {
        sb = getSupabase();
      } catch (e) {
        console.error('Supabase init error:', e);
        sb = null;
      }
      if (!sb) {
        message.className = 'msg err';
        message.textContent = 'Sign-in service is unavailable (Supabase could not initialize). Check your connection and reload.';
        submitBtn.disabled = false;
        submitBtn.textContent = isSignUp ? 'Create Account' : 'Sign In';
        return;
      }

      try {
        if (isSignUp) {
          const { data, error } = await sb.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: fullName, role }
            }
          });

          if (error) {
            if (error.status === 429) {
              message.className = 'msg err';
              message.textContent = 'Too many sign-up attempts. Please wait a minute and try again.';
            } else {
              message.className = 'msg err';
              message.textContent = error.message || `Sign-up failed: ${error.status || 'unknown error'}`;
            }
            return;
          }

          message.className = 'msg ok';
          message.textContent = 'Account created! Check your email to confirm, then sign in.';

          if (data && data.user && data.user.id) {
            try {
              await sb.from('profiles').upsert({
                id: data.user.id,
                email,
                full_name: fullName,
                role
              }, { onConflict: 'id' });
            } catch (profileErr) {
              console.warn('Profile upsert failed (non-fatal):', profileErr);
              message.textContent = 'Account created! Your profile will finish syncing on first sign-in.';
            }
          }
        } else {
          const { data: authData, error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
          const user = (authData && authData.user) || (await sb.auth.getUser()).data.user;
          await routeUserByRole(user);
        }
      } catch (err) {
        message.className = 'msg err';
        message.textContent = (err && err.message) ? err.message : 'An error occurred. Please try again.';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isSignUp ? 'Create Account' : 'Sign In';
      }
    });
  }
});
