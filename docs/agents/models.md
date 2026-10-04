# Models and provider auth

## Native OMP editors (pi-omp branch)
Settings › Models uses `OmpModelsConfig` and `OmpSettingsEditor` with `/api/omp/models-config`
and `/api/omp/settings`. They write OMP's `models.yml`/`config.yml`, never Pi's settings.
`lib/omp/config-store.ts` parses a bounded regular-file YAML mapping, applies AST edits,
checks the caller's source revision under a lock, backs up the original with mode 0600,
and atomically replaces the resolved target (preserving file symlinks). Parser diagnostics
must never include a credential line. Invalid input/config is refused; there is no forced overwrite.
`models-config.ts` masks credentials, all header values, and credential-bearing URLs;
masked values restore by path and model id on save. Neither readers nor validation evaluate
credential commands. Custom provider changes preserve untouched providers and top-level fields.
`settings-config.ts` asks the installed CLI for its schema with the same agent dir/profile
rules as the RPC child, then exposes only reviewed keys. Scoped enabledModels/disabledProviders
arrays cannot be overwritten by this editor. Native OMP globals still yield to project/env overrides.
The composer default-star request includes the session's runtime; OMP saves default roles and
thinking through this store and refuses native project-shadowed defaults. Config changes dispose
the OMP model utility and emit `pi-webui:models-changed` for composers to refresh.
Dependency: explicit `yaml@2.9.0` for comment-preserving AST edits. `npm audit` reported no
finding for yaml when added; existing audit findings are not changed by this work.

## Model defaults for new sessions
`GET /api/models` returns `defaultModel` from `~/.pi/agent/settings.json`; `ChatWindow` pre-selects it for new sessions. Browser model/thinking picks are applied atomically while the AgentSession is built and are **session-scoped**: neither startup nor a mid-session `set_model` / `set_thinking_level` writes `settings.json`, as pi's `/model` and `/thinking` persist only on Ctrl+S (otherwise a one-off pick becomes the TUI's default too).

Saving a default is the star on each row of the model selector and the reasoning menu (pi's Ctrl+S): `PUT /api/models/default` writes `defaultProvider`/`defaultModel` or `defaultThinkingLevel` (`lib/default-preferences.ts`), and the hook also selects that row for the current chat. The route accepts only a model in the resolved `enabledModels` scope, so a saved default always takes effect, and answers `409 { reason: "project-scope", settingsPath }` when the project's `.pi/settings.json` sets a key it would write, since that value wins. The model star marks the resolved `defaultModel`; the reasoning star marks `savedDefaultThinkingLevel`, the raw setting, because the resolved `defaultThinkingLevel` folds in `:level` pins and per-model levels the global write does not change. Both menus render `SelectorRow`; `ModelSelector` shows stars only when given `onSetDefault`, which the subagent profile form does not pass.

The reasoning control stays usable while a run streams: pi-agent-core snapshots `reasoning` when a run starts, but `AgentSession`'s `prepareRequest` / `prepareNextTurnWithContext` re-read `agent.state.thinkingLevel` before every model request, so `set_thinking_level` applies from the next request (the response already streaming keeps its level). `lib/thinking-level-mid-run.integration.test.mjs` pins this; if an SDK upgrade breaks it, disable the control while streaming rather than let it change nothing.

## Remote provider catalogs
Built-in model lists are frozen at the pinned SDK version; newer models come from the SDK's pi.dev catalog overlay, which `ModelRuntime.refresh()` persists to `~/.pi/agent/models-store.json` (the pi CLI fills it too) and which restores offline. pi-web's own runtimes only restore it (`allowNetwork: false` / `refreshOnCreate: false`, listed in the header of `lib/model-catalog-refresh.ts`). That module's network pass runs **only when the user asks** (the "Refresh catalog" button in `EnabledModelsSection` → `/api/models/refresh`), never on a timer or on another request's path, which must not wait on a slow catalog. It calls `refresh()` with `force: true` and never `allowNetwork`, so pi's `PI_OFFLINE` rule holds (`reason: "offline"`), and `shareModelCatalogRefresh()` joins concurrent presses for the same providers. The route returns no model list: a change runs `invalidateModelsCache()` and reloads the panel, whose ordinary `/api/models` and `/api/models/enabled` loads build a fresh runtime that restores the store.

## `enabledModels` scoping
`enabledModels` uses pi's `--models` syntax: minimatch globs against `provider/modelId` or a bare `modelId`, fuzzy matching for non-glob patterns, an optional `:thinkingLevel` suffix. Never compare patterns as strings: `lib/model-scope.ts` delegates to the SDK's `resolveModelScopeWithDiagnostics()` so pi-web and the TUI agree, and falls back to every available model when the patterns resolve to nothing. `startRpcSession()` resolves the scope before creating an AgentSession and passes the initial model, thinking pin and SDK-native `scopedModels` atomically; `GET /api/models` uses the helper only for selector data, `thinkingLevelPins` and `modelScopeWarnings`.

The Models panel edits it only through `/api/models/enabled`, never with patterns composed in the browser. Every toggle is a **minimal edit** (`lib/enabled-models.ts`, ADR 0004): an unmatched pattern stays verbatim, only the pattern covering a switched-off model is expanded in place (keeping its `:level`), and a fully enabled provider with two or more entries collapses into one glob (an enumerated list rots when a catalog renames a model); a lone exact reference stays. Never rewrite the whole list from `getAvailable()` like the TUI's `/scoped-models`: it sees only providers passing `checkAuth()` right now, so it would drop a signed-out provider's entries and flatten globs and pins. **Never assume `provider/*` covers a provider**: minimatch's `*` stops at `/`, missing nested ids (`commandcode/sakana/fugu-ultra`, most OpenRouter ids); `resolveProviderGlobs()` keeps `provider/*` or `provider/**` only when it matches exactly the provider's models, else writes the provider model by model.

- Switching off the last enabled model is refused, `409 { reason: "last-model" }`: an empty scope means every model.
- Writes go to the global settings file only. A project `.pi/settings.json` `enabledModels` replaces the global array, so the route reports `scope: "project"` and the switches are read-only. The route returns the deciding file as `settingsPath`, which the banner names with the count (`~/.pi/agent/settings.json · enabledModels 20/104`).
- Built-in and extension-registered providers get per-model switches; a models.json provider gets one `EnabledModelsProviderSwitch` in its detail header beside Delete (ADR 0004), on only while all its models are on, so a partial selection reads off beside the sidebar's `1/2` and one click completes it. Why a switch cannot move (the last enabled models, a project scope, the provider missing from the runtime) is the note under the detail header (`EnabledModelsProviderSwitchNote`), which the switch points at with `aria-describedby`; a built-in provider's rows and Disable all point at the section's scope and last-model notes likewise. A tooltip alone never shows on a touch screen ([settings-ui.md](settings-ui.md); ADR 0004 records the change).
- A models.json provider missing from the runtime (unsaved edits, no models, a key that does not work) is never reported as a sign-in problem: its switch is disabled with that note, while `EnabledModelsSection` (built-in providers only) keeps the sign-in empty state.
- `op: "prune"` is the only operation that drops unmatched entries (cleanup after a catalog rename); `op: "clear"` removes the setting; every other operation preserves them.
- Saving models.json calls `op: "resync"`, the only operation that repairs entries (a toggle never touches what the user did not switch): it rewrites renamed models, then renamed providers (model references still spell the old provider id), cuts back entries whose provider prefix no longer scopes them, and re-asserts providers fully enabled before the save. Otherwise a rename corrupts the scope: pi also matches the bare `modelId`, so a provider renamed to `stepfun` makes `stepfun/*` enable `commandcode`'s `stepfun/Step-5-Preview`; a model renamed to an id with a slash leaves `provider/*`; a renamed sole entry resolves to nothing, i.e. every model. `ModelsConfig` must mirror every draft array move in `savedModelIdsRef` so `collectModelRenames()` can tell a rename from an add or a delete.

## Auth and model config
- `ModelsConfig` combines `~/.pi/agent/models.json` with provider auth status from pi's `ModelRuntime` (`/api/auth/providers`, through `createModelRuntimeWithExtensions()`).
- Provider listing is capability-driven, never id-driven: `lib/provider-listing.ts` decides membership from `auth.apiKey.login` / `auth.oauth` plus the stored credential type, so a dual-auth provider (anthropic, github-copilot and others; the set changes between SDK releases) appears exactly once. `lib/provider-listing-runtime.ts` adapts `ModelRuntime` to it.
- auth.json holds **one** credential per provider and `ModelRuntime.logout()` deletes whichever it is, so the delete routes use `removeStoredCredentialIfType()`, which compares and deletes under pi's auth-file lock. After any auth change `ModelsConfig` refreshes *both* provider lists, or a dual-auth provider renders twice.
- OAuth/device-code/manual-code flows stream from `GET /api/auth/login/[provider]`; a manual code POSTs back with a short-lived token kept in `globalThis.__piLoginCallbacks`.
- API-key routes store and remove keys through `lib/provider-credential-store.ts` (`storeProviderCredential()` / `removeStoredCredentialIfType()`), not `AuthStorage`, and never through `ModelRuntime.login()`, which runs an unbounded catalog refresh. Status endpoints never return the raw key.
- The model test route is `app/api/models-config/test/route.ts`; `app/api/models/test/` does not exist.

### OMP provider UI parity

- `OmpModelsConfig` reuses Pi's `ProviderDetail`, `ModelDetail`, `OAuthDetail`
  and `AddProviderPicker`. Optional endpoint props default to Pi URLs, so OMP
  discovery/login never reaches Pi credentials or enabled-model settings.
- OMP bulk saves use one revision/lock/backup for all providers; secret markers
  restore by provider and model ID. Saved provider IDs are fixed to avoid moving
  credentials or leaving role references dangling. Model forms preserve unknown
  native fields, and the thinking editor writes native `thinking.efforts` and
  `thinking.effortMap`, excluding Pi's `off` pseudo-level.
- `/api/omp/providers` reads the installed CLI's model and login registries.
  Native login bridges OMP extension input/select/confirm frames through SSE
  and a provider-bound token. Native credential removal is still terminal-only.
- `/api/omp/models-config/discover` uses the entered endpoint and OMP-only
  credentials. It does not execute command references, follow redirects, return
  upstream error bodies, or forward stored keys to a changed unsaved endpoint.
  The test action only checks whether `/models` lists the requested ID; it does
  not claim that inference, tools or OAuth provider acceptance has passed.
- `provider-presets.ts` contains editable cloud/local endpoint templates. Native
  login provider names come from OMP; these include more than OAuth subscriptions.
