import { useEffect, useMemo, useRef, useState } from "react";

export type SelectMenuOption = {
  value: string;
  label: string;
  dotColor?: string;
  tone?: "default" | "danger";
};

type Props = {
  value: string;
  options: SelectMenuOption[];
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  onChange: (value: string) => void;
};

export const SelectMenu = ({
  value,
  options,
  disabled = false,
  className,
  menuClassName,
  onChange,
}: Props) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0] ?? null,
    [options, value],
  );

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div
      className={`select-menu ${open ? "select-menu--open" : ""} ${className ?? ""}`.trim()}
      ref={containerRef}
    >
      <button
        className="select-menu__trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className="select-menu__value">
          {selectedOption?.dotColor ? (
            <span
              className="select-menu__dot"
              style={{ background: selectedOption.dotColor }}
            />
          ) : null}
          <span
            className={`select-menu__label ${selectedOption?.tone === "danger" ? "select-menu__label--danger" : ""}`}
          >
            {selectedOption?.label ?? "Select"}
          </span>
        </span>
        <span className="select-menu__chevron" aria-hidden="true">
          <span />
        </span>
      </button>

      {open ? (
        <div className={`select-menu__menu ${menuClassName ?? ""}`.trim()}>
          {options.map((option) => (
            <button
              className={`select-menu__item ${option.value === value ? "select-menu__item--active" : ""}`.trim()}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              type="button"
            >
              <span className="select-menu__value">
                {option.dotColor ? (
                  <span
                    className="select-menu__dot"
                    style={{ background: option.dotColor }}
                  />
                ) : null}
                <span
                  className={`select-menu__label ${option.tone === "danger" ? "select-menu__label--danger" : ""}`}
                >
                  {option.label}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
