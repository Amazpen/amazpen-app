-- Per-user access settings (ניהול משתמשים: הרשאות דפים + מיילים אוטומטיים)
-- blocked_pages stores the BLOCKED page keys (see src/lib/access/pages.ts), so a
-- missing row or an empty array = full access. receives_auto_emails = false skips
-- the user as a recipient in every automated email route.
-- Admins (profiles.is_admin) ignore these settings in the app.
-- Only admins may write: a user must never be able to grant themselves access.
-- NOT applied live yet.

CREATE TABLE IF NOT EXISTS public.user_access_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_pages text[] NOT NULL DEFAULT '{}',
  receives_auto_emails boolean NOT NULL DEFAULT true,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.user_access_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_access_settings_select" ON public.user_access_settings;
CREATE POLICY "user_access_settings_select" ON public.user_access_settings
  FOR SELECT USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "user_access_settings_insert" ON public.user_access_settings;
CREATE POLICY "user_access_settings_insert" ON public.user_access_settings
  FOR INSERT WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "user_access_settings_update" ON public.user_access_settings;
CREATE POLICY "user_access_settings_update" ON public.user_access_settings
  FOR UPDATE USING (public.is_admin())
  WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "user_access_settings_delete" ON public.user_access_settings;
CREATE POLICY "user_access_settings_delete" ON public.user_access_settings
  FOR DELETE USING (public.is_admin());
