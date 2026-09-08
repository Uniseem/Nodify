import { NavLink } from "react-router";
import { useMobileMenuSections } from "../menu-sections/mobile-menu-sections";

export const MobileNavigation = ({ onClose }: { onClose?: () => void }) => {
  const menu = useMobileMenuSections();
  return (
    <nav aria-label="功能入口" className="flex flex-col gap-4 py-2">
      {menu.map((group) => (
        <section key={group.id}>
          <h3 className="mb-2 text-sm font-semibold text-muted">
            {group.header}
          </h3>
          <ul className="flex flex-col gap-1">
            {group.section.map((item) => (
              <li key={item.id}>
                {item.dropdownItems ? (
                  <details>
                    <summary className="cursor-pointer rounded-lg px-3 py-2">
                      {item.name}
                    </summary>
                    <ul className="ml-3 flex flex-col gap-1">
                      {item.dropdownItems.map((child) => (
                        <li key={child.id}>
                          <NavLink
                            className={({ isActive }) =>
                              `block rounded-lg px-3 py-2 ${isActive ? "bg-default font-semibold" : ""}`
                            }
                            onClick={onClose}
                            to={child.href}
                          >
                            {child.name}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <NavLink
                    className={({ isActive }) =>
                      `block rounded-lg px-3 py-2 ${isActive ? "bg-default font-semibold" : ""}`
                    }
                    end
                    onClick={onClose}
                    to={item.href}
                    {...(item.newTab
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {item.name}
                  </NavLink>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
};
