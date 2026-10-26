import { useEffect, useRef, useState } from "react";

export interface ReasoningModeOption {
  value: string;
  label: string;
  summary: string;
  detail: string;
}

export const REASONING_MODE_OPTIONS: ReasoningModeOption[] = [
  {
    value: "auto",
    label: "自动推断",
    summary: "仅原生 DeepSeek 域名自动套用官方规则",
    detail:
      "与 cc-switch 平台/模型规则对齐。Chat/Anthropic 上游仅在 Base URL 为 https://api.deepseek.com 时自动套用 DeepSeek 规则；其他域名需手动选择。OpenRouter、SiliconFlow 仍按平台规则推断。",
  },
  {
    value: "passthrough",
    label: "直通",
    summary: "effort 原样转发",
    detail:
      "适用 OpenAI o 系列 / GPT-5+ / 支持全档位的官方 API。不做 effort 档位映射，直接透传 reasoning.effort。",
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    summary: "low/high/max 三档（xhigh→high，ultra→max）",
    detail:
      "适用 DeepSeek 官方（Chat/Anthropic 经 Bridge）与支持三档的中转站。注入 thinking.type=enabled；minimal/low→low，medium/high/xhigh→high，max/ultra→max。",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    summary: "max→xhigh，写入 reasoning.effort",
    detail:
      "适用 OpenRouter 聚合网关。effort 写入 reasoning.effort 嵌套对象，max 映射为 xhigh，关闭时写 reasoning.effort=none。",
  },
  {
    value: "low_high",
    label: "低高两档",
    summary: "minimal/low→low，其余→high",
    detail:
      "适用仅支持 low/high 两档的模型。minimal 与 low 映射为 low，medium/high/xhigh/max 映射为 high。",
  },
];

interface Props {
  value: string;
  onChange: (value: string) => void;
  upstreamFormat?: "anthropic" | "openai";
}

export default function ReasoningModeSelect({ value, onChange, upstreamFormat = "openai" }: Props) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const controlRef = useRef<HTMLDivElement>(null);

  const selected =
    REASONING_MODE_OPTIONS.find((o) => o.value === value) ?? REASONING_MODE_OPTIONS[0];
  const detailOption =
    REASONING_MODE_OPTIONS.find((o) => o.value === hovered) ?? selected;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (controlRef.current && !controlRef.current.contains(e.target as Node)) {
        setOpen(false);
        setHovered(null);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const handleSelect = (modeValue: string) => {
    onChange(modeValue);
    setOpen(false);
    setHovered(null);
  };

  const handleOpen = () => {
    setOpen((v) => {
      const next = !v;
      if (!next) setHovered(null);
      return next;
    });
  };

  return (
    <div className="field reasoning-mode-field">
      <label>Reasoning Mode</label>
      <div
        className={`reasoning-mode-control${open ? " is-open" : ""}`}
        ref={controlRef}
      >
        <div className="reasoning-mode-row">
          <button
            type="button"
            className={`reasoning-mode-trigger ${open ? "open" : ""}`}
            onClick={handleOpen}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span>{selected.label}</span>
            <svg
              className="reasoning-mode-chevron"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden
            >
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {!open && (
            <div className="reasoning-mode-summary" title={selected.detail}>
              {upstreamFormat === "anthropic" ? "Anthropic · " : "OpenAI · "}
              {selected.summary}
            </div>
          )}
        </div>

        {open && (
          <>
            <div className="reasoning-mode-dropdown" role="listbox">
              {REASONING_MODE_OPTIONS.map((option) => (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={option.value === value}
                  className={`reasoning-mode-option ${
                    option.value === value ? "active" : ""
                  } ${option.value === hovered ? "hovered" : ""}`}
                  onMouseEnter={() => setHovered(option.value)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => handleSelect(option.value)}
                >
                  {option.label}
                </div>
              ))}
            </div>
            <div className="reasoning-mode-detail-panel" aria-live="polite">
              <div className="reasoning-mode-detail-title">{detailOption.label}</div>
              <p className="reasoning-mode-detail-body">{detailOption.detail}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
