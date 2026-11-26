import antfu from '@antfu/eslint-config'

// LLM 只經 ai 套件（generateText 加 Output.object），比照 suanomics ADR 0004。
const BANNED_LLM_SDK = { message: 'LLM 呼叫走 ai 套件的 generateText 加 Output.object。' }

export default antfu(
  {
    typescript: true,
    stylistic: { semi: false, quotes: 'single' },
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.md', 'out/**', '**/__fixtures__/**/*.html'],
  },
  {
    files: ['**/*.ts'],
    rules: {
      'ts/no-explicit-any': 'error',
      'ts/no-non-null-assertion': 'error',
      'ts/consistent-type-imports': 'error',
    },
  },
  {
    rules: {
      'no-console': 'warn',
      'prefer-template': 'error',
      'pnpm/yaml-enforce-settings': 'off',
      'antfu/reasonable-newline': 'off',
    },
  },
  {
    files: ['**/*.{ts,js}'],
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      'no-restricted-imports': ['error', {
        paths: [
          { name: '@anthropic-ai/sdk', ...BANNED_LLM_SDK },
          { name: '@google/genai', ...BANNED_LLM_SDK },
          { name: 'openai', ...BANNED_LLM_SDK },
          { name: 'ai', importNames: ['generateObject'], message: 'generateObject 已 deprecated，用 generateText 加 Output.object。' },
        ],
      }],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
  },
)
