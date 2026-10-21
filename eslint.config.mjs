import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

// Match the directory's Obsidian-specific checks; tsc checks the plugin types.
const rules = Object.assign({}, ...obsidianmd.configs.recommended.map(config =>
  Object.fromEntries(Object.entries(config.rules || {}).filter(([name]) => name.startsWith('obsidianmd/')))));
export default [{
  files: ['main.ts', 'src/**/*.ts'],
  plugins: { obsidianmd },
  languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.json' } },
  rules: {
    ...rules,
    'obsidianmd/ui/sentence-case': ['warn', { brands: ['Pi', 'Pi Edge', 'Tailscale'], acronyms: ['MB'], ignoreRegex: ['^pi-edge:', '^ws://'] }],
    // Retain compatibility with Obsidian 1.7.2; the declarative settings API needs 1.13.
    'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
    // The shared UI and client also run in the standalone browser preview and Node tests.
    'obsidianmd/prefer-create-el': 'off'
  }
}, { files: ['src/client.ts'], rules: { 'obsidianmd/prefer-window-timers': 'off' } }];
