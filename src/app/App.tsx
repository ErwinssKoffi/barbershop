import { MotionConfig } from 'framer-motion'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '../contexts/AuthProvider'
import { SalonStoreProvider } from '../hooks/SalonStoreProvider'
import { ToastProvider } from '../hooks/ToastProvider'
import { AppRoutes } from './router'

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <SalonStoreProvider>
          <BrowserRouter>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </SalonStoreProvider>
      </ToastProvider>
    </MotionConfig>
  )
}
