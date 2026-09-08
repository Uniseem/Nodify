import { Button, Modal } from "@heroui/react";
import { useState } from "react";
import { AppShell, Container, Group } from "@shared/heroui-compat";

import { LayoutMain } from "../layout-shared";
import classes from "../layout.module.css";
import { MobileNavigation } from "../navbar/mobile-navigation.layout";

export const MobileLayout = ({
  headerControls,
}: {
  headerControls: React.ReactNode;
}) => {
  const [opened, setOpened] = useState(false);
  return (
    <AppShell header={{ height: 64 }} padding="md">
      <AppShell.Header className={classes.header}>
        <Container fluid px="lg" py="xs">
          <Group justify="space-between" wrap="nowrap">
            <Button
              aria-label="打开导航"
              isIconOnly
              onPress={() => setOpened(true)}
              variant="secondary"
            >
              ☰
            </Button>
            <Group gap="xs" wrap="nowrap">
              {headerControls}
            </Group>
          </Group>
        </Container>
      </AppShell.Header>
      <Modal>
        <Modal.Backdrop isOpen={opened} onOpenChange={setOpened}>
          <Modal.Container placement="top" scroll="inside" size="sm">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Nodify 导航</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <MobileNavigation onClose={() => setOpened(false)} />
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      <LayoutMain
        pb="var(--mantine-spacing-md)"
        pt="calc(var(--app-shell-header-height) + 10px)"
      />
    </AppShell>
  );
};
