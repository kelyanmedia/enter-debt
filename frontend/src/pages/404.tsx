export default function NotFoundPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#f8fafc',
        color: '#0f172a',
        fontFamily: 'inherit',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 16,
          padding: '28px 24px',
          boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>
          EnterDebt
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>Страница не найдена</div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: '#64748b' }}>
          Проверьте адрес или вернитесь на главную страницу.
        </div>
      </div>
    </div>
  )
}
