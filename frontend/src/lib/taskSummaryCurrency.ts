/** Единая настройка: показывать итог по задачам в UZS или в USD (Команда + Мои задачи). */

const KEY = 'ed_task_summary_currency'

export type TaskSummaryCurrency = 'UZS' | 'USD'

export function readTaskSummaryCurrency(): TaskSummaryCurrency {
  if (typeof window === 'undefined') return 'UZS'
  return localStorage.getItem(KEY) === 'USD' ? 'USD' : 'UZS'
}

export function writeTaskSummaryCurrency(c: TaskSummaryCurrency) {
  localStorage.setItem(KEY, c)
}
