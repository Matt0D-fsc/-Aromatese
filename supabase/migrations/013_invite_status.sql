-- Migration: 013_invite_status.sql
-- Description: Let the platform admin see where a merchant got stuck. Until now the admin panel could show
-- "setup not finished" but not the difference between never opening the invite and abandoning the form,
-- because the sign-in timestamp lives in auth.users, which PostgREST does not expose.
-- SECURITY DEFINER to read auth.users, with the admin check inside the body so a non-admin caller gets
-- an empty set rather than a permissions error they could probe.
CREATE OR REPLACE FUNCTION merchant_signin_status()
RETURNS TABLE (user_id UUID, last_sign_in_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT u.id, u.last_sign_in_at
  FROM auth.users u
  WHERE is_platform_admin();
$$;
REVOKE EXECUTE ON FUNCTION merchant_signin_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION merchant_signin_status() TO authenticated;
