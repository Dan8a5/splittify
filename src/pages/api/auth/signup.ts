import type { APIRoute } from 'astro'
import { createSupabaseServerClient, createSupabaseAdmin } from '../../../lib/supabase'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData()
  const email = form.get('email')?.toString().trim() ?? ''
  const password = form.get('password')?.toString() ?? ''

  if (!email || !password) return redirect('/signup?error=Missing+fields')

  const supabase = createSupabaseServerClient(request, cookies)
  const { data, error } = await supabase.auth.signUp({ email, password })

  if (error) return redirect(`/signup?error=${encodeURIComponent(error.message)}`)

  // Create profile row
  if (data.user) {
    const admin = createSupabaseAdmin()
    await admin.from('profiles').upsert({ id: data.user.id, email }, { onConflict: 'id' })
  }

  return redirect('/dashboard')
}
