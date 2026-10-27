import { IconAlertTriangle, IconCircleCheck, IconDownload, IconFilePlus } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CountUp } from "@/components/common/CountUp";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { pluralize } from "@/lib/format";
import { durations, ease, panelTransition, useMotionPreference } from "@/lib/motion";
import { speakerColorMap } from "@/lib/speakers";
import { useMediaQuery } from "@/lib/useMediaQuery";
import type { AnalyzeResponse, Evidence } from "@/lib/types";
import type { Workspace } from "@/state/useWorkspace";
import { ResultsContext, findingTone, type ActiveHighlight, type ResultsContextValue, type ResultsTab } from "./context";
import { LanguageReviewTab } from "./LanguageReviewTab";
import { OverviewTab } from "./OverviewTab";
import { ReportDialog } from "./ReportDialog";
import { SourceDialog } from "./SourceDialog";
import { SummaryTab } from "./SummaryTab";

export function ResultsView({ workspace, response }: { workspace: Workspace; response: AnalyzeResponse }) {
  const { state, actions } = workspace;
  const { reduced } = useMotionPreference();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [tab, setTabState] = useState<ResultsTab>("overview");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<ActiveHighlight | null>(null);
  const [source, setSource] = useState<Evidence | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [savedReport, setSavedReport] = useState<string | null>(null);
  const nonce = useRef(0);
  const tabsTop = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Land keyboard and screen-reader users on the results heading.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  // The download confirmation clears itself after a few seconds.
  useEffect(() => {
    if (!savedReport) return;
    const id = window.setTimeout(() => setSavedReport(null), 6000);
    return () => window.clearTimeout(id);
  }, [savedReport]);

  const turns = response.parse.turns;
  const turnIndex = useMemo(() => new Map(turns.map((t, i) => [t.turn_id, i])), [turns]);
  const colors = useMemo(() => speakerColorMap(response.parse.speakers), [response.parse.speakers]);
  const findingsById = useMemo(() => new Map(response.analysis.findings.map((f) => [f.finding_id, f])), [response.analysis.findings]);

  const setTab = useCallback(
    (next: ResultsTab) => {
      setTabState(next);
      tabsTop.current?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
    },
    [reduced],
  );

  const selectFinding = useCallback(
    (findingId: string | null) => {
      setSelectedFindingId(findingId);
      const finding = findingId ? findingsById.get(findingId) : null;
      if (!finding) return setHighlight(null);
      nonce.current += 1;
      // Desktop shows transcript and evidence side by side, so the transcript follows the selection.
      setHighlight({
        turnId: finding.evidence.turn_id,
        evidence: finding.evidence,
        tone: findingTone(finding),
        nonce: nonce.current,
        scroll: desktop,
        focus: false,
      });
      if (tab !== "language") setTabState("language");
    },
    [findingsById, desktop, tab],
  );

  const showInTranscript = useCallback((turnId: string, evidence: Evidence | null = null, tone: ActiveHighlight["tone"] = "source") => {
    nonce.current += 1;
    setTabState("language");
    // Wait a frame so the Language review tab is mounted before scrolling.
    requestAnimationFrame(() =>
      setHighlight({ turnId, evidence, tone, nonce: nonce.current, scroll: true, focus: true }),
    );
  }, []);

  const value: ResultsContextValue = {
    response,
    turns,
    turnIndex,
    colors,
    findingsById,
    reviews: state.reviews,
    setReview: actions.setReview,
    tab,
    setTab,
    selectedFindingId,
    selectFinding,
    highlight,
    showInTranscript,
    openSource: setSource,
  };

  const { analysis, parse } = response;
  const droppedFindings = response.findings_returned - analysis.findings.length;
  const title = state.title.trim() || "Untitled meeting";

  return (
    <ResultsContext.Provider value={value}>
      <div className="mx-auto max-w-[1320px] px-4 pb-20 sm:px-6 lg:px-10">
        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: durations.entrance, ease }}
          className="flex flex-col gap-4 pt-4 lg:flex-row lg:items-end lg:justify-between lg:pt-6"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <ModeBadge response={response} />
              <span className="text-[13px] text-ink-2">Analysis complete</span>
            </div>
            <h1 ref={heading} tabIndex={-1} className="mt-2 break-words text-[28px] font-[720] leading-tight tracking-[-0.03em] text-ink [text-wrap:pretty] sm:text-[34px]">
              {title}
            </h1>
          </div>
          <div className="relative">
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setReportOpen(true)}>
                <IconDownload size={18} stroke={1.75} aria-hidden />
                Download report
              </Button>
              <Button variant="secondary" onClick={actions.showInput}>
                <IconFilePlus size={18} stroke={1.75} aria-hidden />
                New analysis
              </Button>
            </div>
            <p role="status" className="absolute left-0 top-full mt-2 whitespace-nowrap text-[13px] text-teal-strong lg:left-auto lg:right-0">
              <AnimatePresence>
                {savedReport && (
                  <motion.span
                    key={savedReport}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: durations.control, ease }}
                    className="inline-flex items-center gap-1.5"
                  >
                    <IconCircleCheck size={16} stroke={2} aria-hidden />
                    Report saved as <span className="font-mono text-[12px]">{savedReport}</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </p>
          </div>
        </motion.header>

        <MetricStrip
          speakers={parse.speakers.length}
          words={parse.total_words}
          turns={parse.total_turns}
          concerns={analysis.findings.length}
          reviewed={analysis.findings.filter((f) => state.reviews[f.finding_id]?.verdict).length}
        />

        {response.notices.length > 0 && (
          <motion.section
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: durations.panel, delay: 0.25 }}
            aria-labelledby="notices-heading"
            className="mt-4 flex gap-3 rounded-[16px] border border-amber/35 bg-amber-soft/55 px-4 py-3 sm:px-5"
          >
            <IconAlertTriangle size={18} stroke={1.75} className="mt-[3px] shrink-0 text-amber-ink" aria-hidden />
            <div className="min-w-0 text-[14px] leading-relaxed">
              <h2 id="notices-heading" className="mr-2 inline font-semibold text-ink">
                Validation notes
              </h2>
              {response.notices.length === 1 ? (
                <span className="text-ink-2">{response.notices[0].message}</span>
              ) : (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-2">
                  {response.notices.map((notice) => (
                    <li key={`${notice.section}-${notice.code}`}>{notice.message}</li>
                  ))}
                </ul>
              )}
              {droppedFindings > 0 && analysis.findings.length === 0 && (
                <p className="mt-1 font-medium text-ink">No verified findings remain, so this is not an all-clear.</p>
              )}
            </div>
          </motion.section>
        )}

        <div ref={tabsTop} className="scroll-mt-4" />
        <Tabs value={tab} onValueChange={(v) => setTabState(v as ResultsTab)} className="mt-6">
          <TabsList aria-label="Results sections" className="w-full lg:inline-grid lg:w-auto">
            <TabsTrigger value="overview" active={tab === "overview"} layoutGroup="results-tabs" className="lg:px-6">
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="language"
              active={tab === "language"}
              layoutGroup="results-tabs"
              className="lg:px-6"
              aria-label={`Language review${analysis.findings.length ? `, ${pluralize(analysis.findings.length, "finding")}` : ""}`}
              badge={
                analysis.findings.length > 0 ? (
                  <span className="tnum rounded-full bg-amber-soft px-1.5 text-[11.5px] font-bold text-amber-ink" aria-hidden>
                    {analysis.findings.length}
                  </span>
                ) : undefined
              }
            >
              <span className="sm:hidden">Language</span>
              <span className="hidden sm:inline">Language review</span>
            </TabsTrigger>
            <TabsTrigger value="summary" active={tab === "summary"} layoutGroup="results-tabs" className="lg:px-6" aria-label="Summary & actions">
              <span className="sm:hidden">Summary</span>
              <span className="hidden sm:inline">Summary &amp; actions</span>
            </TabsTrigger>
          </TabsList>

          {(
            [
              ["overview", <OverviewTab key="o" />],
              ["language", <LanguageReviewTab key="l" />],
              ["summary", <SummaryTab key="s" />],
            ] as const
          ).map(([value, content]) => (
            <TabsContent key={value} value={value} className="mt-6 rounded-[18px] focus-visible:outline-offset-4">
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={panelTransition}>
                {content}
              </motion.div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <SourceDialog evidence={source} onOpenChange={(open) => !open && setSource(null)} />
      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        onDownloaded={setSavedReport}
        response={response}
        reviews={state.reviews}
        title={state.title}
        transcript={state.text}
      />
    </ResultsContext.Provider>
  );
}

function ModeBadge({ response }: { response: AnalyzeResponse }) {
  if (response.mode === "demo") {
    return (
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-dashed border-ink/30 bg-surface/70 px-3 text-[12.5px] font-semibold text-ink">
        Sample demo
        <span className="font-medium text-ink-2">bundled results</span>
      </span>
    );
  }
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-teal px-3 text-[12.5px] font-semibold text-white">
      Live analysis
      {response.model && <span className="font-mono text-[11.5px] font-medium text-white/85">{response.model}</span>}
    </span>
  );
}

function MetricStrip({ speakers, words, turns, concerns, reviewed }: { speakers: number; words: number; turns: number; concerns: number; reviewed: number }) {
  const metrics = [
    { label: "Speakers represented", value: speakers, note: "Labels in the transcript" },
    { label: "Total words", value: words, note: "Exact count from the transcript" },
    { label: "Turns", value: turns, note: "Parsed speaker turns" },
    {
      label: "Potential concerns",
      value: concerns,
      note: "Model findings with verified quotes",
      extra: concerns > 0 ? `${reviewed} of ${concerns} reviewed by you` : null,
    },
  ];
  return (
    <motion.dl
      initial="hidden"
      animate="shown"
      variants={{ shown: { transition: { staggerChildren: 0.05, delayChildren: 0.08 } } }}
      className="panel mt-5 grid grid-cols-2 overflow-hidden lg:grid-cols-4"
    >
      {metrics.map((metric, i) => (
        <motion.div
          key={metric.label}
          variants={{ hidden: { opacity: 0, y: 8 }, shown: { opacity: 1, y: 0, transition: { duration: durations.panel, ease } } }}
          className={[
            "min-w-0 px-4 py-3.5 sm:px-5",
            i % 2 === 1 ? "border-l border-ink/8" : "",
            i >= 2 ? "border-t border-ink/8 lg:border-t-0" : "",
            i === 2 ? "lg:border-l" : "",
          ].join(" ")}
        >
          <dt className="text-[13px] font-semibold text-ink-2">{metric.label}</dt>
          <dd className="mt-1">
            <CountUp value={metric.value} delay={0.1 + i * 0.05} className="tnum block text-[30px] font-[760] leading-none tracking-[-0.03em] text-ink" />
            <span className="mt-1.5 block text-[12.5px] leading-snug text-ink-2">{metric.note}</span>
            {metric.extra && <span className="mt-0.5 block text-[12.5px] font-medium text-teal">{metric.extra}</span>}
          </dd>
        </motion.div>
      ))}
    </motion.dl>
  );
}
