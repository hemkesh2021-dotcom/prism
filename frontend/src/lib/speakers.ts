import type { SpeakerStats } from "./types";

/**
 * Speaker colors in a fixed order (first appearance), validated for colour-vision
 * deficiency separation on adjacent pairs, with the first four distinguishable as
 * any pair. Colours are never cycled: speakers after the sixth share a neutral and
 * are always identified by name. Text never uses these colours.
 */
export const SPEAKER_COLORS = ["#2f59ab", "#5d9222", "#ac3a75", "#2096c0", "#774cbc", "#cd677d"] as const;
export const SPEAKER_OTHER = "#6b7470";

export function speakerColor(order: number): string {
  return SPEAKER_COLORS[order] ?? SPEAKER_OTHER;
}

export function speakerColorMap(speakers: SpeakerStats[]): Map<string, string> {
  return new Map(speakers.map((s) => [s.speaker_id, speakerColor(s.order)]));
}

export const hasFoldedSpeakers = (speakers: SpeakerStats[]) => speakers.length > SPEAKER_COLORS.length;
