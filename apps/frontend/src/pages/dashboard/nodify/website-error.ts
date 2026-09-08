export const websiteError = (error: any): string => {
  const validation = error?.issues
    ?.map((issue: any) => issue.message)
    .join("；");
  if (validation) return validation;
  const message = error?.response?.data?.message;
  if (message)
    return Array.isArray(message) ? message.join("；") : String(message);
  if (error?.response?.status >= 500 || error?.code === "ERR_NETWORK")
    return "暂时无法连接主控，请稍后重试。当前内容已保留。";
  return error?.message || "操作失败";
};
