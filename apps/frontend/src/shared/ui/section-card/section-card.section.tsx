import { Box, BoxProps } from '@shared/heroui-compat'
import { ReactNode, Ref } from 'react'

interface ISectionCardSectionProps extends BoxProps {
    children: ReactNode
    ref?: Ref<HTMLDivElement>
}

export function SectionCardSection({ children, ...props }: ISectionCardSectionProps) {
    return <Box {...props}>{children}</Box>
}
