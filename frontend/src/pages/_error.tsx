import { NextPageContext } from 'next'

interface Props {
  statusCode?: number
}

export default function ErrorPage({ statusCode }: Props) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6fa', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1d23', marginBottom: 8 }}>
          {statusCode ? `Ошибка ${statusCode}` : 'Ошибка'}
        </div>
        <div style={{ fontSize: 14, color: '#8a8fa8' }}>Обновите страницу или откройте /login</div>
      </div>
    </div>
  )
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err && 'statusCode' in err ? (err as { statusCode?: number }).statusCode : 404
  return { statusCode }
}
