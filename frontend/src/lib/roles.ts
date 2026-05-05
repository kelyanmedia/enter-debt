/** Доступ к разделам P&L, ДДС, Projects Cost, Оплаты, Расходы (меню «Финансы»). */
export function isFinanceTeamRole(role: string | undefined): boolean {
  return role === 'admin' || role === 'financier'
}

type FinanceSectionKey =
  | 'ceo'
  | 'pl'
  | 'cashflow'
  | 'projects_cost'
  | 'received_payments'
  | 'expenses'
  | 'lending'

type FinanceAccessUser = {
  role?: string
  can_view_finance_ceo?: boolean
  can_view_finance_pl?: boolean
  can_view_finance_cashflow?: boolean
  can_view_finance_projects_cost?: boolean
  can_view_finance_received_payments?: boolean
  can_view_finance_expenses?: boolean
  can_view_finance_lending?: boolean
}

const ACCOUNTANT_FINANCE_FIELD: Record<FinanceSectionKey, keyof FinanceAccessUser> = {
  ceo: 'can_view_finance_ceo',
  pl: 'can_view_finance_pl',
  cashflow: 'can_view_finance_cashflow',
  projects_cost: 'can_view_finance_projects_cost',
  received_payments: 'can_view_finance_received_payments',
  expenses: 'can_view_finance_expenses',
  lending: 'can_view_finance_lending',
}

export function canAccessFinanceSection(user: FinanceAccessUser | null | undefined, section: FinanceSectionKey): boolean {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'financier') return true
  if (user.role !== 'accountant') return false
  return user[ACCOUNTANT_FINANCE_FIELD[section]] === true
}
