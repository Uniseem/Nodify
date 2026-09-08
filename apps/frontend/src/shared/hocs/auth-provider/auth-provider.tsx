import { createContext, ReactNode, useEffect, useMemo, useState } from 'react'

import { logoutEvents } from '@shared/emitters'
import { resetAllStores } from '@shared/hocs/store-wrapper'

import { removeToken, useToken } from '@entities/auth'

interface AuthContextValues {
    isAuthenticated: boolean
    isInitialized: boolean
    setIsAuthenticated: (isAuthenticated: boolean) => void
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValues | null>(null)

interface AuthProviderProps {
    children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
    const token = useToken()
    const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(token))
    const isInitialized = true
    const [isLoggedOut, setIsLoggedOut] = useState(false)

    const logoutUser = () => {
        if (isLoggedOut) {
            return
        }

        try {
            setIsLoggedOut(true)
            setIsAuthenticated(false)
            removeToken()
            resetAllStores()
        } finally {
            setIsLoggedOut(false)
        }
    }

    useEffect(() => {
        const unsubscribe = logoutEvents.subscribe(() => {
            logoutUser()
        })

        return unsubscribe
    }, [])

    useEffect(() => {
        if (token) {
            setIsAuthenticated(true)
            setIsLoggedOut(false)
            return
        }

        setIsAuthenticated(false)
    }, [token])

    const value = useMemo(
        () => ({ isAuthenticated, isInitialized, setIsAuthenticated }),
        [isAuthenticated, isInitialized]
    )

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
