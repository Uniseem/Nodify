import { Dropdown } from "@heroui/react";
import { useDirection } from "@shared/heroui-compat";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { TbLanguage } from "react-icons/tb";

const data = [
  { label: "English", emoji: "🇬🇧", value: "en" },
  { label: "Русский", emoji: "🇷🇺", value: "ru" },
  { label: "فارسی", emoji: "🇮🇷", value: "fa" },
  { label: "简体中文", emoji: "🇨🇳", value: "zh" },
];

export function LanguagePicker() {
  const { toggleDirection, dir } = useDirection();
  const { i18n } = useTranslation();

  useEffect(() => {
    const savedLanguage = localStorage.getItem("i18nextLng");
    if (savedLanguage) {
      i18n.changeLanguage(savedLanguage);

      if (savedLanguage === "fa") {
        if (dir === "ltr") {
          toggleDirection();
        }
      }
    }
  }, [i18n]);

  const changeLanguage = (value: string) => {
    i18n.changeLanguage(value);

    if (value === "fa" && dir === "ltr") {
      toggleDirection();
    }

    if (dir === "rtl" && value !== "fa") {
      toggleDirection();
    }
  };

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label="切换语言 / Language"
        className="flex size-10 items-center justify-center rounded-lg hover:bg-default"
      >
        <TbLanguage aria-hidden="true" size={22} />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          aria-label="语言 / Language"
          selectionMode="single"
          selectedKeys={[i18n.resolvedLanguage || i18n.language]}
          onAction={(key) => changeLanguage(String(key))}
        >
          {data.map((item) => (
            <Dropdown.Item
              id={item.value}
              key={item.value}
              textValue={item.label}
            >
              <span aria-hidden="true">{item.emoji}</span> {item.label}
              <Dropdown.ItemIndicator />
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
