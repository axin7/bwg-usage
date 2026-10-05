import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', '.next/**', '.wrangler/**',
    '.output/**', '.vercel/**', 'next-env.d.ts'] },
  ...tseslint.configs.recommended,
  { files: ['*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
