'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { audit, throwAudited } from '@/lib/audit';
import { CHAT_MEDIA_BUCKET } from '@/lib/chat';
import { clearAiSettingsCache, getAiSettings } from '@/lib/ai-settings';
import { anthropicGenerateContent } from '@/lib/anthropic-compatible';
import { customGenerateContent } from '@/lib/openai-compatible';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/site';
import { PLANS, type Plan } from '@/lib/plans';

export type InviteState = { error?: string; message?: string };

export async function inviteMerchant(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const { user: admin_user } = await requireAdmin();

  const shopName = String(formData.get('shopName') ?? '').trim();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const limit = Number(formData.get('limit') ?? 1000);
  if (!shopName || shopName.length > 255) return { error: 'Shop name is required (max 255 characters).' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email.' };
  if (!Number.isInteger(limit) || limit < 0) return { error: 'Message limit must be a whole number.' };

  const admin = createAdminClient();
  const base = shopName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'shop';
  const slug = `${base}-${crypto.randomUUID().slice(0, 6)}`;

  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .insert({ name: shopName, slug, contact_email: email, monthly_message_limit: limit, status: 'invited' })
    .select('id')
    .single();
  if (tenantError) return { error: tenantError.message };

  const { data: invite, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${await siteUrl()}/auth/set-password`,
  });
  if (inviteError || !invite.user) {
    await admin.from('tenants').delete().eq('id', tenant.id);
    return { error: inviteError?.message ?? 'Invite failed.' };
  }

  const { error: memberError } = await admin
    .from('tenant_members')
    .insert({ tenant_id: tenant.id, user_id: invite.user.id, role: 'owner' });
  if (memberError) {
    await admin.auth.admin.deleteUser(invite.user.id);
    await admin.from('tenants').delete().eq('id', tenant.id);
    return { error: memberError.message };
  }

  await audit('merchant.invited', { actorId: admin_user.id, tenantId: tenant.id, detail: { email, shopName, limit } });
  revalidatePath('/admin');
  return { message: `Invite sent to ${email}.` };
}

export async function setTenantStatus(tenantId: string, status: 'active' | 'suspended') {
  const { user } = await requireAdmin();
  if (status !== 'active' && status !== 'suspended') throw new Error('Invalid status');
  const { error } = await createAdminClient().from('tenants').update({ status }).eq('id', tenantId);
  if (error) await throwAudited('merchant.status', error, { actorId: user.id, tenantId, detail: { status } });
  await audit(`merchant.${status === 'active' ? 'reactivated' : 'suspended'}`, { actorId: user.id, tenantId });
  revalidatePath('/admin');
}

// The chat route reads tenants.ai_enabled on every message; until now nothing could set it, so pausing one
// shop's AI meant suspending the whole shop.
export async function setAiEnabled(tenantId: string, enabled: boolean) {
  const { user } = await requireAdmin();
  const { error } = await createAdminClient().from('tenants').update({ ai_enabled: enabled }).eq('id', tenantId);
  if (error) await throwAudited('merchant.ai_enabled', error, { actorId: user.id, tenantId, detail: { enabled } });
  await audit(`merchant.ai_${enabled ? 'resumed' : 'paused'}`, { actorId: user.id, tenantId });
  revalidatePath('/admin');
}

export async function updateMessageLimit(tenantId: string, formData: FormData) {
  const { user } = await requireAdmin();
  const limit = Number(formData.get('limit'));
  if (!Number.isInteger(limit) || limit < 0) throw new Error('Message limit must be a whole number.');
  const { error } = await createAdminClient().from('tenants').update({ monthly_message_limit: limit }).eq('id', tenantId);
  if (error) await throwAudited('merchant.limit', error, { actorId: user.id, tenantId, detail: { limit } });
  await audit('merchant.limit_changed', { actorId: user.id, tenantId, detail: { limit } });
  revalidatePath('/admin');
}

export type PurgeState = { error?: string; message?: string };

// Retention, run by hand from the admin panel. purge_old_chats deletes the rows and hands back the storage
// paths it orphaned; only the API can empty the bucket.
// ponytail: a button, not a schedule — enable pg_cron and call the same function when this needs to be automatic.
export async function purgeOldChats(_prev: PurgeState, formData: FormData): Promise<PurgeState> {
  const { user } = await requireAdmin();
  const days = Number(formData.get('days'));
  if (!Number.isInteger(days) || days < 7) return { error: 'Keep at least 7 days of chat history.' };

  const admin = createAdminClient();
  const { data: paths, error } = await admin.rpc('purge_old_chats', { days });
  if (error) return { error: error.message };

  const files = ((paths ?? []) as string[]).filter(Boolean);
  if (files.length) await admin.storage.from(CHAT_MEDIA_BUCKET).remove(files);

  await audit('platform.chats_purged', { actorId: user.id, detail: { days, mediaDeleted: files.length } });
  revalidatePath('/admin');
  return { message: `Deleted chats older than ${days} days, with ${files.length} stored file${files.length === 1 ? '' : 's'}.` };
}

export type AiEngineState = { error?: string; message?: string };

function readEngineForm(formData: FormData) {
  return {
    provider: formData.get('provider') === 'custom' ? ('custom' as const) : ('gemini' as const),
    apiFormat: formData.get('apiFormat') === 'anthropic' ? ('anthropic' as const) : ('openai' as const),
    baseUrl: String(formData.get('baseUrl') ?? '').trim(),
    model: String(formData.get('model') ?? '').trim(),
    apiKey: String(formData.get('apiKey') ?? '').trim(),
  };
}

const isHttpUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

export async function saveAiEngine(_prev: AiEngineState, formData: FormData): Promise<AiEngineState> {
  const { user } = await requireAdmin();
  const form = readEngineForm(formData);
  if (form.baseUrl && !isHttpUrl(form.baseUrl)) return { error: 'Base URL must start with http:// or https://' };
  if (form.provider === 'custom' && (!form.baseUrl || !form.model)) {
    return { error: 'Add the base URL and model name before switching to the in-house AI.' };
  }

  const { error } = await createAdminClient()
    .from('platform_settings')
    .upsert({
      id: true,
      ai_provider: form.provider,
      custom_api_format: form.apiFormat,
      custom_base_url: form.baseUrl || null,
      custom_model: form.model || null,
      ...(form.apiKey && { custom_api_key: form.apiKey }), // blank keeps the saved key
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    });
  if (error) return { error: error.message };

  clearAiSettingsCache();
  // The key itself is never recorded, only that the engine changed and to what.
  await audit('platform.ai_engine', { actorId: user.id, detail: { provider: form.provider, apiFormat: form.apiFormat, model: form.model, baseUrl: form.baseUrl } });
  revalidatePath('/admin');
  return { message: form.provider === 'custom' ? `Every shop now uses the in-house AI (${form.model}).` : 'Every shop now uses Gemini from .env.' };
}

export async function clearAiEngineKey(): Promise<void> {
  const { user } = await requireAdmin();
  const { error } = await createAdminClient()
    .from('platform_settings')
    .update({ custom_api_key: null, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq('id', true);
  if (error) await throwAudited('platform.ai_key_cleared', error, { actorId: user.id });
  await audit('platform.ai_key_cleared', { actorId: user.id });
  clearAiSettingsCache();
  revalidatePath('/admin');
}

// Checks the values in the form (saved or not): can we reach the endpoint, and does the model return tool calls?
// The sales agent needs tool calling to search products and take orders.
export async function testAiEngine(_prev: AiEngineState, formData: FormData): Promise<AiEngineState> {
  await requireAdmin();
  const form = readEngineForm(formData);
  if (!isHttpUrl(form.baseUrl) || !form.model) return { error: 'Enter the base URL and model name to test.' };

  const endpoint = { baseUrl: form.baseUrl, model: form.model, apiKey: form.apiKey || (await getAiSettings()).apiKey };
  const started = Date.now();
  const generate = form.apiFormat === 'anthropic' ? anthropicGenerateContent : customGenerateContent;
  try {
    const res = await generate(
      {
        model: form.model,
        contents: 'Check the connection by calling the ping tool with message "hello".',
        config: {
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'ping',
                  description: 'Connectivity check',
                  parametersJsonSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
                },
              ],
            },
          ],
        },
      },
      endpoint,
    );
    const toolCalling = res.functionCalls?.length
      ? 'tool calling works ✓'
      : 'the model answered but made no tool call, so the sales agent will not be able to search products or take orders';
    return { message: `Connected in ${Date.now() - started} ms: ${toolCalling}.` };
  } catch (err) {
    // A 404 almost always means the server speaks the other API format.
    const hint =
      (err as { status?: number })?.status === 404
        ? ` The server has no ${form.apiFormat === 'anthropic' ? '/v1/messages' : '/chat/completions'} route: try the other API format.`
        : '';
    return { error: `Could not use the in-house AI: ${(err as Error).message}${hint}` };
  }
}

// What a shop pays. The AI cost to serve them is worked out from their token usage and the rate below, so the
// platform owner can see the margin per shop instead of one bill at the end of the month.
export async function updatePlan(tenantId: string, formData: FormData) {
  const { user } = await requireAdmin();
  const plan = String(formData.get('plan') ?? '');
  const price = Number(formData.get('price'));
  if (!PLANS.includes(plan as Plan)) throw new Error('Unknown plan.');
  if (!Number.isFinite(price) || price < 0) throw new Error('Price must be 0 or more.');

  const { error } = await createAdminClient().from('tenants').update({ plan, plan_price_bdt: price }).eq('id', tenantId);
  if (error) await throwAudited('merchant.plan', error, { actorId: user.id, tenantId, detail: { plan, price } });
  await audit('merchant.plan_changed', { actorId: user.id, tenantId, detail: { plan, price } });
  revalidatePath('/admin');
}

// One rate for every shop: what a million AI tokens costs in taka. Left at 0 the admin panel simply shows no
// cost, which is honest, rather than a made-up number.
export async function setTokenRate(formData: FormData) {
  const { user } = await requireAdmin();
  const rate = Number(formData.get('rate'));
  if (!Number.isFinite(rate) || rate < 0) throw new Error('Rate must be 0 or more.');

  const { error } = await createAdminClient()
    .from('platform_settings')
    .upsert({ id: true, taka_per_million_tokens: rate, updated_at: new Date().toISOString(), updated_by: user.id });
  if (error) await throwAudited('platform.token_rate', error, { actorId: user.id, detail: { rate } });
  await audit('platform.token_rate_changed', { actorId: user.id, detail: { rate } });
  revalidatePath('/admin');
}

export type InviteLinkState = { error?: string; link?: string; email?: string };

// A one-time link the admin can copy and send over WhatsApp. Bangladeshi merchants are reachable there far
// more reliably than by email, and this removes the dependency on SMTP for onboarding entirely.
// It doubles as the resend: the same call works whether the first email never arrived, the link expired, or
// the merchant forgot their password — they always land on /auth/set-password and choose their own.
export async function createInviteLink(tenantId: string): Promise<InviteLinkState> {
  const { user } = await requireAdmin();
  const admin = createAdminClient();

  const { data: member } = await admin.from('tenant_members').select('user_id').eq('tenant_id', tenantId).eq('role', 'owner').maybeSingle();
  if (!member) return { error: 'This shop has no owner account yet.' };

  const { data: profile } = await admin.from('profiles').select('email').eq('id', member.user_id).maybeSingle();
  if (!profile?.email) return { error: 'That owner has no email on file.' };

  // "recovery" rather than "invite": the account already exists, and recovery works whether or not they have
  // ever set a password. generateLink returns the URL without sending anything.
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: profile.email,
    options: { redirectTo: `${await siteUrl()}/auth/set-password` },
  });
  if (error || !data.properties?.action_link) return { error: error?.message ?? 'Could not create a link.' };

  await audit('merchant.invite_link_created', { actorId: user.id, tenantId, detail: { email: profile.email } });
  return { link: data.properties.action_link, email: profile.email };
}

// Undo an invite that went nowhere. Guarded hard: only a shop whose owner never signed in and that holds no
// products, conversations or orders, so this can never be a shortcut to deleting a working merchant.
export async function revokeInvite(tenantId: string): Promise<{ error?: string; message?: string }> {
  const { user } = await requireAdmin();
  const admin = createAdminClient();

  const { data: member } = await admin.from('tenant_members').select('user_id').eq('tenant_id', tenantId).maybeSingle();
  if (!member) return { error: 'This shop has no account to revoke.' };

  const { data: signins } = await admin.rpc('merchant_signin_status');
  const signedIn = ((signins ?? []) as { user_id: string; last_sign_in_at: string | null }[]).find((s) => s.user_id === member.user_id);
  if (signedIn?.last_sign_in_at) return { error: 'They have already signed in. Suspend the shop instead of revoking the invite.' };

  for (const table of ['products', 'conversations', 'orders'] as const) {
    const { count } = await admin.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
    if (count) return { error: `This shop already has ${count} ${table}. Suspend it instead of revoking the invite.` };
  }

  const { error: memberError } = await admin.from('tenant_members').delete().eq('tenant_id', tenantId);
  if (memberError) return { error: memberError.message };
  await admin.auth.admin.deleteUser(member.user_id);
  const { error: tenantError } = await admin.from('tenants').delete().eq('id', tenantId);
  if (tenantError) return { error: tenantError.message };

  await audit('merchant.invite_revoked', { actorId: user.id, detail: { tenantId } });
  revalidatePath('/admin');
  return { message: 'Invite revoked. The shop and its unused account are gone.' };
}
