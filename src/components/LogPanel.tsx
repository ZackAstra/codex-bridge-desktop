import { useEffect, RefObject } from "react";
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
        {logs.map((log, i) => (
          <div key={i} className={`log-line ${log.level}`}>
            {log.text}
          </div>
        ))}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}
