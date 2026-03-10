import type { APIRoute } from 'astro'
import { createSupabaseServerClient, createSupabaseAdmin } from '../../../../lib/supabase'

export const POST: APIRoute = async ({ request, cookies, params, redirect }) => {
  const supabase = createSupabaseServerClient(request, cookies)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return redirect('/signin')

  const expenseId = params.expenseId!
  const admin = createSupabaseAdmin()

  // Find the expense and verify the user is a member of its group
  const { data: expense } = await admin
    .from('expenses')
    .select('group_id')
    .eq('id', expenseId)
    .single()

  if (!expense) return redirect('/dashboard')

  const { data: membership } = await admin
    .from('group_members')
    .select('id')
    .eq('group_id', expense.group_id)
    .eq('user_id', user.id)
    .single()

  if (!membership) return redirect('/dashboard')

  await admin.from('expenses').delete().eq('id', expenseId)
  return redirect(`/groups/${expense.group_id}`)
}
