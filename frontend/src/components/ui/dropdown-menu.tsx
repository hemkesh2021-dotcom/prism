import { IconCheck } from "@tabler/icons-react";
import { DropdownMenu as Menu } from "radix-ui";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/cn";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

export function DropdownMenuContent({ className, sideOffset = 8, ...props }: ComponentPropsWithoutRef<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        collisionPadding={16}
        className={cn(
          "menu-content z-50 min-w-[240px] max-w-[calc(100vw-32px)] rounded-[18px] border border-white/70 bg-surface-warm p-1.5 shadow-raised-lg",
          className,
        )}
        {...props}
      />
    </Menu.Portal>
  );
}

const itemClass =
  "relative flex min-h-11 cursor-pointer select-none items-start gap-3 rounded-[12px] px-3 py-2.5 text-[14px] text-ink outline-none transition-colors data-[highlighted]:bg-teal-soft data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50";

export function DropdownMenuItem({ className, ...props }: ComponentPropsWithoutRef<typeof Menu.Item>) {
  return <Menu.Item className={cn(itemClass, className)} {...props} />;
}

export function DropdownMenuRadioItem({ className, children, ...props }: ComponentPropsWithoutRef<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(itemClass, "pl-9", className)} {...props}>
      <span className="absolute left-3 top-3 flex h-4 w-4 items-center justify-center">
        <Menu.ItemIndicator>
          <IconCheck size={16} stroke={2.25} className="text-teal" aria-hidden />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.RadioItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentPropsWithoutRef<typeof Menu.Label>) {
  return <Menu.Label className={cn("px-3 pb-1 pt-2 text-[12px] font-semibold text-ink-2", className)} {...props} />;
}
