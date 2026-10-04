"use client";

import { useEffect, useState } from "react";

let cached: Promise<boolean> | null = null;

/** Whether the server has a speech-to-text endpoint; asked once per page load. */
export function useSttEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    cached ??= fetch("/api/stt/config", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ enabled?: boolean }>) : null))
      .then((data) => data?.enabled === true)
      .catch(() => {
        cached = null;
        return false;
      });
    void cached.then((value) => {
      if (active) setEnabled(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return enabled;
}
