export function sseEmit(event: string, data: Record<string, unknown>): string {
  const payload = JSON.stringify(data);
  return `event: ${event}\ndata: ${payload}\n\n`;
}
