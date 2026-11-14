/* eslint-disable @typescript-eslint/no-require-imports */
/*
 * Static guard for the intentionally absent credentialed AI PR reviewer.
 * This is test/CI tooling only; js-yaml is already locked as a dev dependency.
 */
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const PR_EVENTS = new Set(['pull_request', 'pull_request_target']);
const AI_MARKETPLACE_ACTION = /(?:claude|anthropic|openai|codex|gemini|copilot|llm|ai[-_]?review)/i;
const AI_SHELL_CAPABILITY = /(?:\bclaude\b|\bcodex\s+(?:exec|review|app-server)\b|\bnpx\s+(?:--yes\s+)?@(?:openai|anthropic|google)\/(?:codex|claude|gemini)|\bgemini\b|\bcopilot\b)/i;
const SECRET_REFERENCE = /\bsecrets\s*(?:\.|\[)/i;
const CREDENTIAL_KEY_SUFFIXES = new Set([
  'api_key', 'api_token', 'access_token', 'auth_token', 'bearer_token',
  'client_secret', 'private_key', 'github_token', 'gh_token', 'password',
  'secret', 'token', 'credential', 'credentials',
]);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedText(value) {
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).toLowerCase();
  if (Array.isArray(value)) return value.map(normalizedText).join('\n');
  if (isRecord(value)) return Object.entries(value).map(([key, nested]) => `${key}\n${normalizedText(nested)}`).join('\n');
  return '';
}

function collectScalarValues(value, values = []) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    values.push(String(value));
    return values;
  }
  if (Array.isArray(value)) {
    for (const nested of value) collectScalarValues(nested, values);
    return values;
  }
  if (isRecord(value)) {
    for (const nested of Object.values(value)) collectScalarValues(nested, values);
  }
  return values;
}

function hasPrTrigger(on) {
  if (typeof on === 'string') return PR_EVENTS.has(on);
  if (Array.isArray(on)) return on.some((event) => hasPrTrigger(event));
  return isRecord(on) && Object.keys(on).some((event) => PR_EVENTS.has(event));
}

function collectFields(value, wanted, values = []) {
  if (Array.isArray(value)) {
    for (const nested of value) collectFields(nested, wanted, values);
    return values;
  }
  if (!isRecord(value)) return values;
  for (const [key, nested] of Object.entries(value)) {
    if (wanted.has(key)) values.push({ key, value: nested, text: normalizedText(nested) });
    collectFields(nested, wanted, values);
  }
  return values;
}

function permissionAllowsWrite(value) {
  if (typeof value === 'string') return ['write', 'write-all'].includes(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.some(permissionAllowsWrite);
  if (!isRecord(value)) return false;
  return Object.values(value).some(permissionAllowsWrite);
}

function hasWritePermission(value) {
  if (Array.isArray(value)) return value.some(hasWritePermission);
  if (!isRecord(value)) return false;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'permissions' && permissionAllowsWrite(nested)) return true;
    if (hasWritePermission(nested)) return true;
  }
  return false;
}

function hasExplicitSecretsDeclaration(value) {
  if (Array.isArray(value)) return value.some(hasExplicitSecretsDeclaration);
  if (!isRecord(value)) return false;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'secrets') {
      if (nested === 'inherit') return true;
      if (isRecord(nested) && Object.keys(nested).length > 0) return true;
      if (Array.isArray(nested) && nested.length > 0) return true;
    }
    if (hasExplicitSecretsDeclaration(nested)) return true;
  }
  return false;
}

function credentialKeySuffix(key) {
  return key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function isCredentialKey(key) {
  const normalized = credentialKeySuffix(key);
  return [...CREDENTIAL_KEY_SUFFIXES].some((suffix) => normalized === suffix || normalized.endsWith(`_${suffix}`));
}

function hasNonEmptyCredentialValue(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  return typeof value === 'number' && Number.isFinite(value);
}

function hasGenericCredentialField(value) {
  if (Array.isArray(value)) return value.some(hasGenericCredentialField);
  if (!isRecord(value)) return false;
  for (const [key, nested] of Object.entries(value)) {
    // Permission labels such as `id-token: none` are authority declarations,
    // not credential values. `hasWritePermission` owns that structured subtree.
    if (key === 'permissions') continue;
    if (isCredentialKey(key) && hasNonEmptyCredentialValue(nested)) return true;
    if (hasGenericCredentialField(nested)) return true;
  }
  return false;
}

function hasCredentialAuthority(workflow) {
  if (hasWritePermission(workflow)) return true;
  if (hasExplicitSecretsDeclaration(workflow) || hasGenericCredentialField(workflow)) return true;
  // GitHub expressions can occur in `run`, `env`, `with`, reusable-workflow
  // calls, or future scalar fields. Dump the parsed scalar set so both
  // `secrets.NAME` and `secrets['NAME']` survive normalization and are checked
  // without relying on a particular YAML layout.
  const serializedScalars = yaml.dump(collectScalarValues(workflow), { lineWidth: -1, noRefs: true });
  return SECRET_REFERENCE.test(serializedScalars);
}

function hasAiExecution(workflow) {
  const uses = collectFields(workflow, new Set(['uses']));
  if (uses.some(({ text }) => AI_MARKETPLACE_ACTION.test(text))) return true;
  const executableFields = collectFields(workflow, new Set(['run', 'env', 'with']));
  return executableFields.some(({ text }) => AI_SHELL_CAPABILITY.test(text));
}

function parseWorkflow(content) {
  const workflow = yaml.load(content, { json: true });
  if (!isRecord(workflow)) throw new Error('workflow must be a YAML mapping');
  return workflow;
}

/** Returns true when the tombstoned credentialed AI PR-review capability exists. */
function hasCredentialedAiPrReview(content) {
  try {
    const workflow = parseWorkflow(content);
    return hasPrTrigger(workflow.on) && hasAiExecution(workflow) && hasCredentialAuthority(workflow);
  } catch {
    // A malformed workflow cannot be proven free of the forbidden capability.
    return true;
  }
}

function validateWorkflowDirectory(workflowDirectory) {
  const violations = [];
  for (const filename of readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/i.test(name))) {
    if (hasCredentialedAiPrReview(readFileSync(path.join(workflowDirectory, filename), 'utf8'))) violations.push(filename);
  }
  return violations;
}

if (require.main === module) {
  const violations = validateWorkflowDirectory(path.join(process.cwd(), '.github', 'workflows'));
  if (violations.length > 0) throw new Error(`Credentialed AI PR-review workflow forbidden: ${violations.join(', ')}`);
}

module.exports = { hasCredentialedAiPrReview, validateWorkflowDirectory };
