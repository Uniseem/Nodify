import { Card, CardProps, Flex } from '@shared/heroui-compat'

import classes from './settings-card.module.css'

type SettingsCardContainerProps = CardProps

export function SettingsCardContainer({ children, ...props }: SettingsCardContainerProps) {
    return (
        <Card className={classes.container} padding="md" shadow="xl" withBorder {...props}>
            <Flex direction="column" gap="xs">
                {children}
            </Flex>
        </Card>
    )
}
