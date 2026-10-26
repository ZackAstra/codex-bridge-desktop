import fs from "fs";
import path from "path";

export class TomlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TomlError";
  }
}

export interface KeySnapshot {
  exists: boolean;
  raw?: string;
}

interface ScanState {
  ml: "" | "basic" | "literal";
  depth: number;
}

interface LineInfo {
  index: number;
  text: string;
  trimmed: string;
  header: string | null;
  section: string;
  topLevel: boolean;
  endState: ScanState;
}

interface Analysis {
  lines: string[];
  infos: LineInfo[];
  errors: string[];
}

export function tomlString(value: string): string {
  return JSON.stringify(value);
}

export function tomlStringArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

export function tomlBoolean(value: boolean): string {
  return value ? "true" : "false";
}

export function parseTomlString(raw: string): string | null {
  const value = String(raw || "").trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return null;
}

function parseHeader(trimmed: string): string | null {
  const arrayTable = trimmed.startsWith("[[");
  const open = arrayTable ? 2 : 1;
  const close = arrayTable ? trimmed.indexOf("]]", open) : trimmed.indexOf("]", open);
  if (close < 0) return null;
  const raw = trimmed.slice(open, close).trim();
  if (!raw) return null;
  return raw.replace(/^["']|["']$/g, "");
}

function isEscaped(line: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && line[i] === "\\"; i -= 1) count += 1;
  return count % 2 === 1;
}

function scanLine(line: string, input: ScanState, errors: string[], lineNo: number): ScanState {
  const state: ScanState = { ...input };
  let i = 0;
  while (i < line.length) {
    if (state.ml === "basic") {
      const idx = line.indexOf('"""', i);
      if (idx < 0) return state;
      if (isEscaped(line, idx)) {
        i = idx + 1;
        continue;
      }
      state.ml = "";
      i = idx + 3;
      continue;
    }
    if (state.ml === "literal") {
      const idx = line.indexOf("'''", i);
      if (idx < 0) return state;
      state.ml = "";
      i = idx + 3;
      continue;
    }

    const char = line[i];
    if (char === "#") break;
    if (line.startsWith('"""', i)) {
      state.ml = "basic";
      i += 3;
      continue;
    }
    if (line.startsWith("'''", i)) {
      state.ml = "literal";
      i += 3;
      continue;
    }
    if (char === '"') {
      let j = i + 1;
      let closed = false;
      while (j < line.length) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === '"') {
          j += 1;
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) errors.push(`line ${lineNo}: unterminated basic string`);
      i = j;
      continue;
    }
    if (char === "'") {
      const j = line.indexOf("'", i + 1);
      if (j < 0) errors.push(`line ${lineNo}: unterminated literal string`);
      i = j < 0 ? line.length : j + 1;
      continue;
    }
    if (char === "[") {
      state.depth += 1;
      i += 1;
      continue;
    }
    if (char === "]") {
      state.depth = Math.max(0, state.depth - 1);
      i += 1;
      continue;
    }
    i += 1;
  }
  return state;
}

function analyze(text: string): Analysis {
  let normalized = String(text ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (normalized.endsWith("\n")) normalized = normalized.slice(0, -1);
  const lines = normalized === "" ? [] : normalized.split("\n");
  const infos: LineInfo[] = [];
  const errors: string[] = [];
  let state: ScanState = { ml: "", depth: 0 };
  let section = "";

  for (let i = 0; i < lines.length; i += 1) {
    const textLine = lines[i];
    const trimmed = textLine.trim();
    const topLevel = state.ml === "" && state.depth === 0;
    let header: string | null = null;
    if (topLevel && trimmed.startsWith("[")) {
      header = parseHeader(trimmed);
      if (header === null) errors.push(`line ${i + 1}: malformed table header`);
      else section = header;
    }
    const lineSection = section;
    state = scanLine(textLine, state, errors, i + 1);
    infos.push({
      index: i,
      text: textLine,
      trimmed,
      header,
      section: lineSection,
      topLevel,
      endState: { ...state },
    });
  }

  if (state.ml !== "") errors.push(`unterminated multiline ${state.ml} string`);
  if (state.depth !== 0) errors.push("unbalanced brackets");
  return { lines, infos, errors };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isKeyLine(trimmed: string, key: string): boolean {
  return new RegExp(`^${escapeRegex(key)}\\s*=`).test(trimmed);
}

function blockEnd(infos: LineInfo[], start: number): number {
  for (let i = start; i < infos.length; i += 1) {
    if (infos[i].endState.ml === "" && infos[i].endState.depth === 0) return i;
  }
  return infos.length - 1;
}

function firstHeaderIndex(infos: LineInfo[]): number {
  const index = infos.findIndex((info) => info.header !== null);
  return index < 0 ? infos.length : index;
}

function joinLines(lines: string[]): string {
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function findTopLevelKey(analysis: Analysis, key: string): LineInfo | undefined {
  return analysis.infos.find(
    (info) => info.section === "" && info.header === null && isKeyLine(info.trimmed, key),
  );
}

function sectionHeader(analysis: Analysis, section: string): LineInfo | null {
  const matches = analysis.infos.filter((info) => info.header === section);
  if (matches.length > 1) throw new TomlError(`duplicate section [${section}]`);
  return matches[0] ?? null;
}

function sectionRange(analysis: Analysis, header: LineInfo): { end: number; next: LineInfo | undefined } {
  const next = analysis.infos.find((info) => info.index > header.index && info.header !== null);
  return { end: next ? next.index : analysis.lines.length, next };
}

function findSectionKey(
  analysis: Analysis,
  header: LineInfo,
  end: number,
  section: string,
  key: string,
): LineInfo | undefined {
  return analysis.infos.find(
    (info) =>
      info.index > header.index &&
      info.index < end &&
      info.section === section &&
      info.header === null &&
      isKeyLine(info.trimmed, key),
  );
}

function valueOfBlock(lines: string[], start: number, end: number): string {
  const block = lines.slice(start, end + 1).join("\n");
  const eq = block.indexOf("=");
  return block.slice(eq + 1).trim();
}

export function hasTopLevelKey(text: string, key: string): boolean {
  return findTopLevelKey(analyze(text), key) !== undefined;
}

export function getTopLevelRaw(text: string, key: string): KeySnapshot {
  const analysis = analyze(text);
  const info = findTopLevelKey(analysis, key);
  if (!info) return { exists: false };
  const end = blockEnd(analysis.infos, info.index);
  return { exists: true, raw: valueOfBlock(analysis.lines, info.index, end) };
}

export function upsertTopLevelKey(text: string, key: string, raw: string): string {
  const analysis = analyze(text);
  if (analysis.errors.length) throw new TomlError(analysis.errors.join("; "));
  const lines = [...analysis.lines];
  const info = findTopLevelKey(analysis, key);
  if (info) {
    const end = blockEnd(analysis.infos, info.index);
    lines.splice(info.index, end - info.index + 1, `${key} = ${raw}`);
    return joinLines(lines);
  }

  const index = firstHeaderIndex(analysis.infos);
  const insert = [`${key} = ${raw}`];
  if (index > 0 && lines[index - 1].trim() !== "") insert.unshift("");
  if (index < lines.length && lines[index].trim().startsWith("[")) insert.push("");
  lines.splice(index, 0, ...insert);
  return joinLines(lines);
}

export function setTopLevelKeys(text: string, entries: Array<{ key: string; raw: string }>): string {
  let result = text;
  const missing: Array<{ key: string; raw: string }> = [];
  for (const entry of entries) {
    if (hasTopLevelKey(result, entry.key)) result = upsertTopLevelKey(result, entry.key, entry.raw);
    else missing.push(entry);
  }
  if (!missing.length) return result;

  const analysis = analyze(result);
  if (analysis.errors.length) throw new TomlError(analysis.errors.join("; "));
  const lines = [...analysis.lines];
  const index = firstHeaderIndex(analysis.infos);
  const insert = missing.map((entry) => `${entry.key} = ${entry.raw}`);
  if (index > 0 && lines[index - 1].trim() !== "") insert.unshift("");
  if (index < lines.length && lines[index].trim().startsWith("[")) insert.push("");
  lines.splice(index, 0, ...insert);
  return joinLines(lines);
}

export function removeTopLevelKey(text: string, key: string): string {
  const analysis = analyze(text);
  if (analysis.errors.length) throw new TomlError(analysis.errors.join("; "));
  const info = findTopLevelKey(analysis, key);
  if (!info) return text;
  const lines = [...analysis.lines];
  const end = blockEnd(analysis.infos, info.index);
  lines.splice(info.index, end - info.index + 1);
  return joinLines(lines);
}

export function getSectionKeyRaw(text: string, section: string, key: string): KeySnapshot {
  const analysis = analyze(text);
  const header = sectionHeader(analysis, section);
  if (!header) return { exists: false };
  const { end } = sectionRange(analysis, header);
  const info = findSectionKey(analysis, header, end, section, key);
  if (!info) return { exists: false };
  const keyEnd = blockEnd(analysis.infos, info.index);
  return { exists: true, raw: valueOfBlock(analysis.lines, info.index, keyEnd) };
}

export function upsertSectionKey(text: string, section: string, key: string, raw: string): string {
  const analysis = analyze(text);
  if (analysis.errors.length) throw new TomlError(analysis.errors.join("; "));
  const lines = [...analysis.lines];
  const header = sectionHeader(analysis, section);

  if (!header) {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push(`[${section}]`, `${key} = ${raw}`);
    return joinLines(lines);
  }

  const { end, next } = sectionRange(analysis, header);
  const existing = findSectionKey(analysis, header, end, section, key);
  if (existing) {
    const keyEnd = blockEnd(analysis.infos, existing.index);
    const indent = existing.text.match(/^\s*/)?.[0] ?? "";
    lines.splice(existing.index, keyEnd - existing.index + 1, `${indent}${key} = ${raw}`);
    return joinLines(lines);
  }

  let insertAt = end;
  while (insertAt > header.index + 1 && lines[insertAt - 1].trim() === "") insertAt -= 1;
  const insert = [`${key} = ${raw}`];
  if (next && insertAt < lines.length) insert.push("");
  lines.splice(insertAt, 0, ...insert);
  return joinLines(lines);
}

export function removeSectionKey(text: string, section: string, key: string): string {
  const analysis = analyze(text);
  if (analysis.errors.length) throw new TomlError(analysis.errors.join("; "));
  const header = sectionHeader(analysis, section);
  if (!header) return text;
  const { end } = sectionRange(analysis, header);
  const existing = findSectionKey(analysis, header, end, section, key);
  if (!existing) return text;
  const lines = [...analysis.lines];
  const keyEnd = blockEnd(analysis.infos, existing.index);
  lines.splice(existing.index, keyEnd - existing.index + 1);
  return joinLines(lines);
}

export function getSectionRaw(text: string, section: string): KeySnapshot {
  const analysis = analyze(text);
  const header = sectionHeader(analysis, section);
  if (!header) return { exists: false };
  const { end } = sectionRange(analysis, header);
  return {
    exists: true,
    raw: analysis.lines.slice(header.index, end).join("\n").replace(/\n+$/, ""),
  };
}

export function replaceSectionRaw(text: string, section: string, block: string): string {
  const analysis = analyze(text);
  if (analysis.errors.length) throw new TomlError(analysis.errors.join("; "));
  const header = sectionHeader(analysis, section);
  const lines = [...analysis.lines];
  const blockLines = String(block || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n+$/, "")
    .split("\n");

  if (!header) {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    lines.push(...blockLines);
    return joinLines(lines);
  }

  const { end, next } = sectionRange(analysis, header);
  const replacement = [...blockLines];
  if (next) replacement.push("");
  lines.splice(header.index, end - header.index, ...replacement);
  return joinLines(lines);
}

export function replaceSection(text: string, section: string, bodyLines: string[]): string {
  return replaceSectionRaw(text, section, [`[${section}]`, ...bodyLines].join("\n"));
}

export function removeSection(text: string, section: string): string {
  const analysis = analyze(text);
  if (analysis.errors.length) throw new TomlError(analysis.errors.join("; "));
  const header = sectionHeader(analysis, section);
  if (!header) return text;
  const { end } = sectionRange(analysis, header);
  const lines = [...analysis.lines];
  lines.splice(header.index, end - header.index);
  return joinLines(lines);
}

export function listSections(text: string): string[] {
  return analyze(text)
    .infos.filter((info) => info.header !== null)
    .map((info) => info.header as string);
}

export function validateTomlText(text: string): string[] {
  const analysis = analyze(text);
  const errors = [...analysis.errors];
  const topKeys = new Map<string, number>();
  const sections = new Map<string, number>();

  for (const info of analysis.infos) {
    if (info.header !== null) {
      sections.set(info.header, (sections.get(info.header) ?? 0) + 1);
      continue;
    }
    if (info.section === "" && info.topLevel) {
      const match = info.trimmed.match(/^([A-Za-z0-9_-]+)\s*=/);
      if (match) topKeys.set(match[1], (topKeys.get(match[1]) ?? 0) + 1);
    }
  }

  for (const [key, count] of topKeys) {
    if (count > 1) errors.push(`duplicate top-level key: ${key}`);
  }
  for (const [section, count] of sections) {
    if (count > 1) errors.push(`duplicate section: [${section}]`);
  }
  return errors;
}

export function writeTextAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, "w");
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, filePath);
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function writeJsonAtomic(filePath: string, data: unknown): void {
  writeTextAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`);
}
