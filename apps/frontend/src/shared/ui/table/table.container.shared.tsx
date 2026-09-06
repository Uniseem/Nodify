import { Card, CardProps } from '@shared/heroui-compat'

type TableContainerSharedProps = CardProps

export function TableContainerShared({ children, ...props }: TableContainerSharedProps) {
    return <Card {...props}>{children}</Card>
}
