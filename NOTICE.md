# Notices

pi-webui is a fork of [agegr/pi-web](https://github.com/agegr/pi-web) (MIT, see `LICENSE`).

Portions are adapted from [kahme247/ompweb](https://github.com/kahme247/ompweb), an
oh-my-pi web UI that is itself derived from pi-web, under the MIT License:

    Copyright (c) 2026 agegr

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

Adapted from ompweb:

| pi-webui | ompweb source |
|---|---|
| `lib/usage-{types,rates,service,db}.ts`, `components/UsageConfig.tsx`, `app/api/usage` | usage dashboard |
| `lib/stt.ts`, `lib/stt-jobs.ts`, `app/api/stt`, `hooks/useDictation.ts`, `components/RecordingDeck.tsx` | voice dictation |
| `lib/btw.ts`, `components/BtwPanel.tsx` | `/btw` side questions (record model and panel) |
| `bin/pi-webui-launchd.js` | `bin/omp-web-launchd.js` |
| `components/CommandPalette.tsx` | command palette (rewritten without cmdk) |
| `lib/omp/paths.ts`, `lib/omp/omp-cli.ts`, `lib/omp/rpc-frame.ts`, `lib/omp/rpc-process.ts` | omp process layer (with tests) |
| `lib/omp/omp-session.ts`, `lib/omp/omp-models.ts`, `lib/omp/omp-sessions.ts` | written for pi-webui, following ompweb's omp wrapper, models route and session-file handling |
