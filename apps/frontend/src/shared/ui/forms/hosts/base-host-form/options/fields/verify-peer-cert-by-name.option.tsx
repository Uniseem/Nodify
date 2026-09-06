import { TextInput } from '@shared/heroui-compat'

import { useSettingsRowControl } from '@shared/ui/settings-row'

import { useHostFormData } from '../host-form-data.context'

export function VerifyPeerCertByNameOption() {
    const { form } = useHostFormData()
    const rowControl = useSettingsRowControl()

    return (
        <TextInput
            key={form.key('verifyPeerCertByName')}
            w="100%"
            {...rowControl}
            {...form.getInputProps('verifyPeerCertByName')}
        />
    )
}
