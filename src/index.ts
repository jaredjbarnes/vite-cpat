import fs from 'fs';
import type { Plugin, ResolvedConfig } from 'vite';
import { grammar, Node } from 'clarity-pattern-parser';

export async function generateJavaScriptFile(absolutePath: string, grammar: string, plugin: any, cpat: string) {

    const javascriptImports = await getCpatImports(absolutePath, grammar, plugin);

    return `
${javascriptImports}
import { Grammar } from 'clarity-pattern-parser'
import { CPAT_FS, resolver } from 'virtual:cpat-fs'

const fileContent = ${JSON.stringify(cpat)};
const filePath = ${JSON.stringify(absolutePath)};

CPAT_FS[filePath] = fileContent;

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

export function generateCpatFs() {
    return `
const baseUrl = new URL("https://tcn.com/");
const CPAT_FS = {};

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

async function getCpatImports(absolutePath: string, grammar: string, plugin: any) {
    const importPaths = getImportPaths(grammar);
    const absolutePaths: string[] = [];
    for (const path of importPaths) {
        const resolved = await plugin.resolve(path, absolutePath);
        if (resolved == null) {
            throw new Error(`Import ${path} not found`);
        }
        absolutePaths.push(resolved.id);
    }

    return absolutePaths.map(path => `import "${path}"`).join('\n');

}

function getImportPaths(cpatGrammar: string) {
    const results = grammar.exec(cpatGrammar);

    if (results.ast == null) {
        return [];
    }

    const nodes = results.ast.findAll((node) => node.name === "resource");
    return nodes.map((node) => node.value.slice(1, -1));
}

export function viteCpat(options?: { debug: boolean }): Plugin {
    let root: string;
    let cpatSources: Record<string, string> = {};
    const debug = options?.debug ?? false;

    function log(header: string, message: string) {
        if (!debug) return;
        console.log("************************************************");
        console.log(header);
        console.log("------------------------------------------------");
        console.log(message);
        console.log("************************************************");
    }

    return {
        name: 'vite-cpat',
        enforce: 'pre',

        buildStart() {
            cpatSources = {};
        },

        configResolved(config: ResolvedConfig) {
            root = config.root;
        },

        async resolveId(id: string, importer: string | undefined) {
            if (id.endsWith('.cpat')) {
                const resolved = await this.resolve(id, importer);

                if (resolved == null) {
                    return null;
                }

                const content = fs.readFileSync(resolved.id, 'utf-8');
                const normalizedContent = await normalizeImports(resolved.id, content, this);
                cpatSources[resolved.id] = normalizedContent;

                return resolved.id;
            }

            if (id.startsWith('virtual:cpat-fs')) {
                return "\0cpat-fs";
            }

            return null
        },

        load(id: string) {
            if (id.endsWith('.cpat')) {
                return cpatSources[id];
            }

            if (id.startsWith('\0cpat-fs')) {
                return generateCpatFs();
            }

            return null
        },

        async transform(code, id) {
            if (id.endsWith('.cpat')) {
                const imports = await getCpatImports(id, code, this);
                log(`Imports: ${id}`, JSON.stringify(imports));
                const generated = await generateJavaScriptFile(id, code, this, cpatSources[id]);
                log(`JavaScript File: ${id}`, generated);
                return { code: generated, map: null, moduleSideEffects: 'no-treeshake' };
            }

            if (id.startsWith('virtual:cpat-fs')) {
                return {
                    code,
                    map: null,
                    moduleSideEffects: 'no-treeshake'
                }
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