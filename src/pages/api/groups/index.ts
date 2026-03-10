import type { APIRoute } from 'astro'
import { createSupabaseServerClient, createSupabaseAdmin } from '../../../lib/supabase'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const supabase = createSupabaseServerClient(request, cookies)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/signin')

  const form = await request.formData()
  const name = form.get('name')?.toString().trim() ?? ''
  if (!name) return redirect('/dashboard?error=Group+name+required')

  const admin = createSupabaseAdmin()

  const { data: group, error } = await admin
    .from('groups')
    .insert({ name, created_by: user.id })
    .select()
    .single()

  if (error || !group) return redirect('/dashboard?error=Failed+to+create+group')

  // Ensure profile exists (in case trigger hasn't run yet)
  await admin.from('profiles').upsert({ id: user.id, email: user.email! }, { onConflict: 'id' })

  // Add creator as member
  const { error: memberError } = await admin
    .from('group_members')
    .insert({ group_id: group.id, user_id: user.id })

  if (memberError) {
    await admin.from('groups').delete().eq('id', group.id)
    return redirect(`/dashboard?error=${encodeURIComponent(memberError.message)}`)
  }

  return redirect(`/groups/${group.id}`)
}
