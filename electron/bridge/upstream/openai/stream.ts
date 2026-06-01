import { appendUtf8Safe, takeSseBlock } from "../../sse/parser";
import { extractChatSseError } from "./errors";
import { ChatToResponsesState } from "./streamState";

export async function* createResponsesSseStreamFromChat(
  byteStream: AsyncIterable<Buffer>,
): AsyncGenerator<string> {
  let buffer = "";
  const utf8Remainder: number[] = [];
  const state = new ChatToResponsesState();
  let streamFailed = false;

  for await (const chunk of byteStream) {
    if (streamFailed) break;
    try {
      buffer = appendUtf8Safe(buffer, utf8Remainder, chunk);
    } catch (exc) {
      yield state.failedEvent(String(exc), "stream_error");
      streamFailed = true;
      break;
    }

    while (true) {
      const [block, rest] = takeSseBlock(buffer);
      buffer = rest;
      if (!block) break;

      if (!block.dataParts.length && !block.event) continue;

      const data = block.dataParts.join("\n").trim();
      if (data === "[DONE]") {
        for (const event of state.finalize()) yield event;
        continue;
      }

      if (!data) continue;

      try {
        const parsed = JSON.parse(data);
        if (block.event === "error" || parsed.error) {
          const [message, errorType] = extractChatSseError(parsed);
          yield state.failedEvent(message, errorType);
          streamFailed = true;
          break;
        }
        for (const event of state.handleChatChunk(parsed)) yield event;
      } catch {
        continue;
      }
    }
  }

  if (!streamFailed) {
    for (const event of state.finalize()) yield event;
  }
}

export function processChatSseChunks(chunks: string[]): string {
  let buffer = "";
  const state = new ChatToResponsesState();
  const output: string[] = [];

  for (const chunk of chunks) {
    buffer += chunk;
    while (true) {
      const [block, rest] = takeSseBlock(buffer);
      buffer = rest;
      if (!block) break;

      const data = block.dataParts.join("\n").trim();
      if (data === "[DONE]") {
        output.push(...state.finalize());
        continue;
      }
      if (!data) continue;

      try {
        const parsed = JSON.parse(data);
        if (block.event === "error" || parsed.error) {
          const [message, errorType] = extractChatSseError(parsed);
          output.push(state.failedEvent(message, errorType));
          continue;
        }
        output.push(...state.handleChatChunk(parsed));
      } catch {
        continue;
      }
    }
  }

  output.push(...state.finalize());
  return output.join("");
}
