/** Проверка обязательных полей сделки (автоматизации CRM). */

export type DealRequirementKey =
  | 'contact_name'
  | 'phone'
  | 'contact_position'
  | 'company_name'
  | 'source'
  | 'client_geo'
  | 'service_type'

export type DealFieldsForRequirements = {
  contact_name?: string | null
  phone?: string | null
  contact_position?: string | null
  company_name?: string | null
  source?: string | null
  client_geo?: string | null
  service_type?: string | null
}

function fieldFilled(deal: DealFieldsForRequirements, key: DealRequirementKey): boolean {
  if (key === 'phone') {
    const digits = (deal.phone || '').replace(/\D/g, '')
    return digits.length >= 12
  }
  const v = (deal[key] || '').toString().trim()
  return Boolean(v)
}

export function dealMissingRequiredFields(
  deal: DealFieldsForRequirements,
  required: string[] | null | undefined,
): string[] {
  if (!required?.length) return []
  return required.filter((k) => {
    if (!(k in { contact_name: 1, phone: 1, contact_position: 1, company_name: 1, source: 1, client_geo: 1, service_type: 1 })) {
      return false
    }
    return !fieldFilled(deal, k as DealRequirementKey)
  })
}

export function dealHasAutomationBlock(
  deal: DealFieldsForRequirements & { assigned_user_id?: number | null },
  requirementsByManager: Record<number, string[]>,
): boolean {
  const mid = deal.assigned_user_id
  if (mid == null) return false
  const req = requirementsByManager[mid]
  return dealMissingRequiredFields(deal, req).length > 0
}
