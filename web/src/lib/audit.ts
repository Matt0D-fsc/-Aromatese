import { createAdminClient } from '@/lib/supabase/admin';

// Who did what, and what went wrong. Both land in audit_logs: the table was built in migration 001 for LLM
// grounding proof and extended in 010 with an actor and a detail blob.
// Writes always go through the service role, never the caller's client, so an actor cannot edit or delete
// their own trail. Nothing here throws: an action must not fail because its audit line did.

type AuditContext = { actorId?: string; tenantId?: string | null; detail?: Record<string, unknown> };

export async function audit(event: string, ctx: AuditContext = {}): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from('audit_logs')
      .insert({ event_type: event, actor_id: ctx.actorId ?? null, tenant_id: ctx.tenantId ?? null, detail: ctx.detail ?? null });
    if (error) console.error('[audit] could not record', event, error);
  } catch (err) {
    console.error('[audit] could not record', event, err);
  }
}

// Failures go to the same trail, so the platform owner reads them in the admin panel instead of a server log
// nobody is watching.
// ponytail: a table, not Sentry — move when error volume outgrows one page of rows.
export async function auditError(event: string, err: unknown, ctx: AuditContext = {}): Promise<void> {
  console.error(`[${event}]`, err);
  await audit(`error.${event}`, {
    ...ctx,
    detail: {
      ...ctx.detail,
      message: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      ...(typeof (err as { status?: number })?.status === 'number' && { status: (err as { status: number }).status }),
    },
  });
}

// Record the failure, then rethrow so the segment's error boundary can offer the user a way out.
export async function throwAudited(event: string, err: unknown, ctx: AuditContext = {}): Promise<never> {
  await auditError(event, err, ctx);
  throw err instanceof Error ? err : new Error(String(err));
}
