import { useEffect, useState } from 'react'

let value = 0
let listeners = new Set<(next: number) => void>()

function emit(next: number) {
    value = next
    listeners.forEach((listener) => listener(next))
}

export const nprogress = {
    start() {
        emit(15)
    },
    set(next: number) {
        emit(next)
    },
    increment() {
        emit(Math.min(90, value + 10))
    },
    complete() {
        emit(100)
        window.setTimeout(() => emit(0), 240)
    }
}

export function NavigationProgress() {
    const [progress, setProgress] = useState(0)

    useEffect(() => {
        listeners.add(setProgress)
        return () => {
            listeners.delete(setProgress)
        }
    }, [])

    if (!progress) return null

    return (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-[400] h-0.5 bg-transparent">
            <div
                className="h-full bg-cyan-400 transition-all duration-200"
                style={{ width: `${progress}%` }}
            />
        </div>
    )
}
