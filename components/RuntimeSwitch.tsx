"use client";

// Segmented control choosing which agent the web UI drives: omp or pi.
// Switching is instant; both runtimes stay live on the server.

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getRuntimeInfo, loadRuntimeInfo, setRuntime, useRuntime } from "@/lib/runtime-client";
import type { AgentRuntime } from "@/lib/types";

const OPTIONS: { id: AgentRuntime; label: string }[] = [
  { id: "omp", label: "OMP" },
  { id: "pi", label: "Pi" },
];

export function RuntimeSwitch() {
  const { t } = useI18n();
  const runtime = useRuntime();
  const [info, setInfo] = useState(getRuntimeInfo);
  useEffect(() => {
    let active = true;
    void loadRuntimeInfo().then((next) => {
      if (active) setInfo(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div role="radiogroup" aria-label={t("runtime.label")} className="runtime-switch">
      {OPTIONS.map((option) => {
        const available = info ? info.available[option.id] : true;
        const version = info?.versions[option.id];
        const selected = runtime === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={!available}
            title={available ? (version ? `${option.label} · ${version}` : option.label) : t("runtime.unavailable", { name: option.label })}
            className="runtime-switch-option"
            data-selected={selected ? "true" : undefined}
            onClick={() => setRuntime(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
