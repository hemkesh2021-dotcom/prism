import { IconAlertTriangle, IconPlugConnectedX, IconSettings, IconClockPause, IconFileAlert } from "@tabler/icons-react";
import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";
import { errorDetail, errorTitle } from "@/lib/errorText";
import type { AppError } from "@/lib/types";

const CONFIG_CODES = new Set(["live_not_configured", "provider_auth", "model_not_found", "provider_rejected_request"]);
const TIME_CODES = new Set(["timeout", "client_timeout", "rate_limited"]);
const INPUT_CODES = new Set(["parse_failed", "transcript_empty", "transcript_too_long", "transcript_too_large", "unsupported_encoding"]);

interface ErrorCalloutProps {
  ref?: Ref<HTMLDivElement>;
  error: AppError;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function ErrorCallout({ ref, error, actions, children, className }: ErrorCalloutProps) {
  const Icon = error.code === "backend_unavailable"
    ? IconPlugConnectedX
    : CONFIG_CODES.has(error.code)
      ? IconSettings
      : TIME_CODES.has(error.code)
        ? IconClockPause
        : INPUT_CODES.has(error.code)
          ? IconFileAlert
          : IconAlertTriangle;
  return (
    <div ref={ref} role="alert" className={cn("rounded-[18px] border border-brick/20 bg-brick-soft/70 p-4 sm:p-5", className)}>
      <div className="flex gap-3">
        <Icon size={22} stroke={1.75} className="mt-0.5 shrink-0 text-brick" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{errorTitle(error)}</p>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{errorDetail(error)}</p>
          {children}
          {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

/** Concrete steps for enabling live analysis. Shown for configuration problems. */
export function LiveSetupSteps({ missing }: { missing?: string[] }) {
  return (
    <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13.5px] text-ink-2">
      <li>
        Copy <code className="rounded bg-surface px-1 py-0.5 font-mono text-[12.5px] text-ink">backend/.env.example</code> to{" "}
        <code className="rounded bg-surface px-1 py-0.5 font-mono text-[12.5px] text-ink">backend/.env</code>.
      </li>
      <li>
        Set {(missing?.length ? missing : ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"]).map((name, i, all) => (
          <span key={name}>
            <code className="rounded bg-surface px-1 py-0.5 font-mono text-[12.5px] text-ink">{name}</code>
            {i < all.length - 1 ? " and " : ""}
          </span>
        ))}
        . The key stays on the server.
      </li>
      <li>Restart the backend, then reload this page.</li>
    </ol>
  );
}
