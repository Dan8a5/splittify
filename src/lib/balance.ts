export type BalanceMap = Record<string, number> // user_id -> net cents (positive = owed to them)

export function calculateBalances(
  expenses: Array<{ id: string; paid_by: string; amount_cents: number }>,
  splits: Array<{ expense_id: string; user_id: string; amount_cents: number }>
): BalanceMap {
  const balances: BalanceMap = {}

  for (const expense of expenses) {
    balances[expense.paid_by] = (balances[expense.paid_by] ?? 0) + expense.amount_cents
  }

  for (const split of splits) {
    balances[split.user_id] = (balances[split.user_id] ?? 0) - split.amount_cents
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
