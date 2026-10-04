/** Editable endpoint templates; credentials always belong to OMP. */
export const OMP_PROVIDER_PRESETS = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", api: "openai-responses", auth: "apiKey" },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", api: "anthropic-messages", auth: "apiKey" },
  { id: "google", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", api: "google-generative-ai", auth: "apiKey" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", api: "openai-completions", auth: "apiKey" },
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", api: "openai-completions", auth: "apiKey" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", api: "openai-completions", auth: "apiKey" },
  { id: "ollama", name: "Ollama (local)", baseUrl: "http://127.0.0.1:11434/v1", api: "openai-completions", auth: "none" },
  { id: "lm-studio", name: "LM Studio (local)", baseUrl: "http://127.0.0.1:1234/v1", api: "openai-completions", auth: "none" },
  { id: "llama-cpp", name: "llama.cpp / local server", baseUrl: "http://127.0.0.1:8080/v1", api: "openai-completions", auth: "none" },
  { id: "vllm", name: "vLLM / remote server", baseUrl: "http://127.0.0.1:8000/v1", api: "openai-completions", auth: "none" },
] as const;
