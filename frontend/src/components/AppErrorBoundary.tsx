import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }

type State = { error: Error | null }

/**
 * Ловит падения React при рендере; без этого — белый экран и «немой» чанк 404 в консоли.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f5f6fa',
            padding: 24,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              maxWidth: 440,
              background: '#fff',
              border: '1px solid #e8e9ef',
              borderRadius: 16,
              padding: '28px 24px',
              boxShadow: '0 4px 24px rgba(0,0,0,.06)',
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 700, color: '#1a1d23', marginBottom: 10 }}>Что-то пошло не так</div>
            <p style={{ margin: 0, fontSize: 14, color: '#64748b', lineHeight: 1.55, marginBottom: 16 }}>
              Интерфейс не загрузился. Частая причина в dev — устаревший кэш чанков после обновления кода. Нажмите
              «Обновить страницу»; если не помогло — остановите <code style={{ fontSize: 12 }}>npm run dev</code>, удалите
              папку <code style={{ fontSize: 12 }}>.next</code> и запустите снова.
            </p>
            {process.env.NODE_ENV === 'development' && (
              <pre
                style={{
                  fontSize: 11,
                  color: '#b91c1c',
                  background: '#fef2f2',
                  padding: 10,
                  borderRadius: 8,
                  overflow: 'auto',
                  maxHeight: 120,
                  marginBottom: 16,
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null })
                window.location.reload()
              }}
              style={{
                padding: '10px 18px',
                borderRadius: 10,
                border: 'none',
                background: '#1a6b3c',
                color: '#fff',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Обновить страницу
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
