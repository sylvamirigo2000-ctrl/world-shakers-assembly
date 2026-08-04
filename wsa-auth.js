/* ============================================================
   wsa-auth.js — World Shakers Assembly shared auth/permission layer
   ============================================================
   Include this AFTER the supabase-js script tag on every protected
   page. It replaces one-off checks like:

     const { data: profile } = await supabaseClient
       .from('members').select('role').eq('id', session.user.id).single();
     if (profile.role !== 'admin') { ...deny... }

   with a single reusable object: WSA.

   USAGE (typical protected page):

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
     <script src="wsa-auth.js"></script>
     <script>
       const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
       document.addEventListener('DOMContentLoaded', async () => {
         const ok = await WSA.init(supabaseClient, { require: 'view_reports' });
         if (!ok) return; // WSA.init already redirected / showed denial
         // ...render page using WSA.member, WSA.role, WSA.can('export_reports')
       });
     </script>
   ============================================================ */

const WSA = {
  supabase: null,
  session: null,
  member: null,          // full row from public.members
  role: null,             // { role_key, role_label, rank, is_leadership, status }
  permissions: new Set(), // Set<string> of permission keys

  /**
   * Loads session + role + permissions. Redirects to login.html if
   * unauthenticated. If `require` is passed and the user lacks that
   * permission, calls onDenied (default: shows a generic denial and
   * returns false) instead of throwing.
   *
   * @param {object} supabaseClient
   * @param {object} [opts]
   * @param {string|string[]} [opts.require]  permission key(s) needed for this page (ANY match passes)
   * @param {string} [opts.redirectTo='login.html']
   * @param {function} [opts.onDenied]  called with (WSA) if the permission check fails
   * @returns {Promise<boolean>} true if the caller should proceed rendering the page
   */
  async init(supabaseClient, opts = {}) {
    this.supabase = supabaseClient;
    const { require, redirectTo = 'login.html', onDenied } = opts;

    const { data: { session } } = await this.supabase.auth.getSession();
    if (!session) {
      window.location.href = redirectTo;
      return false;
    }
    this.session = session;

    const [{ data: member, error: memberErr }, { data: roleRow }, { data: perms }] = await Promise.all([
      this.supabase.from('members').select('*').eq('id', session.user.id).single(),
      this.supabase.rpc('get_my_role').single(),
      this.supabase.rpc('get_my_permissions'),
    ]);

    if (memberErr || !member) {
      console.error('WSA.init: could not load member profile', memberErr);
      window.location.href = redirectTo;
      return false;
    }

    this.member = member;
    this.role = roleRow || null;
    this.permissions = new Set((perms || []).map(p => p.permission_key));

    if (this.role && this.role.status === 'suspended') {
      this._deny(onDenied, 'Your account has been suspended. Contact your General Overseer.');
      return false;
    }

    if (require) {
      const needed = Array.isArray(require) ? require : [require];
      const ok = needed.some(p => this.can(p));
      if (!ok) {
        this._deny(onDenied, "Your account doesn't have access to this page.");
        return false;
      }
    }

    return true;
  },

  can(permission) {
    return this.permissions.has(permission);
  },

  canAny(permissionList) {
    return permissionList.some(p => this.can(p));
  },

  canAll(permissionList) {
    return permissionList.every(p => this.can(p));
  },

  isRole(roleKey) {
    return this.role && this.role.role_key === roleKey;
  },

  // "at least as senior as" — lower rank number = more senior.
  isAtLeastRank(rank) {
    return this.role && this.role.rank <= rank;
  },

  isSuperAdmin() {
    return this.isRole('general_overseer');
  },

  /** Fire-and-forget audit log entry. Never blocks the UI on failure. */
  async log(action, entityType = null, entityId = null, details = {}) {
    try {
      await this.supabase.rpc('log_action', {
        p_action: action,
        p_entity_type: entityType,
        p_entity_id: entityId ? String(entityId) : null,
        p_details: details,
      });
    } catch (err) {
      console.warn('WSA.log failed (non-fatal):', err);
    }
  },

  _deny(onDenied, message) {
    if (typeof onDenied === 'function') {
      onDenied(this, message);
      return;
    }
    document.body.innerHTML = `
      <div style="max-width:480px;margin:80px auto;padding:32px;text-align:center;
                  font-family:sans-serif;border:1px solid rgba(0,0,0,0.1);border-radius:14px;">
        <h2 style="margin-bottom:12px;">Access denied</h2>
        <p style="color:#666;">${message}</p>
        <a href="dashboard.html" style="display:inline-block;margin-top:20px;">← Back to dashboard</a>
      </div>`;
  },
};
