import type { CSSProperties, ReactNode } from 'react'

export function CodeHighlight({
    code,
    language,
    className,
    style,
    children,
    ..._rest
}: Record<string, any>) {
    return (
        <pre
            className={['overflow-auto rounded-lg bg-default p-3 text-sm text-foreground', className]
                .filter(Boolean)
                .join(' ')}
            data-language={language}
            style={style}
        >
            <code>{code ?? children}</code>
        </pre>
    )
}
