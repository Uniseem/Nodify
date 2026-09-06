import { ActionIcon, ActionIconGroup, Tooltip } from '@shared/heroui-compat'
import { spotlight } from '@shared/heroui-compat'
import { useTranslation } from 'react-i18next'
import { TbSearch } from 'react-icons/tb'

export const UniversalSpotlightActionIconShared = () => {
    const { t } = useTranslation()

    return (
        <ActionIconGroup>
            <Tooltip label={t('common.action.search')}>
                <ActionIcon color="gray" onClick={spotlight.open} size="input-md" variant="soft">
                    <TbSearch size="24px" />
                </ActionIcon>
            </Tooltip>
        </ActionIconGroup>
    )
}
