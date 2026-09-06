import { Box, Center } from '@shared/heroui-compat'
import { Outlet } from 'react-router'

export function AuthLayout() {
    return (
        <Center mih="100vh" p="md">
            <Box maw="25rem">
                <Outlet />
            </Box>
        </Center>
    )
}
