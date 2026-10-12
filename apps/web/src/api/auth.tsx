import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, tokenStore, type User } from './client'

type AuthState = {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<User>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(!!tokenStore.get())

  useEffect(() => {
    if (!tokenStore.get()) return
    api<User>('/auth/me')
      .then((r) => setUser(r.data))
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onLogout = () => setUser(null)
    window.addEventListener('azalas:logout', onLogout)
    return () => window.removeEventListener('azalas:logout', onLogout)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const r = await api<{ access_token: string; refresh_token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    tokenStore.set(r.data.access_token)
    tokenStore.setRefresh(r.data.refresh_token)
    setUser(r.data.user)
    return r.data.user
  }, [])

  const logout = useCallback(() => {
    const refreshToken = tokenStore.getRefresh()
    if (refreshToken) void api('/auth/logout', { method: 'POST', body: { refresh_token: refreshToken } }).catch(() => undefined)
    tokenStore.clear()
    setUser(null)
  }, [])

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
