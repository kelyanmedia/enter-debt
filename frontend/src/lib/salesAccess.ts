export type SalesAccessUser = {
  role?: string
  can_view_sales?: boolean
  can_view_crm?: boolean
  is_sales_rop?: boolean
}

/** Воронка, сделки, календарь, аналитика */
export function hasCrmPipelineAccess(user: SalesAccessUser | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'mop') return true
  if (['manager', 'administration'].includes(user.role || '') && user.can_view_crm === true) return true
  return false
}

/** Компании / личные списки менеджера (не клиентская база admin) */
export function hasSalesCompaniesAccess(user: SalesAccessUser | null | undefined): boolean {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'mop') return true
  if (['manager', 'administration'].includes(user.role || '') && user.can_view_sales === true) return true
  return false
}

export function isSalesRop(user: SalesAccessUser | null | undefined): boolean {
  return !!user?.is_sales_rop
}

export function canManageCrmStructure(user: SalesAccessUser | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'mop'
}

/** РОП или админ — просмотр воронки по менеджерам команды */
export function canBrowseTeamManagers(user: SalesAccessUser | null | undefined): boolean {
  return user?.role === 'admin' || isSalesRop(user)
}
