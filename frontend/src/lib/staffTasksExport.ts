import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

export type StaffExportRow = {
  date: string
  project: string
  task: string
  hours: string
  amount: string
  status: string
  paid: boolean
}

export type StaffExportOptions = {
  periodTitle: string
  employeeName: string
  summaryLines: string[]
  paymentDetails: string
  rows: StaffExportRow[]
  footerHours: string
  footerAmounts: string
}

const STATUS_RU: Record<string, string> = {
  not_started: 'Не начато',
  in_progress: 'В процессе',
  pending_approval: 'На утверждении',
  done: 'Готово',
}

export function taskStatusRu(status: string): string {
  return STATUS_RU[status] || status
}

function buildExportElement(opts: StaffExportOptions): HTMLDivElement {
  const el = document.createElement('div')
  el.setAttribute('data-staff-export', '1')
  el.style.cssText =
    'box-sizing:border-box;width:880px;max-width:100%;padding:32px 36px;background:#ffffff;' +
    'font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,sans-serif;color:#0f172a;font-size:14px;line-height:1.5;'

  const title = document.createElement('div')
  title.textContent = opts.periodTitle
  title.style.cssText = 'font-size:22px;font-weight:800;margin:0 0 6px 0;letter-spacing:-0.02em;'
  el.appendChild(title)

  const who = document.createElement('div')
  who.textContent = opts.employeeName
  who.style.cssText = 'font-size:15px;color:#64748b;margin:0 0 18px 0;'
  el.appendChild(who)

  opts.summaryLines.forEach((line) => {
    const p = document.createElement('div')
    p.textContent = line
    p.style.cssText = 'font-size:14px;font-weight:600;margin:0 0 4px 0;color:#1e293b;'
    el.appendChild(p)
  })

  const pay = document.createElement('div')
  pay.style.cssText =
    'margin:16px 0 0 0;padding:14px 16px;border:1px dashed #cbd5e1;border-radius:10px;' +
    'font-size:13px;white-space:pre-wrap;color:#334155;line-height:1.55;background:#fafafa;'
  pay.textContent = `Реквизиты / выплата:\n${opts.paymentDetails}`
  el.appendChild(pay)

  const table = document.createElement('table')
  table.style.cssText = 'width:100%;border-collapse:collapse;margin-top:20px;font-size:13px;'

  const thead = document.createElement('thead')
  const htr = document.createElement('tr')
  htr.style.background = '#f8fafc'
  const heads = ['Дата', 'Проект', 'Задача', 'Часы', 'Сумма', 'Статус']
  heads.forEach((text) => {
    const th = document.createElement('th')
    th.textContent = text
    th.style.cssText =
      'text-align:left;padding:11px 14px;border-bottom:2px solid #e2e8f0;font-size:10px;' +
      'text-transform:uppercase;letter-spacing:0.06em;color:#64748b;font-weight:700;'
    htr.appendChild(th)
  })
  thead.appendChild(htr)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  if (opts.rows.length === 0) {
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.colSpan = 6
    td.textContent = 'Нет строк за этот месяц'
    td.style.cssText = 'padding:24px 14px;color:#94a3b8;text-align:center;'
    tr.appendChild(td)
    tbody.appendChild(tr)
  } else {
    opts.rows.forEach((row) => {
      const tr = document.createElement('tr')
      tr.style.borderBottom = '1px solid #f1f5f9'
      const strike = row.paid
      const cellStyle = strike ? 'text-decoration:line-through;color:#94a3b8;' : ''
      ;[
        row.date,
        row.project,
        row.task,
        row.hours,
        row.amount,
        row.status,
      ].forEach((cell, i) => {
        const td = document.createElement('td')
        td.textContent = cell
        const weight = i === 4 ? 'font-weight:700;' : ''
        td.style.cssText = `padding:11px 14px;vertical-align:top;${weight}${cellStyle}`
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    })
  }
  table.appendChild(tbody)

  const tfoot = document.createElement('tfoot')
  const ftr = document.createElement('tr')
  ftr.style.background = '#f1f5f9'
  const tdLabel = document.createElement('td')
  tdLabel.colSpan = 3
  tdLabel.textContent = 'Итого по строкам (без оплаченных)'
  tdLabel.style.cssText =
    'padding:12px 14px;font-weight:700;font-size:13px;color:#475569;border-top:2px solid #e2e8f0;'
  ftr.appendChild(tdLabel)
  const tdH = document.createElement('td')
  tdH.textContent = opts.footerHours
  tdH.style.cssText =
    'padding:12px 14px;font-weight:700;font-size:13px;border-top:2px solid #e2e8f0;'
  ftr.appendChild(tdH)
  const tdA = document.createElement('td')
  tdA.colSpan = 2
  tdA.textContent = opts.footerAmounts
  tdA.style.cssText =
    'padding:12px 14px;font-weight:700;font-size:13px;border-top:2px solid #e2e8f0;'
  ftr.appendChild(tdA)
  tfoot.appendChild(ftr)
  table.appendChild(tfoot)

  el.appendChild(table)

  const foot = document.createElement('div')
  foot.textContent = `Сформировано: ${new Date().toLocaleString('ru-RU')}`
  foot.style.cssText = 'margin-top:18px;font-size:11px;color:#94a3b8;'
  el.appendChild(foot)

  return el
}

async function captureElement(el: HTMLDivElement): Promise<HTMLCanvasElement> {
  el.style.position = 'fixed'
  el.style.left = '-12000px'
  el.style.top = '0'
  el.style.zIndex = '0'
  document.body.appendChild(el)
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
  try {
    return await html2canvas(el, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
    })
  } finally {
    document.body.removeChild(el)
  }
}

function safeFilenamePart(s: string): string {
  return s.replace(/[^\w\u0400-\u04FF\-]+/g, '_').slice(0, 60) || 'export'
}

export async function exportStaffTasksPng(opts: StaffExportOptions, fileBase: string): Promise<void> {
  const el = buildExportElement(opts)
  const canvas = await captureElement(el)
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `${safeFilenamePart(fileBase)}.png`
  a.click()
}

export async function exportStaffTasksPdf(opts: StaffExportOptions, fileBase: string): Promise<void> {
  const el = buildExportElement(opts)
  const canvas = await captureElement(el)
  const imgData = canvas.toDataURL('image/jpeg', 0.92)
  const wPx = canvas.width
  const hPx = canvas.height
  const pdf = new jsPDF({
    orientation: hPx >= wPx ? 'portrait' : 'landscape',
    unit: 'px',
    format: [wPx, hPx],
    hotfixes: ['px_scaling'],
  })
  pdf.addImage(imgData, 'JPEG', 0, 0, wPx, hPx, undefined, 'FAST')
  pdf.save(`${safeFilenamePart(fileBase)}.pdf`)
}
