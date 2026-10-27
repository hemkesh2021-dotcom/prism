import { motion } from "motion/react";
import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { durations, ease } from "@/lib/motion";

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

/** Pressed track with a raised thumb that slides to the active tab. */
export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("well grid auto-cols-fr grid-flow-col gap-1 rounded-[18px] p-1.5", className)}
      {...props}
    />
  );
}

interface TabsTriggerProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  active: boolean;
  layoutGroup: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

export function TabsTrigger({ active, layoutGroup, icon, badge, className, children, ...props }: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative flex min-h-11 items-center justify-center gap-2 rounded-[13px] px-3 py-2 text-center text-[14px] font-semibold leading-tight transition-colors duration-200",
        active ? "text-ink" : "text-ink-2 hover:text-ink",
        className,
      )}
      {...props}
    >
      {active && (
        <motion.span
          layoutId={`${layoutGroup}-thumb`}
          className="absolute inset-0 rounded-[13px] bg-surface shadow-control"
          transition={{ duration: durations.panel, ease }}
          aria-hidden
        />
      )}
      <span className="relative z-10 flex items-center gap-2">
        {icon}
        <span>{children}</span>
        {badge}
      </span>
    </TabsPrimitive.Trigger>
  );
}
