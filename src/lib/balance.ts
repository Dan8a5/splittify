export type BalanceMap = Record<string, number> // user_id -> net cents (positive = owed to them)

export type Payment = {
  from: string  // user_id who should pay
  to: string    // user_id who should receive
  amount: number // cents
}

export function calculateBalances(
  expenses: Array<{ id: string; paid_by: string; amount_cents: number }>,
  splits: Array<{ expense_id: string; user_id: string; amount_cents: number }>,
  settlements?: Array<{ from_user_id: string; to_user_id: string; amount_cents: number }>
): BalanceMap {
  const balances: BalanceMap = {}

  for (const expense of expenses) {
    balances[expense.paid_by] = (balances[expense.paid_by] ?? 0) + expense.amount_cents
  }

  for (const split of splits) {
    balances[split.user_id] = (balances[split.user_id] ?? 0) - split.amount_cents
  }

  // Settlements: payer's balance goes up (they paid out), receiver's balance goes down
  for (const s of settlements ?? []) {
    balances[s.from_user_id] = (balances[s.from_user_id] ?? 0) + s.amount_cents
    balances[s.to_user_id] = (balances[s.to_user_id] ?? 0) - s.amount_cents
  }

  return balances
}

export function centsToDisplay(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2)
}

export function calculateSplits(
  amountCents: number,
  memberIds: string[]
): Array<{ user_id: string; amount_cents: number }> {
  const n = memberIds.length
  if (n === 0) return []
  const base = Math.floor(amountCents / n)
  const remainder = amountCents - base * n
  return memberIds.map((id, i) => ({
    user_id: id,
    amount_cents: base + (i < remainder ? 1 : 0),
  }))
}

/**
 * Greedy debt simplification — returns the minimum number of payments
 * needed to settle all balances. O(n log n).
 */
export function simplifyDebts(balances: BalanceMap): Payment[] {
  const payments: Payment[] = []

  const debtors: Array<{ id: string; amount: number }> = []   // owe money
  const creditors: Array<{ id: string; amount: number }> = [] // are owed money

  for (const [id, net] of Object.entries(balances)) {
    if (net < -1) debtors.push({ id, amount: -net })
    else if (net > 1) creditors.push({ id, amount: net })
  }

  debtors.sort((a, b) => b.amount - a.amount)
  creditors.sort((a, b) => b.amount - a.amount)

  let i = 0, j = 0
  while (i < debtors.length && j < creditors.length) {
    const payment = Math.min(debtors[i].amount, creditors[j].amount)
    payments.push({ from: debtors[i].id, to: creditors[j].id, amount: payment })
    debtors[i].amount -= payment
    creditors[j].amount -= payment
    if (debtors[i].amount < 1) i++
    if (creditors[j].amount < 1) j++
  }

  return payments
}
