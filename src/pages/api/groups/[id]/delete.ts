import type { APIRoute } from 'astro'
import { createSupabaseServerClient, createSupabaseAdmin } from '../../../../lib/supabase'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const supabase = createSupabaseServerClient(request, cookies)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/signin')

  const groupId = params.id!
  const admin = createSupabaseAdmin()

  // Verify requester is a member
  const { data: membership } = await admin
    .from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .single()

  if (!membership) return redirect('/dashboard')

  await admin.from('groups').delete().eq('id', groupId)
  return redirect('/dashboard')
}
