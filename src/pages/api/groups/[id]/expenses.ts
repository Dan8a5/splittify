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

  // Fetch group members early (needed for validation + response)
  const { data: members } = await admin
    .from('group_members')
    .select('user_id, profiles(email)')
    .eq('group_id', groupId)

  const memberIds = new Set((members ?? []).map((m: any) => m.user_id))

  const form = await request.formData()
  const description = form.get('description')?.toString().trim() ?? ''
  const amountStr = form.get('amount')?.toString() ?? '0'
  const paidBy = form.get('paid_by')?.toString() ?? user.id
  const splitIds = form.getAll('split_with').map(v => v.toString())

  if (!description || !amountStr || splitIds.length === 0) {
    return new Response('<p class="error-msg">All fields required and at least one person to split with.</p>', {
      status: 422,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const amountCents = Math.round(parseFloat(amountStr) * 100)
  if (isNaN(amountCents) || amountCents <= 0) {
    return new Response('<p class="error-msg">Invalid amount.</p>', {
      status: 422,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  if (!memberIds.has(paidBy)) {
    return new Response('<p class="error-msg">Invalid paid_by user.</p>', {
      status: 422,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  if (splitIds.some(id => !memberIds.has(id))) {
    return new Response('<p class="error-msg">Invalid split_with users.</p>', {
      status: 422,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const { data: expense, error: expErr } = await admin
    .from('expenses')
    .insert({ group_id: groupId, paid_by: paidBy, amount_cents: amountCents, description })
    .select()
    .single()

  if (expErr || !expense) {
    return new Response('<p class="error-msg">Failed to add expense.</p>', {
      status: 422,
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

  const balances = calculateBalances(allExpenses ?? [], allSplits ?? [])
  const totalCents = (allExpenses ?? []).reduce((sum: number, e: any) => sum + e.amount_cents, 0)

  // Precompute per-user paid/share totals in one pass
  const paidByUser: Record<string, number> = {}
  for (const e of allExpenses ?? []) {
    paidByUser[(e as any).paid_by] = (paidByUser[(e as any).paid_by] ?? 0) + (e as any).amount_cents
  }
  const shareByUser: Record<string, number> = {}
  for (const s of allSplits ?? []) {
    shareByUser[(s as any).user_id] = (shareByUser[(s as any).user_id] ?? 0) + (s as any).amount_cents
  }

  // Map expense_id -> split member IDs for pencil button data
  const splitsByExpense: Record<string, string[]> = {}
  for (const s of allSplits ?? []) {
    const expId = (s as any).expense_id
    if (!splitsByExpense[expId]) splitsByExpense[expId] = []
    splitsByExpense[expId].push((s as any).user_id)
  }

  const pencilIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`
  const trashIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>`

  function escAttr(s: string) {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  const expensesHtml = (allExpenses ?? []).map((e: any) => {
    const paidByEmail = e.profiles?.email ?? 'Unknown'
    const date = new Date(e.created_at).toLocaleDateString()
    const amountDisplay = (e.amount_cents / 100).toFixed(2)
    const splitWith = escAttr(JSON.stringify(splitsByExpense[e.id] ?? []))
    return `
      <div class="expense-item">
        <div>
          <div class="expense-desc">${escAttr(e.description)}</div>
          <div class="expense-meta">Paid by ${escAttr(paidByEmail)} · ${date}</div>
        </div>
        <div class="expense-actions">
          <div class="expense-amount">$${centsToDisplay(e.amount_cents)}</div>
          <button type="button" class="btn-pencil" title="Edit expense" aria-label="Edit expense"
            data-description="${escAttr(e.description)}"
            data-amount="${amountDisplay}"
            data-paid-by="${e.paid_by}"
            data-split-with="${splitWith}"
            onclick="window.dispatchEvent(new CustomEvent('open-edit-expense',{detail:{id:'${e.id}',description:this.dataset.description,amount:this.dataset.amount,paidBy:this.dataset.paidBy,splitWith:JSON.parse(this.dataset.splitWith)}}))">
            ${pencilIcon}
          </button>
          <form method="POST" action="/api/expenses/${e.id}/delete" style="margin:0;">
            <button type="submit" class="btn-trash" title="Delete expense" aria-label="Delete expense" onclick="event.preventDefault();if(confirm('Delete this expense?'))this.closest('form').submit()">${trashIcon}</button>
          </form>
        </div>
      </div>`
  }).join('')

  const balancesHtml = (members ?? []).map((m: any) => {
    const uid = m.user_id
    const email = m.profiles?.email ?? 'Unknown'
    const net = balances[uid] ?? 0
    const isCurrentUser = uid === user.id
    const label = isCurrentUser ? 'You' : escAttr(email)
    const paid = paidByUser[uid] ?? 0
    const share = shareByUser[uid] ?? 0
    const netSpan = net === 0
      ? `<span class="amount-settled">settled</span>`
      : net > 0
        ? `<span class="amount-owed">+$${centsToDisplay(net)}</span>`
        : `<span class="amount-owe">-$${centsToDisplay(net)}</span>`
    return `
      <div class="balance-item" x-data="{ open: false }">
        <div class="balance-row" x-on:click="open = !open">
          <span>${label}</span>
          <div class="balance-row-right">
            ${netSpan}
            <span class="balance-expand-hint" x-bind:style="open ? 'transform:rotate(90deg)' : ''">▶</span>
          </div>
        </div>
        <div class="balance-breakdown" x-show="open" x-cloak>
          <div class="breakdown-row"><span>Paid</span><span>$${centsToDisplay(paid)}</span></div>
          <div class="breakdown-row"><span>Share</span><span>$${centsToDisplay(share)}</span></div>
          <div class="breakdown-row breakdown-total"><span>Net</span>${netSpan}</div>
        </div>
      </div>`
  }).join('')

  return new Response(`
    <div id="expense-form-error"></div>
    <div id="expenses-list">${expensesHtml || '<p class="empty-state">No expenses yet.</p>'}</div>
    <div id="balances-section" hx-swap-oob="innerHTML">
      ${balancesHtml}
    </div>
    <span id="group-total" hx-swap-oob="outerHTML">Total spent: <strong>$${centsToDisplay(totalCents)}</strong></span>
  `, { headers: { 'Content-Type': 'text/html' } })
}
