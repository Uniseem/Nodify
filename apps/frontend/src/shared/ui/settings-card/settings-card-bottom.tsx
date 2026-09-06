import { Divider } from '@shared/heroui-compat'
import { ReactNode } from 'react'

interface SettingsCardBottomProps {
    children: ReactNode
}

export function SettingsCardBottom({ children }: SettingsCardBottomProps) {
    return (
        <>
            <Divider
                mt="lg"
                style={{
                    opacity: 0.3
                }}
            />
            {children}
        </>
    )
}
