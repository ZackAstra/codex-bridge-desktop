export interface SseBlock {
  event?: string;
  dataParts: string[];
}

export function sseBlockData(block: SseBlock): string {
  return block.dataParts.join("\n");
}

export function appendUtf8Safe(buffer: string, remainder: number[], chunk: Buffer): string {
  for (const b of chunk) remainder.push(b);
  try {
    const decoded = Buffer.from(remainder).toString("utf-8");
    remainder.length = 0;
    return buffer + decoded;
  } catch {
    for (let i = remainder.length - 1; i >= Math.max(remainder.length - 4, 0); i--) {
      try {
        const decoded = Buffer.from(remainder.slice(0, i)).toString("utf-8");
        remainder.splice(0, i);
        return buffer + decoded;
      } catch {
        continue;
      }
    }
  }
  return buffer;
}

export function takeSseBlock(buffer: string): [SseBlock | null, string] {
  const sep = buffer.indexOf("\n\n");
  if (sep < 0) return [null, buffer];

  const blockText = buffer.slice(0, sep);
  const rest = buffer.slice(sep + 2);
  if (!blockText.trim()) return [{ event: undefined, dataParts: [] }, rest];

  const block: SseBlock = { dataParts: [] };
  for (const line of blockText.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      block.event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      block.dataParts.push(line.slice(5).trimStart());
    }
  }
  return [block, rest];
}
