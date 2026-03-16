import type { APIRoute } from 'astro'
import { createSupabaseServerClient, createSupabaseAdmin } from '../../../../lib/supabase'

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export const POST: APIRoute = async ({ request, cookies, params }) => {
  const supabase = createSupabaseServerClient(request, cookies)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const groupId = params.id!
  const admin = createSupabaseAdmin()

  // Verify membership
  const { data: membership } = await admin
    .from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .single()
  if (!membership) return new Response('Forbidden', { status: 403 })

  const form = await request.formData()
  const body = form.get('body')?.toString().trim() ?? ''

  if (!body || body.length > 1000) {
    return new Response('<p class="error-msg">Message is required (max 1000 characters).</p>', {
      status: 422,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const { data: message, error } = await admin
    .from('messages')
    .insert({ group_id: groupId, user_id: user.id, body })
    .select('id, body, created_at, user_id, profiles(email)')
    .single()

  if (error || !message) {
    console.error('messages insert error:', error)
    return new Response(`<p class="error-msg">Failed to send message: ${error?.message ?? 'unknown error'}</p>`, {
      status: 422,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const email = (message as any).profiles?.email ?? 'Unknown'
  const date = new Date((message as any).created_at).toLocaleString()
  const isYou = (message as any).user_id === user.id
  const authorLabel = isYou ? 'You' : escHtml(email)

  return new Response(`
    <div class="message-item">
      <div class="message-header">
        <span class="message-author">${authorLabel}</span>
        <span class="message-time">${date}</span>
      </div>
      <p class="message-body">${escHtml(body)}</p>
    </div>
  `, { headers: { 'Content-Type': 'text/html' } })
}
