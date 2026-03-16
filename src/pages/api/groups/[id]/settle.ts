import type { APIRoute } from 'astro'
import { createSupabaseServerClient, createSupabaseAdmin } from '../../../../lib/supabase'
import { calculateBalances, simplifyDebts, centsToDisplay } from '../../../../lib/balance'
import type { Payment } from '../../../../lib/balance'

function escAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildSuggestedPaymentsHtml(
  payments: Payment[],
  emailMap: Record<string, string>,
  groupId: string,
  currentUserId: string
): string {
  if (payments.length === 0) return '<p class="empty-state">All settled up!</p>'
  return payments.map(p => {
    const fromLabel = p.from === currentUserId ? 'You' : escAttr(emailMap[p.from] ?? 'Unknown')
    const toLabel = p.to === currentUserId ? 'you' : escAttr(emailMap[p.to] ?? 'Unknown')
    return `
      <div class="suggested-payment">
        <div class="payment-info">
          <span class="payment-from">${fromLabel}</span>
          <span class="payment-arrow"> → </span>
          <span class="payment-to">${toLabel}</span>
          <span class="payment-amount"> · $${centsToDisplay(p.amount)}</span>
        </div>
        <form hx-post="/api/groups/${groupId}/settle"
              hx-target="#balances-section"
              hx-swap="innerHTML"
              style="margin:0;">
          <input type="hidden" name="from_user_id" value="${p.from}" />
          <input type="hidden" name="to_user_id" value="${p.to}" />
          <input type="hidden" name="amount_cents" value="${p.amount}" />
          <button type="submit" class="btn-settle">Settle</button>
        </form>
      </div>`
  }).join('')
}

export const POST: APIRoute = async ({ request, cookies, params }) => {
  const supabase = createSupabaseServerClient(request, cookies)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const groupId = params.id!
  const admin = createSupabaseAdmin()

  // Verify membership
  const { data: membership } = await admin
    .from('group_members').select('id')
    .eq('group_id', groupId).eq('user_id', user.id).single()
  if (!membership) return new Response('Forbidden', { status: 403 })

  const { data: members } = await admin
    .from('group_members').select('user_id, profiles(email)')
    .eq('group_id', groupId)

  const memberIds = new Set((members ?? []).map((m: any) => m.user_id))

  const form = await request.formData()
  const fromUserId = form.get('from_user_id')?.toString() ?? ''
  const toUserId = form.get('to_user_id')?.toString() ?? ''
  const amountCents = parseInt(form.get('amount_cents')?.toString() ?? '0', 10)

  if (!fromUserId || !toUserId || !amountCents || amountCents <= 0) {
    return new Response('Invalid settlement data', { status: 400 })
  }
  if (!memberIds.has(fromUserId) || !memberIds.has(toUserId)) {
    return new Response('Invalid users', { status: 400 })
  }

  await admin.from('settlements').insert({
    group_id: groupId,
    from_user_id: fromUserId,
    to_user_id: toUserId,
    amount_cents: amountCents,
  })

  // Re-fetch to recompute balances
  const { data: expenses } = await admin
    .from('expenses').select('id, paid_by, amount_cents')
    .eq('group_id', groupId)

  const { data: splits } = (expenses ?? []).length > 0
    ? await admin.from('expense_splits').select('expense_id, user_id, amount_cents')
        .in('expense_id', (expenses ?? []).map((e: any) => e.id))
    : { data: [] }

  const { data: settlements } = await admin
    .from('settlements').select('from_user_id, to_user_id, amount_cents')
    .eq('group_id', groupId)

  const balances = calculateBalances(expenses ?? [], splits ?? [], settlements ?? [])

  // Precompute paid/share for breakdown display
  const paidByUser: Record<string, number> = {}
  for (const e of expenses ?? []) {
    paidByUser[(e as any).paid_by] = (paidByUser[(e as any).paid_by] ?? 0) + (e as any).amount_cents
  }
  const shareByUser: Record<string, number> = {}
  for (const s of splits ?? []) {
    shareByUser[(s as any).user_id] = (shareByUser[(s as any).user_id] ?? 0) + (s as any).amount_cents
  }

  const balancesHtml = (members ?? []).map((m: any) => {
    const uid = m.user_id
    const net = balances[uid] ?? 0
    const label = uid === user.id ? 'You' : escAttr(m.profiles?.email ?? 'Unknown')
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

  const emailMap: Record<string, string> = {}
  for (const m of members ?? []) {
    emailMap[(m as any).user_id] = (m as any).profiles?.email ?? 'Unknown'
  }
  const suggestedPaymentsHtml = buildSuggestedPaymentsHtml(
    simplifyDebts(balances), emailMap, groupId, user.id
  )

  return new Response(`
    ${balancesHtml}
    <div id="suggested-payments" hx-swap-oob="innerHTML">${suggestedPaymentsHtml}</div>
  `, { headers: { 'Content-Type': 'text/html' } })
}
