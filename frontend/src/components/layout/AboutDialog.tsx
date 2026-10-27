import { PrismGlyph } from "@/components/brand/Wordmark";
import { Dialog, DialogContent } from "@/components/ui/dialog";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promptVersion?: string;
  appVersion?: string;
}

const STEPS = [
  {
    title: "Parse",
    body: "Python reads each “Speaker: Message” turn and counts words per speaker. These numbers are deterministic; the AI never counts.",
  },
  {
    title: "Analyze",
    body: "In live mode, one language model reviews the turns for three narrow kinds of potential concern and summarizes discussion, decisions and tasks.",
  },
  {
    title: "Verify",
    body: "Every quotation must appear word-for-word in the turn it cites. Anything that fails is dropped and reported, never repaired.",
  },
  {
    title: "Review",
    body: "You decide. Mark each finding helpful, incorrect or unsure, then download a report that keeps your annotations separate.",
  },
];

export function AboutDialog({ open, onOpenChange, promptVersion, appVersion }: AboutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent wide title="PRISM — Meeting Communication & Bias Analyzer" description="An academic project for reviewing meeting transcripts with visible evidence.">
        <div className="space-y-6 text-[14.5px] leading-relaxed text-ink">
          <div className="flex items-start gap-4">
            <PrismGlyph size={40} className="mt-1 shrink-0" />
            <p className="text-ink-2">
              Long transcripts are hard to review by hand. PRISM points to language that may be worth a second look and backs every
              point with an exact quotation, so a person can judge it in context. It never claims that anyone is biased.
            </p>
          </div>

          <ol className="grid gap-3 sm:grid-cols-2">
            {STEPS.map((step, index) => (
              <li key={step.title} className="well p-4">
                <p className="font-semibold">
                  <span className="mr-2 text-teal">{index + 1}</span>
                  {step.title}
                </p>
                <p className="mt-1 text-[13.5px] text-ink-2">{step.body}</p>
              </li>
            ))}
          </ol>

          <section>
            <h3 className="font-semibold">Limits worth knowing</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
              <li>Word share counts words, not speaking time. Unequal participation is never treated as a concern on its own.</li>
              <li>“Quotation verified” means the words exist in that turn, not that the model's reading of them is right.</li>
              <li>No findings is not a certificate that a meeting was free of bias.</li>
              <li>English transcripts in “Speaker: Message” form only; timestamps are not supported.</li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold">Privacy</h3>
            <p className="mt-2 text-ink-2">
              Your transcript, results and review notes live only in this browser tab's memory and disappear when you clear the
              session or close the tab. Live analysis sends the transcript to the AI provider configured on the server, which
              processes it under its own terms. The sample demo sends nothing to any provider. The only thing PRISM stores in your
              browser is your motion setting.
            </p>
          </section>

          {(promptVersion || appVersion) && (
            <p className="text-[13px] text-ink-2">
              {appVersion && <>App version {appVersion}. </>}
              {promptVersion && <>Analysis prompt {promptVersion}.</>}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
