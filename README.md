# vite-cpat
A Vite plugin.

## Installation

```bash
yarn add vite-cpat
```

## Usage

```typescript
import { defineConfig } from 'vite';
import cpat from 'vite-cpat';

export default defineConfig({
  plugins: [
    cpat(),
  ],
});
```

If using Typescript add this to your types to allow for cpat imports.
```typescript
declare module '*.cpat' {
  import type { Pattern } from 'clarity-pattern-parser';
  const content: Record<string, Pattern>;
  export default content;

  export function compileWithParams(params: Pattern[]): Record<string, Pattern>;
}
```
