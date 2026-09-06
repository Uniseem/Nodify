import { Button, Modal } from '@heroui/react'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ModalRecord = {
    id: string
    title?: ReactNode
    children?: ReactNode
    size?: string
    centered?: boolean
    labels?: { confirm?: string; cancel?: string }
    confirmProps?: Record<string, any>
    cancelProps?: Record<string, any>
    onConfirm?: () => any
    onCancel?: () => void
    withCloseButton?: boolean
}

type ModalsApi = {
    open: (options: Record<string, any>) => string
    openConfirmModal: (options: Record<string, any>) => string
    close: (id?: string) => void
    closeAll: () => void
    updateModal: (options: Record<string, any>) => void
}

const ModalsContext = createContext<ModalsApi | null>(null)
let externalApi: ModalsApi | null = null

function createId() {
    return `modal-${Math.random().toString(36).slice(2, 10)}`
}

export function ModalsProvider({ children }: { children?: ReactNode; modalProps?: any }) {
    const [stack, setStack] = useState<ModalRecord[]>([])

    const api = useMemo<ModalsApi>(
        () => ({
            open(options) {
                const id = options.modalId || createId()
                setStack((current) => [...current, { ...options, id }])
                return id
            },
            openConfirmModal(options) {
                return this.open(options)
            },
            close(id) {
                setStack((current) => (id ? current.filter((item) => item.id !== id) : current.slice(0, -1)))
            },
            closeAll() {
                setStack([])
            },
            updateModal(options) {
                const id = options.modalId || options.id
                if (!id) return
                setStack((current) =>
                    current.map((item) => (item.id === id ? { ...item, ...options } : item))
                )
            }
        }),
        []
    )

    externalApi = api

    return (
        <ModalsContext.Provider value={api}>
            {children}
            {stack.map((item) => (
                <ImperativeModal key={item.id} item={item} onClose={() => api.close(item.id)} />
            ))}
        </ModalsContext.Provider>
    )
}

function ImperativeModal({ item, onClose }: { item: ModalRecord; onClose: () => void }) {
    const hasActions = Boolean(item.onConfirm || item.labels)

    return createPortal(
        <Modal>
            <Modal.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
                <Modal.Container size={mapSize(item.size)}>
                    <Modal.Dialog>
                        {item.withCloseButton !== false && <Modal.CloseTrigger />}
                        {item.title && (
                            <Modal.Header>
                                <Modal.Heading>{item.title}</Modal.Heading>
                            </Modal.Header>
                        )}
                        <Modal.Body>{item.children}</Modal.Body>
                        {hasActions && (
                            <Modal.Footer>
                                <Button
                                    variant="secondary"
                                    onPress={() => {
                                        item.onCancel?.()
                                        onClose()
                                    }}
                                    {...item.cancelProps}
                                >
                                    {item.labels?.cancel || 'Cancel'}
                                </Button>
                                <Button
                                    variant={item.confirmProps?.color === 'red' ? 'danger' : 'primary'}
                                    onPress={async () => {
                                        await item.onConfirm?.()
                                        onClose()
                                    }}
                                    {...item.confirmProps}
                                >
                                    {item.labels?.confirm || 'Confirm'}
                                </Button>
                            </Modal.Footer>
                        )}
                    </Modal.Dialog>
                </Modal.Container>
            </Modal.Backdrop>
        </Modal>,
        document.body
    )
}

function mapSize(size?: string): 'xs' | 'sm' | 'md' | 'lg' | 'cover' | 'full' | undefined {
    if (!size) return 'md'
    if (size === 'xl' || size === 'xxl') return 'lg'
    if (size === 'xs' || size === 'sm' || size === 'md' || size === 'lg' || size === 'cover' || size === 'full') {
        return size
    }
    return 'md'
}

export const modals: ModalsApi = {
    open(options) {
        if (!externalApi) throw new Error('ModalsProvider is missing')
        return externalApi.open(options)
    },
    openConfirmModal(options) {
        if (!externalApi) throw new Error('ModalsProvider is missing')
        return externalApi.openConfirmModal(options)
    },
    close(id) {
        externalApi?.close(id)
    },
    closeAll() {
        externalApi?.closeAll()
    },
    updateModal(options) {
        externalApi?.updateModal(options)
    }
}

export function useModals() {
    const value = useContext(ModalsContext)
    if (!value) throw new Error('useModals must be used within ModalsProvider')
    return value
}
