import { Group, Text } from '@shared/heroui-compat'

export const InfoFieldShared = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <Group align="center" justify="flex-start">
        <Text c="dimmed" size="sm">
            {label}
        </Text>
        <Text size="sm">{value || '—'}</Text>
    </Group>
)
