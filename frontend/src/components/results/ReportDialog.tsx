import { IconDownload } from "@tabler/icons-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { pluralize } from "@/lib/format";
import { buildReport, reportFileName } from "@/lib/report";
import type { AnalyzeResponse } from "@/lib/types";
import type { Review } from "@/state/workspace";

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the file name after the browser was asked to save the report. */
  onDownloaded?: (fileName: string) => void;
  response: AnalyzeResponse;
  reviews: Record<string, Review>;
  title: string;
  transcript: string;
}

export function ReportDialog({ open, onOpenChange, onDownloaded, response, reviews, title, transcript }: ReportDialogProps) {
  const [includeTranscript, setIncludeTranscript] = useState(false);
  const checkboxId = useId();
  const { analysis } = response;
  const reviewed = analysis.findings.filter((f) => reviews[f.finding_id]?.verdict || reviews[f.finding_id]?.note.trim()).length;

  const download = () => {
    const generatedAt = new Date();
    const markdown = buildReport({ response, reviews, title, transcript, includeTranscript, generatedAt });
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileName = reportFileName(title || "meeting", generatedAt);
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    onOpenChange(false);
    onDownloaded?.(fileName);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Download report" description="A Markdown file built from these results and your review annotations.">
        <ul className="well space-y-1.5 p-4 text-[14px] text-ink">
          <li>Participation for {pluralize(response.parse.speakers.length, "speaker")}</li>
          <li>
            {pluralize(analysis.findings.length, "finding")} with quotations, explanations and alternatives
            {analysis.findings.length > 0 && <>, {reviewed} with your annotations</>}
          </li>
          <li>
            {pluralize(analysis.discussion_points.length, "discussion point")}, {pluralize(analysis.decisions.length, "decision")},{" "}
            {pluralize(analysis.action_items.length, "action item")} and their sources
          </li>
          <li>Validation notices, mode, model and prompt version, and method notes</li>
        </ul>

        <div className="mt-4 flex items-start gap-3 rounded-[14px] border border-ink/10 bg-surface/80 p-3.5">
          <input
            id={checkboxId}
            type="checkbox"
            checked={includeTranscript}
            onChange={(e) => setIncludeTranscript(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-teal"
          />
          <label htmlFor={checkboxId} className="cursor-pointer text-[14px] leading-snug">
            <span className="font-semibold text-ink">Include the full transcript</span>
            <span className="mt-0.5 block text-[13px] text-ink-2">
              Off by default. Turn it on only if everyone who will receive the report may read the whole meeting.
            </span>
          </label>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={download}>
            <IconDownload size={18} stroke={1.75} aria-hidden />
            Download Markdown
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
