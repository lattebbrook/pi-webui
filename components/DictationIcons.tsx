// Inline SVG icons for voice dictation (pi-web ships no icon library).
// Shapes follow lucide's 24px grid so the ported RecordingDeck renders unchanged.
import type React from "react";

type IconProps = { size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties; "aria-hidden"?: boolean | "true" | "false" };

function icon(paths: React.ReactNode, fill = false) {
  return function Icon({ size = 16, strokeWidth = 2, className, style, ...rest }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke="currentColor"
        strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}
        aria-hidden={rest["aria-hidden"] ?? true}>
        {paths}
      </svg>
    );
  };
}

export const AlertCircle = icon(<><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></>);
export const ArrowUp = icon(<path d="m5 12 7-7 7 7M12 19V5" />);
export const Loader2 = icon(<path d="M21 12a9 9 0 1 1-6.22-8.56" />);
export const Mic = icon(<><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" /></>);
export const Pause = icon(<><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></>);
export const Play = icon(<path d="M6 3l14 9-14 9V3z" />);
export const RotateCw = icon(<><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" /><path d="M21 3v5h-5" /></>);
export const Square = icon(<rect x="5" y="5" width="14" height="14" rx="2" />);
export const Trash2 = icon(<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />);
export const X = icon(<path d="M18 6 6 18M6 6l12 12" />);
