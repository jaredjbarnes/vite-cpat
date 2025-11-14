import fs from 'fs';
import type { Plugin, ResolvedConfig } from 'vite';
import { grammar, Node } from 'clarity-pattern-parser';

export async function generateJavaScriptFile(absolutePath: string, grammar: string, plugin: any, fsIndex: number) {
    const importPaths = getImportPaths(grammar);
    const absolutePaths: string[] = [];
    for (const path of importPaths) {
        const resolved = await plugin.resolve(path, absolutePath);
        if (resolved == null) {
            throw new Error(`Import ${path} not found`);
        }
        absolutePaths.push(resolved.id);
    }

    const javascriptImports = absolutePaths.map(path => `import "${path}"`).join('\n');

    return `
${javascriptImports}
import { Grammar } from 'clarity-pattern-parser'
import { CPAT_FS, resolver } from 'virtual:cpat-fs${fsIndex}'

const filePath = ${JSON.stringify(absolutePath)};
const fileContent = CPAT_FS[filePath];

const pattern = Grammar.parseString(fileContent, {
    resolveImportSync: resolver,
    originResource: filePath
});

export default pattern;

export function compileWithParams(params){
    const pattern = Grammar.parseString(fileContent, {
        resolveImportSync: resolver,
        originResource: filePath,
        params
    });

    return pattern;
}
`
}

export function generateRootCpatFS() {
    return `
const CPAT_FS = {};
const baseUrl = new URL("https://tcn.com/");

function resolver(toPath, fromPath) {
    const fromUrl = new URL(fromPath, baseUrl);
    const toUrl = new URL(toPath, fromUrl);
    const path = toUrl.pathname;

    const expression = CPAT_FS[path];

    if (expression == null) {
        throw new Error(\`Resource \${ path } not found\`);
    }

    return { resource: path, expression };
}

export { CPAT_FS, resolver };
`;
}

export function generateFSBatch(entries: Record<string, string>) {
    return `
import { CPAT_FS, resolver } from 'virtual:cpat-fs';

${Object.keys(entries).map(key => `CPAT_FS[${JSON.stringify(key)}] = ${JSON.stringify(entries[key])};`).join('\n')}

export { CPAT_FS, resolver };`;

}

async function normalizeImports(filePath: string, content: string, plugin: any) {
    const results = grammar.exec(content);

    if (results.ast == null) {
        return content;
    }

    const nodes = results.ast.findAll((node) => node.name === "resource");

    for (const node of nodes) {
        const resolved = await plugin.resolve(node.value.slice(1, -1), filePath);
        if (resolved == null) {
            return content;
        }
        node.replaceWith(Node.createValueNode(node.type, node.name, '"' + resolved.id + '"'));
    }

    return results.ast.toString();
}

const cpatImportRegex = /import .*? from "(.+)"/gi;

function getImportPaths(cpatGrammar: string) {
    const results = [];
    let match: RegExpExecArray | null = null;

    while ((match = cpatImportRegex.exec(cpatGrammar)) !== null) {
        results.push(match[1]);
    }

    return results
}

export function viteCpat(): Plugin {
    let root: string;
    let fsBatch: Record<string, string> = {};
    let fsIndex: number = 0;

    return {
        name: 'vite-cpat',
        enforce: 'pre',

        buildStart() {
            fsBatch = {};
        },

        configResolved(config: ResolvedConfig) {
            root = config.root;
        },

        async resolveId(id: string, importer: string | undefined) {

            if (id === "virtual:cpat-fs") {
                return "\0cpat-fs"
            }

            if (id.startsWith('virtual:cpat-fs')) {
                return `\0cpat-fs${fsIndex}`
            }

            if (id.endsWith('.cpat')) {
                const resolved = await this.resolve(id, importer);

                if (resolved == null) {
                    return null;
                }

                const content = fs.readFileSync(resolved.id, 'utf-8');
                const normalizedContent = await normalizeImports(resolved.id, content, this);
                fsBatch[resolved.id] = normalizedContent;

                return resolved.id;
            }

            return null
        },

        load(id: string) {
            if (id === "\0cpat-fs") {
                const generated = generateRootCpatFS();
                return generated;
            }

            if (id === `\0cpat-fs${fsIndex}`) {
                const generated = generateFSBatch(fsBatch);
                fsBatch = {};
                fsIndex++;

                return generated;
            }

            return null;
        },

        async transform(code, id) {
            if (id.endsWith('.cpat')) {
                const generated = await generateJavaScriptFile(id, code, this, fsIndex);
                return { code: generated, map: null, moduleSideEffects: 'no-treeshake' };
            }

            return null;
        },

        handleHotUpdate({ file, server }) {
            if (file.endsWith('.cpat')) {
                server.ws.send({ type: 'full-reload' })
            }
        },


    };
}

export default viteCpat;