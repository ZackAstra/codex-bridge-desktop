export function chatErrorToResponseError(body: unknown): Record<string, unknown> {
  let message = "Unknown upstream error";
  let errorType = "upstream_error";
  let code: unknown = null;

  if (typeof body === "string") {
    message = body.slice(0, 1024);
  } else if (typeof body === "object" && body) {
    const obj = body as Record<string, unknown>;
    if ("error" in obj) {
      const err = obj.error;
      if (typeof err === "string") {
        message = err;
      } else if (typeof err === "object" && err) {
        const errObj = err as Record<string, unknown>;
        message = String(errObj.message || errObj.detail || err);
        errorType = (errObj.type as string) || errorType;
        code = errObj.code;
      }
    } else if ("base_resp" in obj) {
      const base = obj.base_resp;
      if (typeof base === "object" && base) {
        message = String((base as Record<string, unknown>).status_msg || message);
        code = (base as Record<string, unknown>).status_code;
      }
    } else if ("message" in obj) {
      message = String(obj.message);
    } else if ("detail" in obj) {
      message = String(obj.detail);
    } else {
      message = String(body).slice(0, 1024);
    }
  }

  const result: Record<string, unknown> = {
    message,
    type: errorType,
    param: null,
  };
  if (code !== null && code !== undefined) {
    result.code = code;
  }
  return result;
}

export function extractChatSseError(chunk: Record<string, unknown>): [string, string | null] {
  const error = chunk.error ?? chunk;
  if (typeof error === "string") return [error, "api_error"];
  if (typeof error === "object" && error) {
    const errObj = error as Record<string, unknown>;
    const message = String(errObj.message || errObj.detail || error);
    const errorType = errObj.type || errObj.code;
    if (typeof errorType === "string") return [message, errorType];
    return [message, null];
  }
  return [String(error), null];
}
