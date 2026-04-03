/** Совпадает с подписями месяцев на CEO Dashboard (dashboard.py _MONTHS_RU). */
const MONTHS_RU_CEO = [
  'янв.',
  'фев.',
  'мар.',
  'апр.',
  'мая',
  'июн.',
  'июл.',
  'авг.',
  'сен.',
  'окт.',
  'нояб.',
  'дек.',
] as const

export interface PLReportForNet {
  columns: string[]
  rows: { row_id: string; cells: { uzs: string; usd: string }[] }[]
}

export interface NetProfitSeriesPoint {
  month: string
  label: string
  amount: number
  previous_year_amount: number
}

function netProfitCells(report: PLReportForNet | null | undefined): number[] {
  if (!report?.rows?.length) return Array(12).fill(0)
  const op = report.rows.find(r => r.row_id === 'operating_profit')
  const net = report.rows.find(r => r.row_id === 'net_profit')
  const row = op ?? net
  if (!row?.cells?.length) return Array(12).fill(0)
  return row.cells.map(c => Number(c.uzs) || 0)
}

/** Точки для графика: текущий год из P&L + тот же месяц год назад. */
export function buildNetProfitSeriesFromPl(
  year: number,
  current: PLReportForNet | null | undefined,
  previous: PLReportForNet | null | undefined,
): NetProfitSeriesPoint[] {
  const cur = netProfitCells(current)
  const prev = netProfitCells(previous)
  const cols = current?.columns?.length === 12 ? current.columns : null
  const out: NetProfitSeriesPoint[] = []
  for (let i = 0; i < 12; i++) {
    const ym = cols?.[i] ?? `${year}-${String(i + 1).padStart(2, '0')}`
    out.push({
      month: ym,
      label: `${MONTHS_RU_CEO[i]} ${year}`,
      amount: cur[i] ?? 0,
      previous_year_amount: prev[i] ?? 0,
    })
  }
  return out
}
