import { IconX } from "@tabler/icons-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useScrollable } from "@/lib/useElementSize";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

interface DialogContentProps extends Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  wide?: boolean;
}

export function DialogContent({ title, description, wide, className, children, ...props }: DialogContentProps) {
  const [bodyRef, bodyScrolls] = useScrollable<HTMLDivElement>("y");
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay fixed inset-0 z-50 bg-[rgb(236_235_228/0.72)] backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          "dialog-content panel-lg fixed left-1/2 top-1/2 z-50 flex max-h-[min(88vh,760px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col",
          wide ? "max-w-[760px]" : "max-w-[520px]",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-6">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-[19px] font-bold leading-snug tracking-[-0.01em] text-ink">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1 text-[14px] leading-relaxed text-ink-2">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-2 transition-colors hover:bg-ink/6 hover:text-ink"
            aria-label="Close"
          >
            <IconX size={20} stroke={1.75} aria-hidden />
          </DialogPrimitive.Close>
        </div>
        {/* Long content scrolls; it is focusable only then, so keyboard users can scroll it. */}
        <div
          ref={bodyRef}
          className="min-h-0 overflow-y-auto overscroll-contain rounded-b-[22px] px-6 pb-6 pt-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal"
          tabIndex={bodyScrolls ? 0 : undefined}
          role={bodyScrolls ? "region" : undefined}
          aria-label={bodyScrolls ? (typeof title === "string" ? title : "Dialog content") : undefined}
        >
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
