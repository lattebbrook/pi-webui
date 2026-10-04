export const MAX_STT_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_STT_REQUEST_BYTES = MAX_STT_AUDIO_BYTES + 1024 * 1024;

/**
 * What the composer does with the transcript once it lands: send it, or queue
 * it as a steer/follow-up. No intent means insert it for editing. Kept on the
 * server job so the choice survives the composer remounting (every session
 * switch) and reaches whichever browser claims the transcript.
 */
export type SttAfter = "send" | "steer" | "followup";

export function isSttAfter(value: unknown): value is SttAfter {
  return value === "send" || value === "steer" || value === "followup";
}

function cleanEnvVar(val?: string): string | undefined {
  const cleaned = val?.replace(/\\n|[\r\n]/g, "").trim();
  return cleaned || undefined;
}

export interface SttConfig {
  endpoint: string;
  apiKey: string | undefined;
  model: string | undefined;
}

/** `PI_WEBUI_STT_<name>`, falling back to ompweb's `OMP_WEB_STT_<name>`. */
function sttEnv(name: "ENDPOINT" | "KEY" | "MODEL"): string | undefined {
  return cleanEnvVar(process.env[`PI_WEBUI_STT_${name}`]) ?? cleanEnvVar(process.env[`OMP_WEB_STT_${name}`]);
}

/** STT settings (an OpenAI-compatible /audio/transcriptions endpoint); null when no endpoint is configured. */
export function readSttConfig(): SttConfig | null {
  const endpoint = sttEnv("ENDPOINT");
  if (!endpoint) return null;
  return { endpoint, apiKey: sttEnv("KEY"), model: sttEnv("MODEL") };
}
