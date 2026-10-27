import { motion } from "motion/react";
import { ToggleGroup } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { durations, ease } from "@/lib/motion";

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T | null;
  onValueChange: (value: T | null) => void;
  options: SegmentOption<T>[];
  label: string;
  layoutGroup: string;
  /** Allow clicking the active option again to clear the selection. */
  allowEmpty?: boolean;
  className?: string;
  optionClassName?: string;
}

/** Accessible single-choice control (Radix toggle group) with a sliding raised thumb. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  label,
  layoutGroup,
  allowEmpty = false,
  className,
  optionClassName,
}: SegmentedProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value ?? ""}
      onValueChange={(next) => {
        if (!next && !allowEmpty) return;
        onValueChange((next || null) as T | null);
      }}
      className={cn("well inline-grid auto-cols-fr grid-flow-col gap-1 rounded-[15px] p-1", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={cn(
              "relative flex min-h-11 items-center justify-center gap-1.5 rounded-[11px] px-3 text-[13.5px] font-semibold transition-colors duration-200",
              "disabled:cursor-not-allowed disabled:opacity-45",
              active ? "text-ink" : "text-ink-2 hover:text-ink",
              optionClassName,
            )}
          >
            {active && (
              <motion.span
                layoutId={`${layoutGroup}-thumb`}
                className="absolute inset-0 rounded-[11px] bg-surface shadow-control"
                transition={{ duration: durations.control, ease }}
                aria-hidden
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {option.icon}
              {option.label}
            </span>
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
