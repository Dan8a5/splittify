import type { APIRoute } from 'astro'
import { createSupabaseServerClient, createSupabaseAdmin } from '../../../../lib/supabase'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const supabase = createSupabaseServerClient(request, cookies)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/signin')

  const groupId = params.id!
  const admin = createSupabaseAdmin()

  const form = await request.formData()
  const archived = form.get('archived') === 'true'

  await admin.from('groups').update({ archived }).eq('id', groupId)
  return redirect('/dashboard')
}
