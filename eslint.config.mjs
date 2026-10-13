// Flat config. Deliberately small: the point of the lint step in the pipeline
// is to catch real mistakes (unused variables, undeclared globals, accidental
// redeclaration) before a build is packaged, not to enforce a house style.
export default [
    {
        files: ['src/**/*.js', 'test/**/*.js', 'scripts/**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                process: 'readonly',
                console: 'readonly',
                URL: 'readonly',
                fetch: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                Buffer: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['error', { args: 'none' }],
            'no-undef': 'error',
            'no-redeclare': 'error',
            'no-dupe-keys': 'error',
            'no-unreachable': 'error',
            'no-constant-condition': 'warn',
        },
    },
];
