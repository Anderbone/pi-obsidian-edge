import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';

// Match the directory's Obsidian-specific checks; tsc checks the plugin types.
const rules = Object.assign({}, ...obsidianmd.configs.recommended.map(config =>
  Object.fromEntries(Object.entries(config.rules || {}).filter(([name]) => name.startsWith('obsidianmd/')))));
export default [{
  files: ['main.ts', 'src/**/*.ts', 'bridge/**/*.mts', 'shared/**/*.ts', 'tests/**/*.ts', 'dev/preview.mts'],
  plugins: { '@typescript-eslint': tseslint.plugin },
  languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.json' } },
  rules: { '@typescript-eslint/no-explicit-any': 'error' }
}, {
  files: ['main.ts', 'src/**/*.ts'],
  plugins: { obsidianmd },
  languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.json' } },
  rules: {
    ...rules,
    'obsidianmd/ui/sentence-case': ['warn', { brands: ['Pi', 'Pi Edge', 'Tailscale'], acronyms: ['MB'], ignoreRegex: ['^pi-edge:', '^ws://'] }],
    // Retain compatibility with Obsidian 1.7.2; the declarative settings API needs 1.13.
    'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
    // Match the source-code safety checks reported by the directory review.
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-argument': 'error',
    '@typescript-eslint/unbound-method': ['error', { ignoreStatic: true }],
    '@typescript-eslint/no-misused-promises': 'error'
  }
}];
