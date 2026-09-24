-- Admin account management: add a non-privileged staff role and audit account lifecycle actions.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'staff';

CREATE TABLE IF NOT EXISTS public.account_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('create','suspend','reactivate','reset_password','role_change')),
  role text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_admin_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_admin_audit FROM anon, authenticated;
GRANT ALL ON TABLE public.account_admin_audit TO service_role;

CREATE INDEX IF NOT EXISTS account_admin_audit_target_idx
  ON public.account_admin_audit(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS account_admin_audit_actor_idx
  ON public.account_admin_audit(actor_id, created_at DESC);
