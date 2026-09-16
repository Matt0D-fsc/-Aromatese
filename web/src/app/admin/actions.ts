'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { clearAiSettingsCache, getAiSettings } from '@/lib/ai-settings';
import { anthropicGenerateContent } from '@/lib/anthropic-compatible';
import { customGenerateContent } from '@/lib/openai-compatible';
import { createAdminClient } from '@/lib/supabase/admin';
import { siteUrl } from '@/lib/site';

export type InviteState = { error?: string; message?: string };

export async function inviteMerchant(_prev: InviteState, formData: FormData): Promise<InviteState> {
  await requireAdmin();

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

  revalidatePath('/admin');
  return { message: `Invite sent to ${email}.` };
}

export async function setTenantStatus(tenantId: string, status: 'active' | 'suspended') {
  await requireAdmin();
  if (status !== 'active' && status !== 'suspended') throw new Error('Invalid status');
  const { error } = await createAdminClient().from('tenants').update({ status }).eq('id', tenantId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin');
}

export async function updateMessageLimit(tenantId: string, formData: FormData) {
  await requireAdmin();
  const limit = Number(formData.get('limit'));
  if (!Number.isInteger(limit) || limit < 0) throw new Error('Message limit must be a whole number.');
  const { error } = await createAdminClient().from('tenants').update({ monthly_message_limit: limit }).eq('id', tenantId);
  if (error) throw new Error(error.message);
  revalidatePath('/admin');
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
  revalidatePath('/admin');
  return { message: form.provider === 'custom' ? `Every shop now uses the in-house AI (${form.model}).` : 'Every shop now uses Gemini from .env.' };
}

export async function clearAiEngineKey(): Promise<void> {
  const { user } = await requireAdmin();
  const { error } = await createAdminClient()
    .from('platform_settings')
    .update({ custom_api_key: null, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq('id', true);
  if (error) throw new Error(error.message);
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
