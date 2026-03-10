import type { APIRoute } from 'astro'
import { createSupabaseServerClient, createSupabaseAdmin } from '../../../../lib/supabase'

export const POST: APIRoute = async ({ request, cookies, params }) => {
  const supabase = createSupabaseServerClient(request, cookies)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const groupId = params.id!
  const admin = createSupabaseAdmin()

  // Verify requester is a member
  const { data: membership } = await admin
    .from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .single()

  if (!membership) return new Response('Forbidden', { status: 403 })

  const form = await request.formData()
  const email = form.get('email')?.toString().trim().toLowerCase() ?? ''

  // Find the user by email
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', email)
    .single()

  if (!profile) {
    return new Response(`<p class="error-msg">No user found with email: ${email}</p>`, {
      headers: { 'Content-Type': 'text/html' },
    })
  }

  // Check if already a member
  const { data: existing } = await admin
    .from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', profile.id)
    .single()

  if (existing) {
    return new Response(`<p class="error-msg">That person is already a member.</p>`, {
      headers: { 'Content-Type': 'text/html' },
    })
  }

  await admin.from('group_members').insert({ group_id: groupId, user_id: profile.id })

  // Return updated members list HTML
  const { data: members } = await admin
    .from('group_members')
    .select('profiles(id, email)')
    .eq('group_id', groupId)

  const membersHtml = (members ?? []).map((m: any) => {
    const p = m.profiles
    return `<span class="member-chip">${p.email}</span>`
  }).join('')

  return new Response(`
    <div id="members-list">${membersHtml}</div>
    <p style="color:var(--green-amount);font-size:0.85rem;margin-top:0.5rem;">${email} added!</p>
  `, { headers: { 'Content-Type': 'text/html' } })
}
