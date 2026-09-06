import { Box } from '@shared/heroui-compat'

import classes from './SkeletonHeaderControl.module.css'

interface SkeletonHeaderControlProps {
    width?: number | string
}

export function SkeletonHeaderControl({ width = 44 }: SkeletonHeaderControlProps) {
    return <Box className={classes.skeleton} h={44} w={width} />
}
