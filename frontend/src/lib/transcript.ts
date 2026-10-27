/**
 * Same canonical form as the backend: drop one leading BOM, and turn CRLF, CR and the
 * Unicode line separators (U+2028, U+2029, NEL) into LF.
 */
export function canonicalize(text: string): string {
  const withoutBom = text.startsWith("\uFEFF") ? text.slice(1) : text;
  return withoutBom.replace(/\r\n|[\r\u2028\u2029\u0085]/g, "\n");
}

/** Character count used for the limit: Unicode code points of the canonical text (matches Python len()). */
export function countCharacters(text: string): number {
  let count = 0;
  for (const _ of canonicalize(text)) count += 1;
  return count;
}

export type FileReadResult = { ok: true; text: string; name: string } | { ok: false; message: string };

/** Read an uploaded .txt file strictly as UTF-8. Never truncates. */
export async function readTranscriptFile(file: File, maxBytes: number): Promise<FileReadResult> {
  if (!/\.txt$/i.test(file.name)) {
    return { ok: false, message: "Choose a plain-text .txt file." };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      message: `“${file.name}” is ${formatKiB(file.size)}; the limit is ${formatKiB(maxBytes)}. Split the transcript and analyze the parts separately.`,
    };
  }
  const bytes = await file.arrayBuffer();
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.trim()) return { ok: false, message: `“${file.name}” is empty.` };
    return { ok: true, text: canonicalize(text), name: file.name };
  } catch {
    return {
      ok: false,
      message: `“${file.name}” is not UTF-8 text. Re-save it as UTF-8 (plain text) and upload it again.`,
    };
  }
}

function formatKiB(bytes: number): string {
  return `${Math.ceil(bytes / 1024).toLocaleString()} KiB`;
}

export function titleFromFileName(name: string): string {
  return name.replace(/\.txt$/i, "").replace(/[_-]+/g, " ").trim();
}

export const FORMAT_EXAMPLE = `Arun: Let's review the caching proposal.
Meera: Sure. Two points: latency and cost.
The benchmark is in the shared folder.
Arun: Thanks, I'll read it today.`;
