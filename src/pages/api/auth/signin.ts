import type { APIRoute } from 'astro'
import { createSupabaseServerClient } from '../../../lib/supabase'

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData()
  const email = form.get('email')?.toString().trim() ?? ''
  const password = form.get('password')?.toString() ?? ''

  if (!email || !password) return redirect('/signin?error=Missing+fields')

  const supabase = createSupabaseServerClient(request, cookies)
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return redirect(`/signin?error=${encodeURIComponent(error.message)}`)
  return redirect('/dashboard')
}
