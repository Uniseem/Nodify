import { Button } from "@heroui/react";
import { PiSignOut } from "react-icons/pi";
import { useNavigate } from "react-router";

import { clearQueryClient } from "@shared/api";
import { ROUTES } from "@shared/constants";
import { logoutEvents } from "@shared/emitters";
import { resetAllStores } from "@shared/hocs/store-wrapper";
import { useAuth } from "@shared/hooks";

import { removeToken } from "@entities/auth";

import classes from "./LogoutControl.module.css";

export function LogoutControl() {
  const { setIsAuthenticated } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logoutEvents.emit();
    setIsAuthenticated(false);
    removeToken();
    resetAllStores();
    clearQueryClient();
    navigate(ROUTES.AUTH.LOGIN);
  };

  return (
    <Button
      aria-label="退出登录"
      isIconOnly
      variant="ghost"
      className={classes.logout}
      onPress={handleLogout}
    >
      <PiSignOut aria-hidden="true" size={22} />
    </Button>
  );
}
