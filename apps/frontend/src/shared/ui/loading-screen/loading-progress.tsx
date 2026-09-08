import { nprogress } from '@shared/heroui-compat'
import { useEffect } from 'react'

import { LoadingScreen } from './loading-screen'

export function LoadingProgress() {
    useEffect(() => {
        nprogress.start()
        return () => nprogress.complete()
    }, [])

    return <LoadingScreen height="100dvh" text="Loading" />
}
