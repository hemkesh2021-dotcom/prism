import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/*
 * Press feedback is a CSS scale on :active (see .press in index.css). It is plain
 * CSS on purpose: a JavaScript tap gesture would synthesize pointer events on
 * Enter, which conflicts with menu triggers that toggle on pointerdown.
 */
export const buttonVariants = cva(
  [
    "press relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold",
    "transition-[background-color,box-shadow,color,opacity,transform] duration-200 ease-out-soft",
    "disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none",
    "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-teal",
    "[&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "btn-primary text-white",
        secondary:
          "border border-ink/12 bg-surface text-ink shadow-control hover:border-ink/20 hover:bg-surface-warm active:shadow-pressed",
        ghost: "text-ink hover:bg-ink/6 active:bg-ink/10",
        quiet: "text-teal underline-offset-4 hover:underline",
      },
      size: {
        md: "h-11 px-4 text-[14px]",
        lg: "h-12 px-5 text-[15px]",
        icon: "h-11 w-11 text-[14px]",
        sm: "h-9 px-3 text-[13px] after:absolute after:-inset-1 after:content-['']",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
