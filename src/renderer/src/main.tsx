import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

declare global {
  interface Window {
    dentiva: {
      call: (channel: string, token: string | null, payload: unknown) => Promise<import('@shared/errors').IpcResult<unknown>>
      onEvent: (cb: (event: { type: string }) => void) => () => void
      platform: string
    }
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
