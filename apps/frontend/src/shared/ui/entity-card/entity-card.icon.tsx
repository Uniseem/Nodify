import { ActionIcon, ActionIconProps, PolymorphicComponentProps } from '@shared/heroui-compat'

import classes from './entity-card.module.css'

interface EntityCardIconProps extends PolymorphicComponentProps<'div', ActionIconProps> {
    highlight?: boolean
}

export function EntityCardIcon({ children, highlight = true, ...props }: EntityCardIconProps) {
    return (
        <ActionIcon
            className={classes.icon}
            component="div"
            color={highlight ? 'teal' : 'gray'}
            size={32}
            variant="soft"
            {...props}
        >
            {children}
        </ActionIcon>
    )
}
