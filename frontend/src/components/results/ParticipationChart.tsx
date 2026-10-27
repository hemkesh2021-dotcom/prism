import { Bar, BarChart, Cell, LabelList, Tooltip, XAxis, YAxis, type LabelProps } from "recharts";
import { formatInt, formatShare } from "@/lib/format";
import { useMotionPreference } from "@/lib/motion";
import { speakerColor } from "@/lib/speakers";
import type { SpeakerStats } from "@/lib/types";
import { useElementWidth } from "@/lib/useElementSize";

interface Row {
  id: string;
  label: string;
  words: number;
  turns: number;
  share: number | null;
  color: string;
  valueLabel: string;
}

const FONT = "Manrope Variable, system-ui, sans-serif";
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-[12px] border border-ink/10 bg-surface px-3 py-2 text-[13px] shadow-control">
      <p className="flex items-center gap-1.5 font-semibold text-ink">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} aria-hidden />
        {row.label}
      </p>
      <p className="tnum mt-0.5 text-ink-2">
        {formatInt(row.words)} words ({formatShare(row.share)}), {formatInt(row.turns)} {row.turns === 1 ? "turn" : "turns"}
      </p>
    </div>
  );
}

/**
 * Horizontal bars of word count per speaker (first-appearance order) with exact
 * values as direct labels. Bars animate from zero and stop at the exact counts.
 * Narrow containers put the name and value above each bar so the bars keep their
 * full width. Decorative for screen readers: the table beside it carries the numbers.
 */
export function ParticipationChart({ speakers }: { speakers: SpeakerStats[] }) {
  const { reduced } = useMotionPreference();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const rows: Row[] = speakers.map((s) => ({
    id: s.speaker_id,
    label: s.label,
    words: s.words,
    turns: s.turns,
    share: s.word_share,
    color: speakerColor(s.order),
    valueLabel: `${formatInt(s.words)} words (${formatShare(s.word_share)})`,
  }));
  const max = Math.max(1, ...rows.map((r) => r.words));
  const compact = width > 0 && width < 520;
  const height = compact ? rows.length * 54 + 8 : rows.length * 44 + 8;
  const axisWidth = Math.min(124, Math.max(72, Math.round(width * 0.2)));

  const compactLabel = (props: LabelProps) => {
    const row = rows[props.index ?? 0];
    const box = (props.viewBox ?? {}) as { x?: number; y?: number };
    const x = Number(box.x ?? 0);
    const y = Number(box.y ?? 0) - 8;
    if (!row) return <g />;
    return (
      <g>
        <text x={x} y={y} fill="#182422" fontSize={13.5} fontWeight={600} fontFamily={FONT}>
          {truncate(row.label, Math.max(8, Math.floor(width / 16)))}
        </text>
        <text x={width - 2} y={y} textAnchor="end" fill="#596662" fontSize={13} fontWeight={600} fontFamily={FONT} style={{ fontVariantNumeric: "tabular-nums" }}>
          {row.valueLabel}
        </text>
      </g>
    );
  };

  return (
    <div ref={ref} style={{ height }} aria-hidden>
      {width > 0 && (
        <BarChart
          width={width}
          height={height}
          data={rows}
          layout="vertical"
          accessibilityLayer={false}
          margin={compact ? { top: 26, right: 2, bottom: 2, left: 0 } : { top: 4, right: 156, bottom: 4, left: 0 }}
          barCategoryGap={compact ? 26 : 14}
        >
          <XAxis type="number" hide domain={[0, max]} />
          <YAxis
            type="category"
            dataKey="label"
            hide={compact}
            width={compact ? 0 : axisWidth}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: string) => truncate(value, Math.floor(axisWidth / 8))}
            tick={{ fill: "#182422", fontSize: 13.5, fontWeight: 600, fontFamily: FONT }}
          />
          <Tooltip cursor={{ fill: "rgb(24 36 34 / 0.04)" }} content={<ChartTooltip />} isAnimationActive={false} />
          <Bar dataKey="words" radius={[0, 4, 4, 0]} barSize={compact ? 12 : 16} isAnimationActive={!reduced} animationDuration={760} animationEasing="ease-out">
            {rows.map((row) => (
              <Cell key={row.id} fill={row.color} />
            ))}
            {compact ? (
              <LabelList dataKey="label" content={compactLabel} />
            ) : (
              <LabelList
                dataKey="valueLabel"
                position="right"
                offset={10}
                style={{ fill: "#596662", fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums", fontFamily: FONT }}
              />
            )}
          </Bar>
        </BarChart>
      )}
    </div>
  );
}
