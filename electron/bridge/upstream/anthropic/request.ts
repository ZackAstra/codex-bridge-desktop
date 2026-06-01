export function convertInputToAnthropic(body: Record<string, unknown>): [Record<string, unknown>[], string] {
  let developerContent = "";
  const inputVal = body.input;

  if (typeof inputVal === "string") {
    return [[{ role: "user", content: inputVal }], ""];
  }

  if (!Array.isArray(inputVal)) {
    return [[{ role: "user", content: String(inputVal) }], ""];
  }

  const items: [string, unknown][] = [];

  for (const item of inputVal) {
    if (typeof item !== "object" || !item) {
      items.push(["user", String(item)]);
      continue;
    }

    const obj = item as Record<string, unknown>;
    const itemType = obj.type;
    const role = String(obj.role || "");

    if (itemType === "reasoning") continue;

    if (role === "developer") {
      let content = obj.content;
      if (Array.isArray(content)) {
        const texts = content
          .filter((b) => typeof b === "object" && b && (b as Record<string, unknown>).type === "input_text")
          .map((b) => String((b as Record<string, unknown>).text || ""));
        content = texts.join("\n");
      } else if (typeof content !== "string") {
        content = String(content);
      }
      developerContent = String(content);
      continue;
    }

    if (itemType === "function_call") {
      const callId = obj.call_id || obj.id || "";
      const name = obj.name || "";
      let args = obj.arguments ?? "{}";
      let inputData: unknown;
      try {
        inputData = typeof args === "string" ? JSON.parse(args) : args;
      } catch {
        inputData = { raw: String(args) };
      }
      items.push([
        "assistant",
        { type: "tool_use", id: callId, name, input: inputData },
      ]);
      continue;
    }

    if (itemType === "function_call_output") {
      const callId = obj.call_id || "";
      const output = obj.output;
      items.push([
        "user",
        { type: "tool_result", tool_use_id: callId, content: String(output ?? "") },
      ]);
      continue;
    }

    if (role === "user" || role === "assistant") {
      let content = obj.content;
      if (typeof content === "string") {
        items.push([role, content]);
      } else if (Array.isArray(content)) {
        const texts: string[] = [];
        for (const block of content) {
          if (typeof block === "object" && block) {
            const bt = (block as Record<string, unknown>).type;
            if (["input_text", "output_text", "text"].includes(String(bt))) {
              texts.push(String((block as Record<string, unknown>).text || ""));
            }
          }
        }
        if (texts.length) items.push([role, texts.join("\n")]);
      } else {
        items.push([role, String(content)]);
      }
      continue;
    }

    if (itemType === "input_text") {
      items.push(["user", obj.text || ""]);
      continue;
    }

    items.push(["user", String(item)]);
  }

  const anthropicMessages: Record<string, unknown>[] = [];
  for (const [role, content] of items) {
    const last = anthropicMessages[anthropicMessages.length - 1];
    if (last && last.role === role) {
      const existing = last.content;
      if (typeof existing === "string") {
        if (typeof content === "string") {
          last.content = `${existing}\n${content}`;
        } else {
          last.content = [{ type: "text", text: existing }, content];
        }
      } else if (Array.isArray(existing)) {
        if (typeof content === "string") {
          existing.push({ type: "text", text: content });
        } else {
          existing.push(content);
        }
      }
    } else {
      if (typeof content === "object" && content) {
        anthropicMessages.push({ role, content: [content] });
      } else {
        anthropicMessages.push({ role, content });
      }
    }
  }

  if (anthropicMessages.length && anthropicMessages[0].role !== "user") {
    anthropicMessages.unshift({ role: "user", content: "(continue)" });
  }

  return [anthropicMessages, developerContent];
}

export function convertToolsToAnthropic(tools: unknown): Record<string, unknown>[] | null {
  if (!tools) return null;

  const result: Record<string, unknown>[] = [];
  if (!Array.isArray(tools)) return null;

  for (const tool of tools) {
    if (typeof tool !== "object" || !tool) continue;
    const t = tool as Record<string, unknown>;
    if (t.type !== "function" && !t.function) continue;

    let entry: Record<string, unknown> = {
      name: t.name || "",
      description: t.description || "",
      input_schema: t.parameters || { type: "object", properties: {} },
    };

    if (t.function && typeof t.function === "object") {
      const fn = t.function as Record<string, unknown>;
      entry = {
        name: fn.name || entry.name,
        description: fn.description || entry.description,
        input_schema: fn.parameters || entry.input_schema,
      };
    }

    if (!entry.name) continue;
    if (!entry.input_schema) entry.input_schema = { type: "object", properties: {} };
    else if (typeof entry.input_schema === "object" && !(entry.input_schema as Record<string, unknown>).type) {
      (entry.input_schema as Record<string, unknown>).type = "object";
    }

    result.push(entry);
  }

  return result.length ? result : null;
}
