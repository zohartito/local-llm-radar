// Invented Ollama responses only. No network or hardware calls are made.
/* eslint-disable @typescript-eslint/no-require-imports -- Node preload fixture */
const fs = require('node:fs');
const childProcess = require('node:child_process');
childProcess.execFileSync = () => { throw new Error('Hardware commands forbidden in this fixture'); };
if (process.env.TEST_OUTPUT_SYMLINK) {
  const write = fs.writeFileSync;
  fs.writeFileSync = (file, data, options) => {
    if (String(file).endsWith('.json')) fs.symlinkSync(process.env.TEST_OUTPUT_SYMLINK, file);
    return write(file, data, options);
  };
}
globalThis.fetch = async (url) => {
  const route = new URL(url).pathname;
  if (route === '/api/version') return Response.json({ version: 'synthetic' });
  if (route === '/api/show') return Response.json({ details: { parameter_size: '1B' } });
  if (route === '/api/ps') return Response.json({ models: [] });
  if (route === '/api/generate') {
    return Response.json({ eval_count: 10, eval_duration: 1e9, prompt_eval_count: 20, prompt_eval_duration: 1e9 });
  }
  throw new Error(`Unexpected synthetic route: ${route}`);
};
