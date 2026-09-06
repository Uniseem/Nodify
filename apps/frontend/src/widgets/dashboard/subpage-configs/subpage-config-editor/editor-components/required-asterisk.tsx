import { Text } from '@shared/heroui-compat'

export function RequiredAsterisk() {
    return (
        <Text c="red" component="span" fz="inherit" inherit ml={4}>
            *
        </Text>
    )
}
