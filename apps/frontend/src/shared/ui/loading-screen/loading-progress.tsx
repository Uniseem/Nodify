import { nprogress } from '@shared/heroui-compat'
import { useEffect } from 'react'

export function LoadingProgress() {
    useEffect(() => {
        nprogress.start()
        return () => nprogress.complete()
    }, [])

    return <></>
}
