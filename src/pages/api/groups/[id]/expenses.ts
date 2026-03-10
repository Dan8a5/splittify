import type { APIRoute } from 'astro'
import { createSupabaseServerClient, createSupabaseAdmin } from '../../../../lib/supabase'
import { calculateSplits, calculateBalances, centsToDisplay } from '../../../../lib/balance'

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
  const description = form.get('description')?.toString().trim() ?? ''
  const amountStr = form.get('amount')?.toString() ?? '0'
  const paidBy = form.get('paid_by')?.toString() ?? user.id
  const splitIds = form.getAll('split_with').map(v => v.toString())

  if (!description || !amountStr || splitIds.length === 0) {
    return new Response('<div id="expense-form-error"><p class="error-msg">All fields required and at least one person to split with.</p></div><div id="expenses-list"></div>', {
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const amountCents = Math.round(parseFloat(amountStr) * 100)
  if (isNaN(amountCents) || amountCents <= 0) {
    return new Response('<div id="expense-form-error"><p class="error-msg">Invalid amount.</p></div><div id="expenses-list"></div>', {
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const { data: expense, error: expErr } = await admin
    .from('expenses')
    .insert({ group_id: groupId, paid_by: paidBy, amount_cents: amountCents, description })
    .select()
    .single()

  if (expErr || !expense) {
    return new Response('<div id="expense-form-error"><p class="error-msg">Failed to add expense.</p></div><div id="expenses-list"></div>', {
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const splits = calculateSplits(amountCents, splitIds)
  await admin.from('expense_splits').insert(
    splits.map(s => ({ expense_id: expense.id, user_id: s.user_id, amount_cents: s.amount_cents }))
  )

  // Return updated expenses list + balances
  const { data: allExpenses } = await admin
    .from('expenses')
    .select('id, description, amount_cents, paid_by, created_at, profiles(email)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })

  const { data: allSplits } = await admin
    .from('expense_splits')
    .select('expense_id, user_id, amount_cents')
    .in('expense_id', (allExpenses ?? []).map((e: any) => e.id))

  const { data: members } = await admin
    .from('group_members')
    .select('user_id, profiles(email)')
    .eq('group_id', groupId)

  const balances = calculateBalances(allExpenses ?? [], allSplits ?? [])
  const totalCents = (allExpenses ?? []).reduce((sum: number, e: any) => sum + e.amount_cents, 0)

  const trashIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`

  const expensesHtml = (allExpenses ?? []).map((e: any) => {
    const paidByEmail = e.profiles?.email ?? 'Unknown'
    const date = new Date(e.created_at).toLocaleDateString()
    return `
      <div class="expense-item">
        <div>
          <div class="expense-desc">${e.description}</div>
          <div class="expense-meta">Paid by ${paidByEmail} · ${date}</div>
        </div>
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <div class="expense-amount">$${centsToDisplay(e.amount_cents)}</div>
          <form method="POST" action="/api/expenses/${e.id}/delete" style="margin:0;">
            <button type="submit" class="btn-trash" title="Delete expense" onclick="event.preventDefault();if(confirm('Delete this expense?'))this.closest('form').submit()">${trashIcon}</button>
          </form>
        </div>
      </div>`
  }).join('')

  const balancesHtml = (members ?? []).map((m: any) => {
    const uid = m.user_id
    const email = m.profiles?.email ?? 'Unknown'
    const net = balances[uid] ?? 0
    const isCurrentUser = uid === user.id
    const label = isCurrentUser ? 'You' : email
    if (net === 0) return `<div class="balance-item"><span>${label}</span><span class="amount-settled">settled</span></div>`
    if (net > 0) return `<div class="balance-item"><span>${label}</span><span class="amount-owed">+$${centsToDisplay(net)}</span></div>`
    return `<div class="balance-item"><span>${label}</span><span class="amount-owe">-$${centsToDisplay(net)}</span></div>`
  }).join('')

  return new Response(`
    <div id="expense-form-error"></div>
    <div id="expenses-list">${expensesHtml || '<p style="color:var(--text-muted);font-size:0.85rem;">No expenses yet.</p>'}</div>
    <div id="balances-section" hx-swap-oob="innerHTML">
      ${balancesHtml}
    </div>
    <span id="group-total" hx-swap-oob="outerHTML">Total spent: <strong>$${centsToDisplay(totalCents)}</strong></span>
  `, { headers: { 'Content-Type': 'text/html' } })
}
