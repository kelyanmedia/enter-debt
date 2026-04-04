/**
 * Q&A для роли «Сотрудник»: кнопка в сайдбаре и панель справа на весь экран по высоте.
 */
import { useEffect } from 'react'

const pStyle = { margin: '0 0 14px', fontSize: 14, lineHeight: 1.6 } as const
const hStyle = {
  margin: '22px 0 10px',
  fontSize: 15,
  fontWeight: 700,
  color: '#1e293b',
  letterSpacing: '-0.01em',
} as const
const ulStyle = { margin: '0 0 14px', paddingLeft: 22, lineHeight: 1.65, fontSize: 14 } as const

function GuideBody() {
  return (
    <>
      <div style={hStyle}>Два разных раздела — не путайте</div>
      <p style={pStyle}>
        <strong>📋 Мои задачи</strong> — это учёт работ: что вы делали, для какого проекта, сумма, статус. Это{' '}
        <strong>не банк</strong> и не замена бухгалтерии.
      </p>
      <p style={pStyle}>
        <strong>💳 История выплат</strong> — это учёт <strong>реальных переводов денег</strong> вам на карту/счёт: дата,
        сумма, валюта, за какой период, примечание, чек. Сюда вы заходите <strong>после того, как выплату проверили</strong>{' '}
        (увидели деньги, согласовали с админом/бухгалтерией) и <strong>обязательно добавляете запись</strong>, чтобы у
        компании совпадали задачи, выплаты и отчёты.
      </p>

      <div style={hStyle}>Что сделать после выплаты (пошагово)</div>
      <ol style={{ ...ulStyle, listStyle: 'decimal' }}>
        <li style={{ marginBottom: 10 }}>
          Проверьте, что в <strong>«Мои задачи»</strong> за нужный месяц перечислены <strong>все работы</strong>, за которые
          вас оплатили — и текущего, и прошлого месяца, если что-то внесли с опозданием.
        </li>
        <li style={{ marginBottom: 10 }}>
          Откройте в меню слева <strong>«💳 История выплат»</strong> (это пункт меню, не кнопка в строке задачи).
        </li>
        <li style={{ marginBottom: 10 }}>
          Нажмите добавление записи и укажите: <strong>дату перевода</strong>, <strong>сумму</strong> и <strong>валюту</strong>,
          за какой <strong>год и месяц</strong> периода выплата, в примечании — коротко, за что (какие проекты/задачи), как в
          таблице задач. При необходимости прикрепите чек.
        </li>
        <li>
          Если админ ведёт вас в разделе <strong>«Команда»</strong>, логика та же: задачи в одном месте, фиксация факта
          выплаты — в истории выплат.
        </li>
      </ol>

      <div style={hStyle}>Задачи: за прошлые месяцы и «всё актуальное»</div>
      <ul style={ulStyle}>
        <li>
          Вверху выберите <strong>год</strong> и <strong>месяц</strong>. То, что вы забыли внести в прошлом месяце, —{' '}
          <strong>добавьте в том месяце</strong> (поменяйте месяц в фильтре и создайте задачу с правильной датой работы).
        </li>
        <li>
          <strong>Все текущие задачи</strong> по всем проектам, за которые вы получаете оплату, лучше держать в таблице
          сразу: так не потеряются суммы и не придётся вспоминать в конце месяца.
        </li>
      </ul>

      <div style={hStyle}>Часы — зачем и когда можно не указывать</div>
      <p style={pStyle}>
        Колонка <strong>«Часы»</strong> нужна компании, чтобы <strong>примерно понимать фокус</strong>: сколько времени у
        вас уходит на проект (внутренняя аналитика, не налоговая форма). Если честно не знаете — ставьте прикидку или
        оставьте пусто (в таблице будет «—»). <strong>Если знаете порядок величины — укажите</strong>: так нам проще
        планировать нагрузку.
      </p>

      <p
        style={{
          ...pStyle,
          fontSize: 13,
          color: '#475569',
          background: '#f1f5f9',
          padding: '12px 14px',
          borderRadius: 10,
          border: '1px solid #e2e8f0',
        }}
      >
        <strong>Итоги</strong> внизу таблицы и в карточках сверху за месяц считаются{' '}
        <strong>без строк с отметкой «$» оплачено</strong> — это суммы «ещё к учёту по задачам»; сами выплаты вы фиксируете в
        «История выплат».
      </p>

      <div style={hStyle}>Кнопки справа в строке задачи</div>
      <p style={pStyle}>Так выглядит и работает ряд кнопок в «Мои задачи» (та же логика, что у админа в «Команда»):</p>
      <ul style={ulStyle}>
        <li>
          <strong>→</strong> — перенос <strong>этой же строки</strong> на <strong>следующий календарный месяц</strong> (дата
          сдвинется, в текущем месяце строка исчезнет). Если работа «переползла» на следующий месяц — используйте это.
        </li>
        <li>
          <strong>$</strong> — отметка строки как <strong>«оплачено по учёту задачи»</strong>: строка считается закрытой по
          выплате в этом учёте, сумма может выйти из итогов «к выплате». Это <strong>не замена</strong> раздела{' '}
          <strong>«История выплат»</strong> — факт перевода деньгами вы всё равно фиксируете там.
        </li>
        <li>
          <strong>⧉</strong> — <strong>копия</strong> строки в <strong>следующем месяце</strong>; исходная не меняется.
        </li>
        <li>
          <strong>Карандаш</strong> — изменить дату, проект, описание, сумму, часы, статус (если разрешено правилами).
        </li>
        <li>
          <strong>✕</strong> — удалить строку без восстановления. Удаляйте только если строка создана по ошибке.
        </li>
      </ul>

      <div style={hStyle}>Реквизиты в профиле</div>
      <p style={pStyle}>
        В <strong>«Профиль»</strong> укажите <strong>номер карты/счёта и ФИО</strong> как в банке, либо при оплате криптой —{' '}
        <strong>сеть и полный адрес кошелька</strong>. Там же подсказки и примеры в одном поле: так бухгалтерия копирует ваш
        текст в платёж без лишних вопросов.
      </p>

      <p style={{ ...pStyle, marginBottom: 0, fontSize: 13, color: '#64748b' }}>
        Подсказка: наведите на кнопки в таблице — во многих браузерах покажется краткое пояснение (title). Закрыть эту
        панель — крестик вверху или клик по затемнению слева.
      </p>
    </>
  )
}

export function EmployeeQaDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, pointerEvents: 'auto' }}>
      <button
        type="button"
        aria-label="Закрыть справку"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          border: 'none',
          margin: 0,
          padding: 0,
          background: 'rgba(15, 23, 42, 0.35)',
          cursor: 'pointer',
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-qa-title"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          zIndex: 1,
          height: '100%',
          width: 'min(720px, 100%)',
          maxWidth: '100%',
          background: '#fff',
          boxShadow: '-12px 0 48px rgba(15, 23, 42, 0.18)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'employeeQaSlideIn 0.22s ease-out',
        }}
      >
        <style>{`
          @keyframes employeeQaSlideIn {
            from { transform: translateX(100%); opacity: 0.96; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>
        <div
          style={{
            flexShrink: 0,
            padding: '18px 20px 14px',
            borderBottom: '1px solid #e8e9ef',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            background: '#fafbfc',
          }}
        >
          <div>
            <div id="employee-qa-title" style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
              Q&amp;A
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, lineHeight: 1.4 }}>
              Задачи, выплаты, кнопки в таблице, реквизиты
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              background: '#fff',
              cursor: 'pointer',
              fontSize: 22,
              lineHeight: 1,
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 28px 40px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <GuideBody />
        </div>
      </aside>
    </div>
  )
}
