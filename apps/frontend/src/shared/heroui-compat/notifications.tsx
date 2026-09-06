import { Toast, toast } from '@heroui/react'
import type { ReactNode } from 'react'

type NotificationColor = string | undefined

function pickToast(color: NotificationColor) {
    if (color === 'red' || color === 'pink' || color === 'grape') return toast.danger
    if (color === 'yellow' || color === 'orange') return toast.warning
    if (color === 'green' || color === 'teal' || color === 'lime') return toast.success
    return toast.info
}

export const notifications = {
    show(payload: Record<string, any>) {
        const fn = pickToast(payload.color)
        return fn(payload.title ?? payload.message ?? '', {
            description: payload.title ? payload.message : undefined,
            indicator: payload.icon,
            isLoading: payload.loading,
            timeout: payload.autoClose === false ? undefined : typeof payload.autoClose === 'number' ? payload.autoClose : 4000
        })
    },
    update(payload: Record<string, any>) {
        toast.close(payload.id)
        return notifications.show(payload)
    },
    hide(id: string) {
        toast.close(id)
    },
    clean() {
        toast.clear()
    },
    cleanQueue() {
        toast.clear()
    }
}

export function Notifications(_props: { position?: string }) {
    return null
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
    return (
        <Toast.Provider placement="top end" maxVisibleToasts={5}>
            {children}
        </Toast.Provider>
    )
}
