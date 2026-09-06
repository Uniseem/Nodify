import { ActionIcon } from '@shared/heroui-compat'
import { PiUserCircle } from 'react-icons/pi'

import { showModal } from '@shared/_modals/show-modal'

interface IProps {
    userId: number
}

export function ResolveUserActionShared(props: IProps) {
    const { userId } = props

    return (
        <ActionIcon
            onClick={() => showModal('users_viewUserModal', { userId: userId })}
            size="input-sm"
            variant="soft"
        >
            <PiUserCircle size="1.5rem" />
        </ActionIcon>
    )
}
