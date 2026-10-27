import { Fragment } from "react";
import { tokenizePlaceholders } from "@/lib/highlight";

/** Renders generated wording with [placeholders] visibly marked. Plain text only; never HTML. */
export function Wording({ text }: { text: string }) {
  return (
    <>
      {tokenizePlaceholders(text).map((token, i) =>
        token.kind === "placeholder" ? (
          <span key={i} className="placeholder-token" title="Placeholder: replace with the specific point">
            {token.value}
          </span>
        ) : (
          <Fragment key={i}>{token.value}</Fragment>
        ),
      )}
    </>
  );
}
