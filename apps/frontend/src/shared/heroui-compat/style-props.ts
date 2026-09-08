import type { CSSProperties, ReactNode } from 'react'

export type StyleValue = number | string | undefined

const SPACING: Record<string, string> = {
    0: '0',
    xs: '0.625rem',
    sm: '0.75rem',
    md: '1rem',
    lg: '1.25rem',
    xl: '2rem'
}

const FONT_SIZE: Record<string, string> = {
    xs: '0.75rem',
    sm: '0.875rem',
    md: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    h1: '2rem',
    h2: '1.625rem',
    h3: '1.375rem',
    h4: '1.125rem',
    h5: '1rem',
    h6: '0.875rem'
}

const RADIUS: Record<string, string> = {
    xs: '0.25rem',
    sm: '0.375rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem'
}

const COLOR_ALIASES: Record<string, string> = {
    dimmed: 'var(--mantine-color-dimmed, var(--muted))',
    white: '#ffffff',
    black: '#0d1117',
    currentColor: 'currentColor',
    inherit: 'inherit'
}

function unwrapResponsive(value: unknown): unknown {
    if (value && typeof value === 'object' && !Array.isArray(value) && 'base' in (value as object)) {
        return (value as { base: unknown }).base
    }
    return value
}

export function resolveSpacing(value: StyleValue): string | undefined {
    value = unwrapResponsive(value) as StyleValue
    if (value === undefined || value === null) return undefined
    if (typeof value === 'object') return undefined
    if (typeof value === 'number') return `${value}px`
    if (value in SPACING) return SPACING[value]
    return value
}

export function resolveColor(value: StyleValue): string | undefined {
    value = unwrapResponsive(value) as StyleValue
    if (value === undefined || value === null) return undefined
    if (typeof value === 'object') return undefined
    const raw = String(value)
    if (COLOR_ALIASES[raw]) return COLOR_ALIASES[raw]
    if (raw.startsWith('#') || raw.startsWith('rgb') || raw.startsWith('hsl') || raw.startsWith('var(')) {
        return raw
    }
    const [name, shade] = raw.split('.')
    if (shade) return `var(--mantine-color-${name}-${shade})`
    return `var(--mantine-color-${name}-filled, var(--mantine-color-${name}-6, ${raw}))`
}

function resolveRadius(value: StyleValue): string | undefined {
    if (value === undefined || value === null) return undefined
    if (typeof value === 'number') return `${value}px`
    if (value in RADIUS) return RADIUS[value]
    return value
}

function resolveFontSize(value: StyleValue): string | undefined {
    if (value === undefined || value === null) return undefined
    if (typeof value === 'number') return `${value}px`
    if (value in FONT_SIZE) return FONT_SIZE[value]
    return value
}

const STYLE_KEYS = [
    'm',
    'mx',
    'my',
    'mt',
    'mb',
    'ml',
    'mr',
    'ms',
    'me',
    'p',
    'px',
    'py',
    'pt',
    'pb',
    'pl',
    'pr',
    'ps',
    'pe',
    'w',
    'h',
    'miw',
    'maw',
    'mih',
    'mah',
    'c',
    'bg',
    'bd',
    'bdrs',
    'fz',
    'fw',
    'ff',
    'ta',
    'lh',
    'lts',
    'tt',
    'td',
    'pos',
    'top',
    'left',
    'right',
    'bottom',
    'inset',
    'display',
    'flex',
    'gap',
    'rowGap',
    'columnGap',
    'justify',
    'align',
    'wrap',
    'direction',
    'opacity',
    'overflow',
    'overflowX',
    'overflowY',
    'hiddenFrom',
    'visibleFrom',
    'mod',
    'classNames',
    'styles',
    'vars',
    'unstyled',
    'variant',
    'size',
    'radius',
    'color',
    'autoContrast'
] as const

export type ExtractedStyleProps = Record<string, any>

export function splitStyleProps<T extends Record<string, any>>(
    props: T
): { styleProps: ExtractedStyleProps; rest: Omit<T, (typeof STYLE_KEYS)[number]> } {
    const styleProps: ExtractedStyleProps = {}
    const rest: Record<string, any> = {}
    for (const [key, value] of Object.entries(props)) {
        if ((STYLE_KEYS as readonly string[]).includes(key)) styleProps[key] = value
        else rest[key] = value
    }
    return { styleProps, rest: rest as Omit<T, (typeof STYLE_KEYS)[number]> }
}

export function stylePropsToCss(props: ExtractedStyleProps, extra?: CSSProperties): CSSProperties {
    const style: CSSProperties = { ...extra }
    const assign = (key: keyof CSSProperties, value: string | undefined) => {
        if (value !== undefined) (style as any)[key] = value
    }

    assign('margin', resolveSpacing(props.m))
    assign('marginInline', resolveSpacing(props.mx))
    assign('marginBlock', resolveSpacing(props.my))
    assign('marginTop', resolveSpacing(props.mt))
    assign('marginBottom', resolveSpacing(props.mb))
    assign('marginLeft', resolveSpacing(props.ml ?? props.ms))
    assign('marginRight', resolveSpacing(props.mr ?? props.me))
    assign('padding', resolveSpacing(props.p))
    assign('paddingInline', resolveSpacing(props.px))
    assign('paddingBlock', resolveSpacing(props.py))
    assign('paddingTop', resolveSpacing(props.pt))
    assign('paddingBottom', resolveSpacing(props.pb))
    assign('paddingLeft', resolveSpacing(props.pl ?? props.ps))
    assign('paddingRight', resolveSpacing(props.pr ?? props.pe))
    assign('width', resolveSpacing(props.w))
    assign('height', resolveSpacing(props.h))
    assign('minWidth', resolveSpacing(props.miw))
    assign('maxWidth', resolveSpacing(props.maw))
    assign('minHeight', resolveSpacing(props.mih))
    assign('maxHeight', resolveSpacing(props.mah))
    assign('color', resolveColor(props.c))
    assign('background', resolveColor(props.bg))
    assign('borderRadius', resolveRadius(props.bdrs ?? props.radius))
    assign('fontSize', resolveFontSize(props.fz ?? (typeof props.size === 'string' ? props.size : undefined)))
    if (props.fw !== undefined) style.fontWeight = props.fw as CSSProperties['fontWeight']
    if (props.ff) style.fontFamily = String(props.ff)
    if (props.ta) style.textAlign = props.ta as CSSProperties['textAlign']
    if (props.lh) style.lineHeight = props.lh as CSSProperties['lineHeight']
    if (props.lts) style.letterSpacing = resolveSpacing(props.lts)
    if (props.tt) style.textTransform = props.tt as CSSProperties['textTransform']
    if (props.td) style.textDecoration = String(props.td)
    if (props.pos) style.position = props.pos as CSSProperties['position']
    if (props.top !== undefined) style.top = resolveSpacing(props.top)
    if (props.left !== undefined) style.left = resolveSpacing(props.left)
    if (props.right !== undefined) style.right = resolveSpacing(props.right)
    if (props.bottom !== undefined) style.bottom = resolveSpacing(props.bottom)
    if (props.inset !== undefined) style.inset = resolveSpacing(props.inset)
    const display = unwrapResponsive(props.display)
    if (typeof display === 'string') style.display = display
    if (props.flex !== undefined) style.flex = String(props.flex)
    if (props.gap !== undefined) style.gap = resolveSpacing(props.gap)
    if (props.rowGap !== undefined) style.rowGap = resolveSpacing(props.rowGap)
    if (props.columnGap !== undefined) style.columnGap = resolveSpacing(props.columnGap)
    if (props.justify) style.justifyContent = mapJustify(props.justify)
    if (props.align) style.alignItems = mapAlign(props.align)
    if (props.wrap) style.flexWrap = props.wrap as CSSProperties['flexWrap']
    if (props.direction) style.flexDirection = props.direction as CSSProperties['flexDirection']
    if (props.opacity !== undefined) style.opacity = Number(props.opacity)
    if (props.overflow) style.overflow = props.overflow
    if (props.overflowX) style.overflowX = props.overflowX
    if (props.overflowY) style.overflowY = props.overflowY
    if (props.bd) style.border = String(props.bd)

    return style
}

function mapJustify(value: string): CSSProperties['justifyContent'] {
    if (value === 'apart') return 'space-between'
    if (value === 'between') return 'space-between'
    if (value === 'around') return 'space-around'
    if (value === 'evenly') return 'space-evenly'
    return value as CSSProperties['justifyContent']
}

function mapAlign(value: string): CSSProperties['alignItems'] {
    if (value === 'apart') return 'stretch'
    return value as CSSProperties['alignItems']
}

export function mergeClassNames(
    className?: string,
    classNames?: { root?: string } | string,
    extra?: string
): string | undefined {
    const fromNames = typeof classNames === 'string' ? classNames : classNames?.root
    return [className, fromNames, extra].filter(Boolean).join(' ') || undefined
}

export function asNode(value: ReactNode): ReactNode {
    return value
}
