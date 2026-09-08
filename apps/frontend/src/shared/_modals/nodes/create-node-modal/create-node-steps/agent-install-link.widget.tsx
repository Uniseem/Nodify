import { Link } from 'react-router'
import { Stack, Text } from '@shared/heroui-compat'

interface IProps {
    getValues: () => { countryCode?: string; name?: string; port?: number }
    onAddressReported: (address: string) => void
}

export const AgentInstallLinkWidget = (_props: IProps) => (
    <Stack gap="sm">
        <Text>新服务器请通过 Nodify Agent 接入。一次性令牌、安装命令与认证状态统一在服务器页面管理。</Text>
        <Link to="/dashboard/nodify/servers">前往服务器接入 →</Link>
        <Text size="sm" c="dimmed">此处的手动连接设置保留给显式配置的旧 HTTP API 模式。</Text>
    </Stack>
)