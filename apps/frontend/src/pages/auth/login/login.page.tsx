import { LoginFormFeature } from "@features/auth/login-form";
import { OAuth2LoginButtonsFeature } from "@features/auth/oauth2-login-button/oauth2-login-button.feature";
import { PasskeyLoginButtonFeature } from "@features/auth/passkey-login-button";
import { RegisterFormFeature } from "@features/auth/register-form";
import { Button, Spinner } from "@heroui/react";
import {
  Box,
  Center,
  Divider,
  Group,
  Image,
  Stack,
  Text,
  Title,
} from "@shared/heroui-compat";
import { GetStatusCommand } from "@remnawave/backend-contract";
import { useMemo } from "react";

import { useGetAuthStatus } from "@shared/api/hooks/auth/auth.query.hooks";
import { Logo, Page } from "@shared/ui";
import { parseColoredTextUtil } from "@shared/utils/misc";

const getAuthMethods = (
  authStatus: GetStatusCommand.Response["response"] | undefined,
) => {
  const isPasswordEnabled =
    authStatus?.authentication?.password?.enabled ?? false;
  const isPasskeyEnabled =
    authStatus?.authentication?.passkey?.enabled ?? false;
  const isOAuth2Enabled =
    Object.values(authStatus?.authentication?.oauth2?.providers ?? {}).some(
      Boolean,
    ) ?? false;

  return {
    isOAuth2Enabled,
    isPasskeyEnabled,
    isPasswordEnabled,
    hasAlternativeMethods: isPasskeyEnabled || isOAuth2Enabled,
    hasPrimaryMethods: isPasswordEnabled,
  };
};

const BrandLogo = ({ logoUrl }: { logoUrl?: null | string }) => {
  if (!logoUrl) {
    return <Logo c="cyan" w="3rem" />;
  }

  return (
    <Image
      alt="logo"
      fit="contain"
      src={logoUrl}
      style={{
        maxWidth: "40px",
        maxHeight: "40px",
        width: "40px",
        height: "40px",
      }}
    />
  );
};

const BrandTitle = ({
  titleParts,
}: {
  titleParts: Array<{ color: string; text: string }>;
}) => {
  return (
    <Title ff="Unbounded" order={1} pos="relative" style={{ color: "#e6edf3" }}>
      {titleParts.map((part, index) => (
        <Text
          c={part.color || "white"}
          component="span"
          fw="inherit"
          fz="inherit"
          inherit
          key={index}
          pos="relative"
          style={{ color: part.color === "cyan" ? "#22d3ee" : "#e6edf3" }}
        >
          {part.text}
        </Text>
      ))}
    </Title>
  );
};

const AlternativeAuthMethods = ({
  authentication,
  isOAuth2Enabled,
  isPasskeyEnabled,
  isPasswordEnabled,
}: {
  authentication: GetStatusCommand.Response["response"]["authentication"];
  isOAuth2Enabled: boolean;
  isPasskeyEnabled: boolean;
  isPasswordEnabled: boolean;
}) => (
  <Center>
    <Stack gap="md" maw={isPasswordEnabled ? 300 : 150} w="100%">
      {isPasskeyEnabled && authentication && (
        <PasskeyLoginButtonFeature authentication={authentication} />
      )}
      {isOAuth2Enabled && authentication && (
        <OAuth2LoginButtonsFeature authentication={authentication} />
      )}
    </Stack>
  </Center>
);

export const LoginPage = () => {
  const {
    data: authStatus,
    isPending,
    isError,
    isFetching,
    refetch,
  } = useGetAuthStatus();

  const titleParts = useMemo(() => {
    if (authStatus?.branding.title) {
      return parseColoredTextUtil(authStatus.branding.title);
    }

    return [{ text: "Nodify", color: "cyan" }];
  }, [authStatus]);

  const isRegister =
    !authStatus?.isLoginAllowed && authStatus?.isRegisterAllowed;
  const authMethods = getAuthMethods(authStatus);

  return (
    <Page title="登录">
      <Stack align="center" gap="xs">
        <Group align="center" gap={4} justify="center">
          <BrandLogo logoUrl={authStatus?.branding.logoUrl} />
          <BrandTitle titleParts={titleParts} />
        </Group>

        {!authStatus && isPending && (
          <Spinner aria-label="正在连接主控" size="sm" />
        )}
        {isError && (
          <Stack align="center" gap="sm">
            <Text role="alert">无法连接主控，请检查连接后重试。</Text>
            <Button
              isDisabled={isFetching}
              onPress={() => void refetch()}
              variant="secondary"
            >
              重新连接
            </Button>
          </Stack>
        )}

        {!isRegister && authStatus && authStatus.authentication && (
          <Box maw={500} p={{ base: 12, sm: 30 }} w="100%">
            <Stack gap="lg">
              {authMethods.isPasswordEnabled && <LoginFormFeature />}

              {authMethods.hasPrimaryMethods &&
                authMethods.hasAlternativeMethods && (
                  <Center>
                    <Divider
                      label="OR"
                      labelPosition="center"
                      maw="400px"
                      w="100%"
                    />
                  </Center>
                )}

              {authMethods.hasAlternativeMethods && (
                <AlternativeAuthMethods
                  authentication={authStatus.authentication}
                  isOAuth2Enabled={authMethods.isOAuth2Enabled}
                  isPasskeyEnabled={authMethods.isPasskeyEnabled}
                  isPasswordEnabled={authMethods.isPasswordEnabled}
                />
              )}
            </Stack>
          </Box>
        )}

        {isRegister && (
          <Box maw={500} w="100%">
            <RegisterFormFeature />
          </Box>
        )}
      </Stack>
    </Page>
  );
};

export default LoginPage;
