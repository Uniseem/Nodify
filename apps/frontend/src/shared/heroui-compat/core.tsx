import {
    Alert as HeroAlert,
    Avatar as HeroAvatar,
    Badge as HeroBadge,
    Breadcrumbs as HeroBreadcrumbs,
    Button as HeroButton,
    Card as HeroCard,
    Checkbox as HeroCheckbox,
    Chip as HeroChip,
    CloseButton as HeroCloseButton,
    Input as HeroInput,
    Label,
    Link as HeroLink,
    Modal as HeroModal,
    Drawer as HeroDrawer,
    ProgressBar,
    Select as HeroSelect,
    Separator,
    Skeleton as HeroSkeleton,
    Spinner,
    Surface,
    Switch as HeroSwitch,
    Tabs as HeroTabs,
    TextArea as HeroTextArea,
    TextField,
    Tooltip as HeroTooltip,
    Typography,
    Dropdown,
    ListBox,
    ListBoxItem
} from '@heroui/react'
import {
    Children,
    cloneElement,
    createContext,
    forwardRef,
    isValidElement,
    useContext,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode
} from 'react'
import { mergeClassNames, resolveColor, resolveSpacing, splitStyleProps, stylePropsToCss } from './style-props'

type AnyProps = Record<string, any>

function pickBoxProps(props: AnyProps) {
    const {
        style,
        className,
        classNames,
        component,
        children,
        hiddenFrom,
        visibleFrom,
        ...other
    } = props
    const { styleProps, rest } = splitStyleProps(other)
    return {
        Component: (component || 'div') as any,
        style: stylePropsToCss(styleProps, style),
        className: mergeClassNames(className, classNames),
        children,
        rest,
        hiddenFrom,
        visibleFrom
    }
}

export const Box = forwardRef<any, AnyProps>(function Box(props, ref) {
    const { Component, style, className, children, rest } = pickBoxProps(props)
    return (
        <Component ref={ref} className={className} style={style} {...rest}>
            {children}
        </Component>
    )
})

function FlexBox(
    display: CSSProperties['display'],
    defaults: CSSProperties = {}
) {
    return forwardRef<any, AnyProps>(function FlexLike(props, ref) {
        const { Component, style, className, children, rest } = pickBoxProps({
            ...props,
            display: props.display ?? display
        })
        return (
            <Component ref={ref} className={className} style={{ ...defaults, ...style }} {...rest}>
                {children}
            </Component>
        )
    })
}

export const Group = FlexBox('flex', { alignItems: 'center' })
export const Stack = FlexBox('flex', { flexDirection: 'column' })
export const Flex = FlexBox('flex')
export const Center = FlexBox('flex', { alignItems: 'center', justifyContent: 'center' })

export const SimpleGrid = forwardRef<any, AnyProps>(function SimpleGrid(props, ref) {
    const { cols = 1, spacing = 'md', verticalSpacing, ...other } = props
    const { Component, style, className, children, rest } = pickBoxProps(other)
    const columnCount = typeof cols === 'number' ? cols : cols?.base || 1
    return (
        <Component
            ref={ref}
            className={className}
            style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                gap: resolveSpacing(verticalSpacing ?? spacing),
                columnGap: resolveSpacing(spacing),
                ...style
            }}
            {...rest}
        >
            {children}
        </Component>
    )
})

export const Grid = Object.assign(
    forwardRef<any, AnyProps>(function Grid(props, ref) {
        const { Component, style, className, children, rest } = pickBoxProps(props)
        return (
            <Component ref={ref} className={className} style={{ display: 'grid', ...style }} {...rest}>
                {children}
            </Component>
        )
    }),
    {
        Col: forwardRef<any, AnyProps>(function GridCol(props, ref) {
            const { span, ...other } = props
            const { Component, style, className, children, rest } = pickBoxProps(other)
            return (
                <Component
                    ref={ref}
                    className={className}
                    style={{ gridColumn: span ? `span ${span}` : undefined, ...style }}
                    {...rest}
                >
                    {children}
                </Component>
            )
        })
    }
)

export const Container = forwardRef<any, AnyProps>(function Container(props, ref) {
    const { size, ...other } = props
    const { Component, style, className, children, rest } = pickBoxProps(other)
    const maxWidth = size === 'xs' ? 540 : size === 'sm' ? 720 : size === 'md' ? 960 : size === 'xl' ? 1400 : 1140
    return (
        <Component ref={ref} className={className} style={{ width: '100%', maxWidth, marginInline: 'auto', ...style }} {...rest}>
            {children}
        </Component>
    )
})

export const Paper = forwardRef<any, AnyProps>(function Paper(props, ref) {
    const { withBorder, shadow, ...other } = props
    const { style, className, children, rest } = pickBoxProps(other)
    return (
        <Surface
            ref={ref}
            className={mergeClassNames(className, undefined, 'rounded-xl bg-surface text-foreground')}
            style={{
                border: withBorder ? '1px solid var(--border)' : undefined,
                boxShadow: shadow ? 'var(--shadow-md, 0 8px 24px rgba(0,0,0,.24))' : undefined,
                ...style
            }}
            {...rest}
        >
            {children}
        </Surface>
    )
})

const CardSection = forwardRef<any, AnyProps>(function CardSection(props, ref) {
    const { withBorder, inheritPadding, ...other } = props
    const { style, className, children, rest } = pickBoxProps(other)
    return (
        <div
            ref={ref}
            className={className}
            style={{
                padding: inheritPadding === false ? 0 : '0.75rem 1rem',
                borderBottom: withBorder ? '1px solid var(--border)' : undefined,
                ...style
            }}
            {...rest}
        >
            {children}
        </div>
    )
})

export const Card = Object.assign(
    forwardRef<any, AnyProps>(function Card(props, ref) {
        const { withBorder, padding, shadow, ...other } = props
        const { style, className, children, rest } = pickBoxProps(other)
        return (
            <HeroCard
                ref={ref}
                className={className}
                style={{
                    padding: resolveSpacing(padding ?? 'md'),
                    border: withBorder ? '1px solid var(--border)' : undefined,
                    ...style
                }}
                {...rest}
            >
                {children}
            </HeroCard>
        )
    }),
    { Section: CardSection }
)

export const Text = forwardRef<any, AnyProps>(function Text(props, ref) {
    const { span, truncate, lineClamp, inherit, ...other } = props
    const { style, className, children, rest } = pickBoxProps(other)
    const Component = span || inherit ? 'span' : 'p'
    return (
        <Component
            ref={ref}
            className={className}
            style={{
                margin: inherit ? undefined : 0,
                overflow: truncate || lineClamp ? 'hidden' : undefined,
                textOverflow: truncate ? 'ellipsis' : undefined,
                whiteSpace: truncate ? 'nowrap' : undefined,
                display: lineClamp ? '-webkit-box' : undefined,
                WebkitLineClamp: lineClamp,
                WebkitBoxOrient: lineClamp ? 'vertical' : undefined,
                ...style
            }}
            {...rest}
        >
            {children}
        </Component>
    )
})

export const Title = forwardRef<any, AnyProps>(function Title(props, ref) {
    const { order = 2, ...other } = props
    const { style, className, children, rest } = pickBoxProps(other)
    const Component = (`h${order}` as 'h1') || 'h2'
    return (
        <Component ref={ref} className={className} style={{ margin: 0, fontWeight: 600, ...style }} {...rest}>
            {children}
        </Component>
    )
})

export const Anchor = forwardRef<any, AnyProps>(function Anchor(props, ref) {
    const { style, className, children, rest } = pickBoxProps(props)
    return (
        <HeroLink ref={ref} className={className} style={style} {...rest}>
            {children}
        </HeroLink>
    )
})

export const Code = forwardRef<any, AnyProps>(function Code(props, ref) {
    const { block, ...other } = props
    const { style, className, children, rest } = pickBoxProps(other)
    const Component = block ? 'pre' : 'code'
    return (
        <Component
            ref={ref}
            className={mergeClassNames(className, undefined, 'rounded-md bg-default px-1.5 py-0.5 font-mono text-sm')}
            style={style}
            {...rest}
        >
            {children}
        </Component>
    )
})

function mapButtonVariant(variant?: string, color?: string) {
    if (color === 'red' && (variant === 'filled' || !variant)) return 'danger'
    if (color === 'red' && variant === 'light') return 'danger-soft'
    if (variant === 'outline') return 'outline'
    if (variant === 'subtle' || variant === 'transparent' || variant === 'white') return 'ghost'
    if (variant === 'light' || variant === 'default') return 'secondary'
    if (variant === 'filled') return 'primary'
    return 'secondary'
}

function mapSize(size?: string) {
    if (size === 'xs' || size === 'sm') return 'sm'
    if (size === 'lg' || size === 'xl') return 'lg'
    return 'md'
}

export const Button = forwardRef<any, AnyProps>(function Button(props, ref) {
    const {
        leftSection,
        rightSection,
        loading,
        loaderProps,
        fullWidth,
        disabled,
        onClick,
        type,
        children,
        variant,
        color,
        size,
        ...other
    } = props
    const { style, className, rest } = pickBoxProps(other)
    return (
        <HeroButton
            ref={ref}
            className={className}
            fullWidth={fullWidth}
            isDisabled={disabled}
            isPending={loading}
            onClick={onClick}
            onPress={onClick}
            size={mapSize(size)}
            style={style}
            type={type}
            variant={mapButtonVariant(variant, color)}
            {...rest}
        >
            {leftSection}
            {children}
            {rightSection}
        </HeroButton>
    )
})

export const ActionIcon = Object.assign(
    forwardRef<any, AnyProps>(function ActionIcon(props, ref) {
    const { children, loading, disabled, onClick, variant, color, size, ...other } = props
    const { style, className, rest } = pickBoxProps(other)
    return (
        <HeroButton
            ref={ref}
            aria-label={props['aria-label'] || 'action'}
            className={className}
            isDisabled={disabled}
            isIconOnly
            isPending={loading}
            onClick={onClick}
            onPress={onClick}
            size={mapSize(size)}
            style={style}
            variant={mapButtonVariant(variant, color)}
            {...rest}
        >
            {children}
        </HeroButton>
    )
    }),
    { Group }
)
export const ActionIconGroup = Group
export const UnstyledButton = forwardRef<any, AnyProps>(function UnstyledButton(props, ref) {
    const { onClick, children, ...other } = props
    const { style, className, rest } = pickBoxProps(other)
    return (
        <button
            ref={ref}
            className={className}
            onClick={onClick}
            style={{ background: 'none', border: 0, padding: 0, color: 'inherit', cursor: 'pointer', ...style }}
            type="button"
            {...rest}
        >
            {children}
        </button>
    )
})

export const CloseButton = forwardRef<any, AnyProps>(function CloseButton(props, ref) {
    const { onClick, ...other } = props
    const { style, className, rest } = pickBoxProps(other)
    return <HeroCloseButton ref={ref} className={className} onPress={onClick} style={style} {...rest} />
})

export function CopyButton({ value, children, timeout = 1500 }: { value?: any; children: (state: any) => any; timeout?: number }) {
    const [copied, setCopied] = useState(false)
    const copy = async () => {
        await navigator.clipboard.writeText(String(value ?? ''))
        setCopied(true)
        window.setTimeout(() => setCopied(false), timeout)
    }
    return children({ copied, copy })
}

export function FileButton({ onChange, accept, multiple, children, resetRef }: AnyProps) {
    const inputRef = useRef<HTMLInputElement>(null)
    if (resetRef) resetRef.current = () => {
        if (inputRef.current) inputRef.current.value = ''
    }
    return (
        <>
            {children({ onClick: () => inputRef.current?.click() })}
            <input
                accept={accept}
                hidden
                multiple={multiple}
                onChange={(event) => onChange?.(multiple ? event.target.files : event.target.files?.[0] || null)}
                ref={inputRef}
                type="file"
            />
        </>
    )
}

function FieldShell({
    label,
    description,
    error,
    required,
    children,
    className,
    style
}: AnyProps) {
    return (
        <TextField className={className} fullWidth style={style}>
            {label && (
                <Label>
                    {label}
                    {required ? ' *' : ''}
                </Label>
            )}
            {children}
            {description && <p className="text-xs text-muted">{description}</p>}
            {error && <p className="text-xs text-danger">{error}</p>}
        </TextField>
    )
}

export const TextInput = forwardRef<any, AnyProps>(function TextInput(props, ref) {
    const { label, description, error, required, leftSection, rightSection, onChange, ...other } = props
    const { style, className, rest } = pickBoxProps(other)
    return (
        <FieldShell className={className} description={description} error={error} label={label} required={required} style={style}>
            <div className="flex items-center gap-2">
                {leftSection}
                <HeroInput
                    ref={ref}
                    aria-invalid={Boolean(error)}
                    fullWidth
                    onChange={onChange}
                    required={required}
                    {...rest}
                />
                {rightSection}
            </div>
        </FieldShell>
    )
})

export const PasswordInput = forwardRef<any, AnyProps>(function PasswordInput(props, ref) {
    return <TextInput ref={ref} type="password" {...props} />
})

export const NumberInput = forwardRef<any, AnyProps>(function NumberInput(props, ref) {
    const { handlersRef, onChange, value, min, max, step, clampBehavior, hideControls, ...other } = props
    const inner = useRef<HTMLInputElement>(null)
    const apply = (next: number) => {
        const clamped = Math.min(max ?? next, Math.max(min ?? next, next))
        onChange?.(clamped)
    }
    if (handlersRef) {
        handlersRef.current = {
            increment: () => apply(Number(value || 0) + Number(step || 1)),
            decrement: () => apply(Number(value || 0) - Number(step || 1))
        }
    }
    return (
        <TextInput
            ref={(node: any) => {
                inner.current = node
                if (typeof ref === 'function') ref(node)
                else if (ref) ref.current = node
            }}
            onChange={(event: any) => {
                const next = event?.target ? event.target.value : event
                onChange?.(next === '' ? '' : Number(next))
            }}
            type="number"
            value={value ?? ''}
            {...other}
        />
    )
})

export const Textarea = forwardRef<any, AnyProps>(function Textarea(props, ref) {
    const { label, description, error, required, autosize, minRows, maxRows, ...other } = props
    const { style, className, rest } = pickBoxProps(other)
    return (
        <FieldShell className={className} description={description} error={error} label={label} required={required} style={style}>
            <HeroTextArea ref={ref} aria-invalid={Boolean(error)} fullWidth rows={minRows} {...rest} />
        </FieldShell>
    )
})

function normalizeSelectData(data: any[] = []) {
    return data.map((item) =>
        typeof item === 'string' ? { value: item, label: item } : { value: String(item.value), label: item.label ?? item.value }
    )
}

export const Select = forwardRef<any, AnyProps>(function Select(props, ref) {
    const { data = [], value, onChange, label, description, error, required, searchable, clearable, nothingFound, ...other } =
        props
    const items = normalizeSelectData(data)
    const { style, className, rest } = pickBoxProps(other)
    return (
        <FieldShell className={className} description={description} error={error} label={label} required={required} style={style}>
            <HeroSelect
                ref={ref}
                fullWidth
                onSelectionChange={(key) => onChange?.(key == null ? null : String(key))}
                selectedKey={value ?? null}
                {...rest}
            >
                <HeroSelect.Trigger>
                    <HeroSelect.Value />
                    <HeroSelect.Indicator />
                </HeroSelect.Trigger>
                <HeroSelect.Popover>
                    <ListBox>
                        {items.map((item) => (
                            <ListBoxItem id={item.value} key={item.value} textValue={item.label}>
                                {item.label}
                            </ListBoxItem>
                        ))}
                    </ListBox>
                </HeroSelect.Popover>
            </HeroSelect>
            {items.length === 0 && nothingFound}
        </FieldShell>
    )
})

export const NativeSelect = forwardRef<any, AnyProps>(function NativeSelect(props, ref) {
    const { data = [], ...other } = props
    const items = normalizeSelectData(data)
    return (
        <TextInput component="select" ref={ref} {...other}>
            {items.map((item) => (
                <option key={item.value} value={item.value}>
                    {item.label}
                </option>
            ))}
        </TextInput>
    )
})

export const Checkbox = Object.assign(
    forwardRef<any, AnyProps>(function Checkbox(props, ref) {
        const { label, description, checked, onChange, ...other } = props
        const { style, className, rest } = pickBoxProps(other)
        return (
            <label className={mergeClassNames(className, undefined, 'flex items-start gap-2')} style={style}>
                <HeroCheckbox
                    ref={ref}
                    isSelected={checked}
                    onChange={(selected) => onChange?.({ currentTarget: { checked: selected }, target: { checked: selected } })}
                    {...rest}
                />
                <span>
                    {label}
                    {description && <div className="text-xs text-muted">{description}</div>}
                </span>
            </label>
        )
    }),
    {
        Card: ({ children, ...other }: AnyProps) => {
            const { className, style, rest } = pickBoxProps(other)
            return (
                <label className={mergeClassNames(className, undefined, 'flex cursor-pointer items-center gap-2 rounded-xl border border-border p-3')} style={style} {...rest}>
                    {children}
                </label>
            )
        },
        Indicator: (props: AnyProps) => <HeroCheckbox {...props} />,
        Group: ({ value = [], onChange, children }: AnyProps) => (
            <div className="flex flex-col gap-2">
                {Children.map(children, (child) => {
                    if (!isValidElement(child)) return child
                    const childValue = (child as any).props.value
                    return cloneElement(child as any, {
                        checked: value.includes(childValue),
                        onChange: (event: any) => {
                            const next = event.currentTarget.checked
                                ? [...value, childValue]
                                : value.filter((item: string) => item !== childValue)
                            onChange?.(next)
                        }
                    })
                })}
            </div>
        )
    }
)

export const Switch = forwardRef<any, AnyProps>(function Switch(props, ref) {
    const { label, checked, onChange, ...other } = props
    const { style, className, rest } = pickBoxProps(other)
    return (
        <label className={mergeClassNames(className, undefined, 'inline-flex items-center gap-2')} style={style}>
            <HeroSwitch
                ref={ref}
                isSelected={checked}
                onChange={(selected) => onChange?.({ currentTarget: { checked: selected }, target: { checked: selected } })}
                {...rest}
            />
            {label}
        </label>
    )
})

export const Badge = forwardRef<any, AnyProps>(function Badge(props, ref) {
    const { children, variant, color, ...other } = props
    const { style, className, rest } = pickBoxProps(other)
    return (
        <HeroBadge
            ref={ref}
            className={className}
            style={{ background: resolveColor(color), ...style }}
            variant={variant === 'filled' ? 'primary' : 'secondary'}
            {...rest}
        >
            {children}
        </HeroBadge>
    )
})

export const ThemeIcon = forwardRef<any, AnyProps>(function ThemeIcon(props, ref) {
    const { children, variant, color, size = 28, ...other } = props
    const { style, className, rest } = pickBoxProps(other)
    const dimension = typeof size === 'number' ? size : size === 'lg' ? 36 : 28
    return (
        <span
            ref={ref}
            className={mergeClassNames(className, undefined, 'inline-flex items-center justify-center rounded-lg')}
            style={{
                width: dimension,
                height: dimension,
                background: variant === 'transparent' ? 'transparent' : resolveColor(color),
                color: variant === 'filled' ? '#fff' : resolveColor(color),
                ...style
            }}
            {...rest}
        >
            {children}
        </span>
    )
})

export const Alert = forwardRef<any, AnyProps>(function Alert(props, ref) {
    const { title, children, icon, color, ...other } = props
    const { style, className, rest } = pickBoxProps(other)
    return (
        <HeroAlert ref={ref} className={className} status={color === 'red' ? 'danger' : 'accent'} style={style} {...rest}>
            {icon && <HeroAlert.Indicator>{icon}</HeroAlert.Indicator>}
            <HeroAlert.Content>
                {title && <HeroAlert.Title>{title}</HeroAlert.Title>}
                <HeroAlert.Description>{children}</HeroAlert.Description>
            </HeroAlert.Content>
        </HeroAlert>
    )
})

export const Tooltip = ({ label, children, disabled }: AnyProps) => {
    if (disabled || !label) return children
    return (
        <HeroTooltip delay={200}>
            <HeroTooltip.Trigger>{children}</HeroTooltip.Trigger>
            <HeroTooltip.Content>{label}</HeroTooltip.Content>
        </HeroTooltip>
    )
}

export const Loader = ({ size = 'sm' }: AnyProps) => <Spinner size={mapSize(String(size))} />
const ProgressSection = ({ value = 0, color, ...other }: AnyProps) => {
    const { style, className } = pickBoxProps(other)
    return (
        <div
            className={className}
            style={{
                width: `${value}%`,
                height: '100%',
                background: resolveColor(color) || 'var(--accent)',
                ...style
            }}
        />
    )
}
const ProgressRoot = ({ children, ...other }: AnyProps) => {
    const { style, className, rest } = pickBoxProps(other)
    return (
        <div className={mergeClassNames(className, undefined, 'flex h-2 overflow-hidden rounded-full bg-default')} style={style} {...rest}>
            {children}
        </div>
    )
}
export const Progress = Object.assign(
    ({ value = 0, striped, animated, ...other }: AnyProps) => {
        const { style, className, rest } = pickBoxProps(other)
        return (
            <ProgressBar aria-label="progress" className={className} style={style} value={value} {...rest}>
                <ProgressBar.Track>
                    <ProgressBar.Fill />
                </ProgressBar.Track>
            </ProgressBar>
        )
    },
    { Root: ProgressRoot, Section: ProgressSection }
)
export const Skeleton = ({ height, width, circle, ...other }: AnyProps) => {
    const { style, className, rest } = pickBoxProps(other)
    return (
        <HeroSkeleton
            className={className}
            style={{
                height: resolveSpacing(height) || 16,
                width: resolveSpacing(width) || '100%',
                borderRadius: circle ? 999 : undefined,
                ...style
            }}
            {...rest}
        />
    )
}

export const LoadingOverlay = ({ visible, children }: AnyProps) => (
    <div className="relative">
        {children}
        {visible && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
                <Spinner />
            </div>
        )}
    </div>
)

export const Image = forwardRef<any, AnyProps>(function Image(props, ref) {
    const { fit, ...other } = props
    const { style, className, rest } = pickBoxProps(other)
    return <img alt="" className={className} ref={ref} style={{ objectFit: fit, ...style }} {...rest} />
})

export const Avatar = ({ src, alt, children, ...other }: AnyProps) => {
    const { style, className, rest } = pickBoxProps(other)
    return (
        <HeroAvatar className={className} style={style} {...rest}>
            {src ? <img alt={alt} src={src} /> : children}
        </HeroAvatar>
    )
}

export const Divider = ({ orientation = 'horizontal', ...other }: AnyProps) => {
    const { style, className, rest } = pickBoxProps(other)
    return <Separator className={className} orientation={orientation} style={style} {...rest} />
}

export const Breadcrumbs = ({ children, ...other }: AnyProps) => {
    const { style, className, rest } = pickBoxProps(other)
    return (
        <HeroBreadcrumbs className={className} style={style} {...rest}>
            {children}
        </HeroBreadcrumbs>
    )
}

export const List = Object.assign(
    ({ children, ...other }: AnyProps) => {
        const { style, className, rest } = pickBoxProps(other)
        return (
            <ul className={className} style={style} {...rest}>
                {children}
            </ul>
        )
    },
    {
        Item: ({ children, ...other }: AnyProps) => {
            const { style, className, rest } = pickBoxProps(other)
            return (
                <li className={className} style={style} {...rest}>
                    {children}
                </li>
            )
        }
    }
)

export const Indicator = ({ children, disabled, label, color, ...other }: AnyProps) => {
    const { style, className } = pickBoxProps(other)
    return (
        <span className={mergeClassNames(className, undefined, 'relative inline-flex')} style={style}>
            {children}
            {!disabled && (
                <span
                    className="absolute -right-1 -top-1 min-w-4 rounded-full px-1 text-[10px] text-white"
                    style={{ background: resolveColor(color) || 'var(--accent)' }}
                >
                    {label}
                </span>
            )}
        </span>
    )
}

export const Affix = ({ children, position, ...other }: AnyProps) => {
    const { style, className, rest } = pickBoxProps(other)
    return (
        <div className={className} style={{ position: 'fixed', zIndex: 200, ...position, ...style }} {...rest}>
            {children}
        </div>
    )
}

export const Collapse = ({ in: opened, children }: AnyProps) => (opened ? <>{children}</> : null)
export const Transition = ({ mounted, children }: AnyProps) => (mounted ? children({}) : null)

export const ScrollArea = Object.assign(
    forwardRef<any, AnyProps>(function ScrollArea(props, ref) {
        const { type, offsetScrollbars, scrollbarSize, ...other } = props
        const { style, className, children, rest } = pickBoxProps(other)
        return (
            <div ref={ref} className={className} style={{ overflow: 'auto', ...style }} {...rest}>
                {children}
            </div>
        )
    }),
    {
        Autosize: forwardRef<any, AnyProps>(function ScrollAreaAutosize(props, ref) {
            return <ScrollArea ref={ref} {...props} />
        })
    }
)
export const ScrollAreaAutosize = ScrollArea.Autosize

const OverlayContext = createContext<{ opened: boolean; onClose: () => void }>({
    opened: false,
    onClose: () => undefined
})

function OverlayRoot({
    opened,
    onClose,
    children,
    kind
}: {
    opened?: boolean
    onClose?: () => void
    children: ReactNode
    kind: 'modal' | 'drawer'
}) {
    const value = useMemo(() => ({ opened: Boolean(opened), onClose: onClose || (() => undefined) }), [opened, onClose])
    if (!opened) return null
    const Overlay = kind === 'modal' ? HeroModal : HeroDrawer
    return (
        <OverlayContext.Provider value={value}>
            <Overlay>
                <Overlay.Backdrop isOpen={opened} onOpenChange={(open: boolean) => !open && onClose?.()}>
                    {kind === 'modal' ? (
                        <HeroModal.Container>
                            <HeroModal.Dialog>{children}</HeroModal.Dialog>
                        </HeroModal.Container>
                    ) : (
                        <HeroDrawer.Content placement="right">
                            <HeroDrawer.Dialog>{children}</HeroDrawer.Dialog>
                        </HeroDrawer.Content>
                    )}
                </Overlay.Backdrop>
            </Overlay>
        </OverlayContext.Provider>
    )
}

function createOverlay(kind: 'modal' | 'drawer') {
    const Root = ({ opened, onClose, children }: AnyProps) => (
        <OverlayRoot kind={kind} opened={opened} onClose={onClose}>
            {children}
        </OverlayRoot>
    )
    const Overlay = (_props: AnyProps) => null
    const Content = ({ children, className, style }: AnyProps) => (
        <div className={className} style={style}>
            {children}
        </div>
    )
    const Header = ({ children, className }: AnyProps) => (
        <div className={mergeClassNames(className, undefined, 'mb-3 flex items-center justify-between gap-3')}>{children}</div>
    )
    const Title = ({ children }: AnyProps) => <div className="text-lg font-semibold">{children}</div>
    const Body = ({ children, className }: AnyProps) => <div className={className}>{children}</div>
    const Close = (props: AnyProps) => {
        const { onClose } = useContext(OverlayContext)
        return <CloseButton onClick={onClose} {...props} />
    }

    const Simple = ({ opened, onClose, title, children, ...other }: AnyProps) => (
        <Root opened={opened} onClose={onClose} {...other}>
            <Header>
                <Title>{title}</Title>
                <Close />
            </Header>
            <Body>{children}</Body>
        </Root>
    )

    return Object.assign(Simple, {
        Root,
        Overlay,
        Content,
        Header,
        Title,
        Body,
        CloseButton: Close
    })
}

export const Modal = createOverlay('modal')
export const Drawer = createOverlay('drawer')
export const DrawerOverlay = Drawer.Overlay

export const Menu = Object.assign(
    ({ children }: AnyProps) => {
        const items: ReactNode[] = []
        let trigger: ReactNode = null
        Children.forEach(children, (child) => {
            if (!isValidElement(child)) return
            if (child.type === MenuTarget) trigger = (child as any).props.children
            if (child.type === MenuDropdown) items.push((child as any).props.children)
        })
        return (
            <Dropdown>
                <Dropdown.Trigger>{trigger}</Dropdown.Trigger>
                <Dropdown.Popover>
                    <Dropdown.Menu>{items}</Dropdown.Menu>
                </Dropdown.Popover>
            </Dropdown>
        )
    },
    {
        Target: MenuTarget,
        Dropdown: MenuDropdown,
        Item: MenuItem,
        Divider: () => <Separator />,
        Label: ({ children }: AnyProps) => <div className="px-2 py-1 text-xs text-muted">{children}</div>
    }
)

function MenuTarget({ children }: AnyProps) {
    return children
}
function MenuDropdown({ children }: AnyProps) {
    return children
}
function MenuItem({ children, leftSection, rightSection, onClick, color, disabled }: AnyProps) {
    return (
        <Dropdown.Item isDisabled={disabled} onAction={onClick} textValue={typeof children === 'string' ? children : 'item'}>
            <span className="flex items-center gap-2" style={{ color: color === 'red' ? 'var(--danger)' : undefined }}>
                {leftSection}
                {children}
                {rightSection}
            </span>
        </Dropdown.Item>
    )
}

const TabsContext = createContext<{ value?: string; onChange?: (value: string) => void }>({})

export const Tabs = Object.assign(
    ({ value, defaultValue, onChange, children, ...other }: AnyProps) => {
        const { style, className, rest } = pickBoxProps(other)
        return (
            <TabsContext.Provider value={{ value: value ?? defaultValue, onChange }}>
                <HeroTabs
                    className={className}
                    onSelectionChange={(key) => onChange?.(String(key))}
                    selectedKey={value ?? defaultValue}
                    style={style}
                    {...rest}
                >
                    {children}
                </HeroTabs>
            </TabsContext.Provider>
        )
    },
    {
        List: ({ children, ...other }: AnyProps) => {
            const { className, style, rest } = pickBoxProps(other)
            return (
                <HeroTabs.ListContainer className={className} style={style} {...rest}>
                    <HeroTabs.List>{children}</HeroTabs.List>
                </HeroTabs.ListContainer>
            )
        },
        Tab: ({ value, children, leftSection, rightSection, ...other }: AnyProps) => {
            const { className, style, rest } = pickBoxProps(other)
            return (
                <HeroTabs.Tab className={className} id={value} style={style} {...rest}>
                    {leftSection}
                    {children}
                    {rightSection}
                </HeroTabs.Tab>
            )
        },
        Panel: ({ value, children, ...other }: AnyProps) => {
            const { className, style, rest } = pickBoxProps(other)
            return (
                <HeroTabs.Panel className={className} id={value} style={style} {...rest}>
                    {children}
                </HeroTabs.Panel>
            )
        }
    }
)

export const Accordion = Object.assign(
    ({ children, ...other }: AnyProps) => {
        const { className, style, rest } = pickBoxProps(other)
        return (
            <div className={className} style={style} {...rest}>
                {children}
            </div>
        )
    },
    {
        Item: ({ children, value }: AnyProps) => <details data-value={value}>{children}</details>,
        Control: ({ children, icon }: AnyProps) => (
            <summary className="flex cursor-pointer list-none items-center gap-2 py-2">
                {icon}
                {children}
            </summary>
        ),
        Panel: ({ children }: AnyProps) => <div className="pb-3">{children}</div>
    }
)

export const Table = Object.assign(
    ({ children, ...other }: AnyProps) => {
        const { className, style, rest } = pickBoxProps(other)
        return (
            <table className={mergeClassNames(className, undefined, 'w-full text-sm')} style={style} {...rest}>
                {children}
            </table>
        )
    },
    {
        Thead: ({ children, ...props }: AnyProps) => <thead {...props}>{children}</thead>,
        Tbody: ({ children, ...props }: AnyProps) => <tbody {...props}>{children}</tbody>,
        Tr: ({ children, ...props }: AnyProps) => <tr {...props}>{children}</tr>,
        Th: ({ children, ...props }: AnyProps) => <th className="text-left" {...props}>{children}</th>,
        Td: ({ children, ...props }: AnyProps) => <td {...props}>{children}</td>,
        ScrollContainer: ({ children }: AnyProps) => <div className="overflow-auto">{children}</div>
    }
)

const AppShellContext = createContext<{ headerHeight: number }>({ headerHeight: 64 })

export const AppShell = Object.assign(
    ({ children, header, navbar, padding, className }: AnyProps) => {
        const headerHeight = header?.height ?? 0
        return (
            <AppShellContext.Provider value={{ headerHeight }}>
                <div
                    className={className}
                    style={{
                        ['--app-shell-header-height' as any]: `${headerHeight}px`,
                        ['--mantine-spacing-md' as any]: '1rem',
                        minHeight: '100vh',
                        padding: padding === 'xl' ? '1.5rem' : resolveSpacing(padding)
                    }}
                >
                    {children}
                </div>
            </AppShellContext.Provider>
        )
    },
    {
        Header: ({ children, className, style }: AnyProps) => {
            const { headerHeight } = useContext(AppShellContext)
            return (
                <header
                    className={className}
                    style={{
                        position: 'fixed',
                        inset: '0 0 auto 0',
                        zIndex: 50,
                        height: headerHeight,
                        ...style
                    }}
                >
                    {children}
                </header>
            )
        },
        Navbar: ({ children, className, style, width }: AnyProps) => (
            <aside className={className} style={{ width: width?.base || width || 280, ...style }}>
                {children}
            </aside>
        ),
        Main: ({ children, className, style, ...other }: AnyProps) => {
            const { style: boxStyle, rest } = pickBoxProps(other)
            return (
                <main className={className} style={{ ...boxStyle, ...style }} {...rest}>
                    {children}
                </main>
            )
        },
        Footer: ({ children, className }: AnyProps) => <footer className={className}>{children}</footer>,
        Section: ({ children }: AnyProps) => <div>{children}</div>
    }
)

export const NavLink = ({ label, leftSection, rightSection, active, onClick, children, ...other }: AnyProps) => {
    const { className, style, rest } = pickBoxProps(other)
    return (
        <button
            className={mergeClassNames(
                className,
                undefined,
                `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${active ? 'bg-default' : ''}`
            )}
            onClick={onClick}
            style={style}
            type="button"
            {...rest}
        >
            {leftSection}
            <span className="flex-1">{label}</span>
            {rightSection}
            {children}
        </button>
    )
}

export const Burger = ({ opened, onClick, ...other }: AnyProps) => (
    <ActionIcon aria-label="menu" onClick={onClick} {...other}>
        {opened ? '✕' : '☰'}
    </ActionIcon>
)

export const SegmentedControl = ({ data = [], value, onChange, ...other }: AnyProps) => {
    const items = normalizeSelectData(data)
    const { className, style, rest } = pickBoxProps(other)
    return (
        <div className={mergeClassNames(className, undefined, 'inline-flex rounded-lg bg-default p-1')} style={style} {...rest}>
            {items.map((item) => (
                <button
                    className={`rounded-md px-3 py-1 text-sm ${value === item.value ? 'bg-surface' : ''}`}
                    key={item.value}
                    onClick={() => onChange?.(item.value)}
                    type="button"
                >
                    {item.label}
                </button>
            ))}
        </div>
    )
}

export const ColorSwatch = ({ color, ...other }: AnyProps) => {
    const { className, style, rest } = pickBoxProps(other)
    return (
        <span
            className={mergeClassNames(className, undefined, 'inline-block size-5 rounded-full')}
            style={{ background: color, ...style }}
            {...rest}
        />
    )
}

export const CheckIcon = (props: AnyProps) => <span {...props}>✓</span>
export const Fieldset = ({ legend, children, ...other }: AnyProps) => {
    const { className, style, rest } = pickBoxProps(other)
    return (
        <fieldset className={className} style={style} {...rest}>
            {legend && <legend>{legend}</legend>}
            {children}
        </fieldset>
    )
}

const InputControl = forwardRef<any, AnyProps>(function InputControl(props, ref) {
    const { leftSection, rightSection, classNames, size, ...other } = props
    const { style, className, rest } = pickBoxProps(other)
    return (
        <div className={mergeClassNames(className, classNames?.wrapper, 'flex items-center gap-2')}>
            {leftSection}
            <HeroInput ref={ref} className={classNames?.input} style={style} {...rest} />
            {rightSection}
        </div>
    )
})

export const Input = Object.assign(InputControl, {
    Wrapper: ({ label, description, error, children }: AnyProps) => (
        <FieldShell description={description} error={error} label={label}>
            {children}
        </FieldShell>
    ),
    Label: ((props: AnyProps) => <Label {...props} />) as any,
    Error: ({ children }: AnyProps) => <p className="text-xs text-danger">{children}</p>,
    Description: ({ children }: AnyProps) => <p className="text-xs text-muted">{children}</p>
})
export const InputBase = TextInput
export const HoverCard = Object.assign(
    ({ children }: AnyProps) => <div>{children}</div>,
    {
        Target: ({ children }: AnyProps) => children,
        Dropdown: ({ children }: AnyProps) => <div>{children}</div>
    }
)
export const Popover = HoverCard
export const Chip = HeroChip
export const TypographyStyles = Typography
export { Typography }

export const RingProgress = ({ sections = [], label, size = 80 }: AnyProps) => (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        {label}
    </div>
)

export type BoxProps = AnyProps
export type ButtonProps = AnyProps
export type ActionIconProps = AnyProps
export type BadgeProps = AnyProps
export type CardProps = AnyProps
export type CardSectionProps = AnyProps
export type CheckboxProps = AnyProps
export type CheckboxCardProps = AnyProps
export type DrawerProps = AnyProps
export type GroupProps = AnyProps
export type InputBaseProps = AnyProps
export type InputWrapperProps = AnyProps
export type ModalProps = AnyProps
export type NumberInputProps = AnyProps
export type NumberInputHandlers = { increment: () => void; decrement: () => void }
export { CardSection }
export type SelectProps = AnyProps
export type ThemeIconProps = AnyProps
export type TitleProps = AnyProps
export type AccordionControlProps = AnyProps
export type ElementProps<T extends string = 'div', _K extends string = never> = AnyProps
export type PolymorphicComponentProps<C, P> = P & AnyProps
export type MantineColor = string
export type DefaultMantineColor = string
export type MantineSize = string
export type MantineSpacing = string | number
export type MantineStyleProp = CSSProperties
export type ComboboxItem = { value: string; label: string }
export type VariantColorsResolver = any
export type RenderTreeNodePayload = any
export type TreeNodeData = any
