import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import TestPage from './test/TestPage.tsx'

const isTestPage = window.location.pathname === '/test'
document.body.classList.toggle('test-route', isTestPage)
document.documentElement.classList.toggle('test-route-root', isTestPage)

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        {isTestPage ? <TestPage /> : <App />}
    </StrictMode>,
)
