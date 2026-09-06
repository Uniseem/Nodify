import { Group } from '@shared/heroui-compat'

import classes from './entity-card.module.css'

interface HeaderProps {
    children: React.ReactNode
}

export function EntityCardHeader({ children }: HeaderProps) {
    return (
        <Group align="center" className={classes.header} gap={10} wrap="nowrap">
            {children}
        </Group>
    )
}
