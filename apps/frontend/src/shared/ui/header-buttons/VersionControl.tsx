import { Button, Modal, Spinner } from "@heroui/react";
import { NODIFY_VERSION } from "@nodify/contract";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { instance } from "@shared/api/axios";

export function VersionControl() {
  const [open, setOpen] = useState(false);
  const version = useQuery({
    queryKey: ["nodify", "application-version"],
    enabled: open,
    queryFn: async () => {
      const response = await instance.get("/api/agent/version", { timeout: 15000 });
      const value = response.data.response ?? response.data;
      if (value.application !== "Nodify" || typeof value.version !== "string") {
        throw new Error("无法识别主控版本");
      }
      return value.version as string;
    },
    retry: false,
  });

  return (
    <>
      <Button
        aria-label={`Nodify ${NODIFY_VERSION} 版本信息`}
        onPress={() => setOpen(true)}
        size="sm"
        variant="secondary"
      >
        {NODIFY_VERSION}
      </Button>
      <Modal>
        <Modal.Backdrop isOpen={open} onOpenChange={setOpen}>
          <Modal.Container size="sm">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Nodify 版本信息</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p>前端：{NODIFY_VERSION}</p>
                {version.isPending ? (
                  <Spinner aria-label="读取主控版本" size="sm" />
                ) : version.isError ? (
                  <p role="alert">读取主控版本失败，请重试。</p>
                ) : (
                  <p>主控：{version.data}</p>
                )}
                {version.data && version.data !== NODIFY_VERSION && (
                  <p role="alert">
                    前端与主控版本不同，请检查部署产物并刷新页面。
                  </p>
                )}
                <p>
                  版本来自本仓库的构建与运行产物。Agent
                  的版本在服务器详情中查看。
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button
                  isDisabled={version.isFetching}
                  onPress={() => void version.refetch()}
                  variant="secondary"
                >
                  重新读取
                </Button>
                <Button onPress={() => setOpen(false)}>关闭</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
