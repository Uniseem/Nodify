import { Checkbox, CheckboxCardProps, CheckboxProps, Group, Text } from '@shared/heroui-compat'

import classes from './CheckboxCard.module.css'

export const CheckboxCardShared = ({
    checked,
    children,
    className,
    description,
    label,
    ...rest
}: CheckboxCardProps & CheckboxProps) => {
    return (
        <Checkbox.Card
            checked={checked}
            className={[classes.root, className].filter(Boolean).join(' ')}
            radius="md"
            {...rest}
        >
            {children || (
                <Group align="flex-start" wrap="nowrap">
                    <Checkbox.Indicator />
                    <div>
                        {label && <Text className={classes.label}>{label}</Text>}
                        {description && <Text className={classes.description}>{description}</Text>}
                    </div>
                </Group>
            )}
        </Checkbox.Card>
    )
}
