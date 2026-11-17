import type { ModelEntry } from '../shared/protocol';

// The phone picker is intentionally limited to the current everyday models.
// Keep provider configuration intact so existing conversations can still resume.
const pickerModels = new Set([
  'openai/gpt-6.1-sol',
  'openai/gpt-6.1-terra',
  'openai/gpt-6-astra',
  'openai/gpt-6-luna',
  'anthropic/claude-opus-5-5',
  'anthropic/claude-sonnet-5-5',
  'anthropic/claude-haiku-5-5',
  'anthropic/claude-fable-5-2'
]);

export function pickerCatalog(models: ModelEntry[]): ModelEntry[] {
  return models.filter(model => pickerModels.has(model.id));
}
