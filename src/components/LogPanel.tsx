import React, { useEffect, RefObject } from "react";
import { LogLine } from "../App";

interface Props {
  logs: LogLine[];
  onClear: () => void;
  scrollRef: RefObject<HTMLDivElement>;
}

export default function LogPanel({ logs, onClear, scrollRef }: Props) {
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, scrollRef]);

  const firstLiveIdx = logs.findIndex((l) => l.origin !== "file");

  return (
    <div className="log-panel">
      <div className="log-header">
        <span>Logs</span>
        <button className="clear-btn" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="log-body">
        {logs.length === 0 && (
          <span style={{ opacity: 0.4 }}>Logs will appear here...</span>
        )}
        {logs.map((log, i) => {
          const showSep = firstLiveIdx > 0 && i === firstLiveIdx;
          return (
            <React.Fragment key={i}>
              {showSep && (
                <div className="log-separator">
                  <span className="log-separator-line" />
                  <span className="log-separator-label">Session started</span>
                  <span className="log-separator-line" />
                </div>
              )}
              <div className={`log-line ${log.level} ${log.origin === "file" ? "file" : ""}`}>
                {log.text}
              </div>
            </React.Fragment>
          );
        })}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}
