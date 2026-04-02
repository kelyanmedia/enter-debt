/** Доступ к разделам P&L, ДДС, Projects Cost, Оплаты, Расходы (меню «Финансы»). */
export function isFinanceTeamRole(role: string | undefined): boolean {
  return role === 'admin' || role === 'financier'
}
