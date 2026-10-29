import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { build } from './build.ts';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, firefox } from 'playwright';
import { launch } from './browser-profile.ts';

// These deliberately bounded alternatives are research fixtures, not a shipped
// compiler. Their mismatches identify the missing semantics before integration.
function lower(source: string, strategy: string) {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const edits: { start: number; end: number; text: string }[] = [];
  const declarations: { name: string; kind: string }[] = [];
  const hoisted: string[] = [];
  for (const statement of tree.body) {
    if (statement.type === 'VariableDeclaration') {
      if (strategy === 'top-level-var') {
        edits.push({
          start: statement.start,
          end: statement.start + statement.kind.length,
          text: 'var',
        });
        continue;
      }
      const initializers: string[] = [];
      for (const item of statement.declarations) {
        if (item.id.type !== 'Identifier') throw new Error('UnsupportedPattern');
        declarations.push({ name: item.id.name, kind: statement.kind });
        if (item.init || statement.kind !== 'var')
          initializers.push(
            `__realmInit(${JSON.stringify(item.id.name)},${item.init ? source.slice(item.init.start, item.init.end) : 'undefined'})`,
          );
      }
      edits.push({
        start: statement.start,
        end: statement.end,
        text: initializers.join(';') + ';',
      });
    } else if (statement.type === 'ClassDeclaration' && statement.id) {
      const name = statement.id.name;
      if (strategy === 'top-level-var') {
        edits.push({
          start: statement.start,
          end: statement.end,
          text: `var ${name}=(${source.slice(statement.start, statement.end)});`,
        });
      } else {
        declarations.push({ name, kind: 'class' });
        edits.push({
          start: statement.start,
          end: statement.end,
          text: `__realmInit(${JSON.stringify(name)},(${source.slice(statement.start, statement.end)}));`,
        });
      }
    } else if (
      strategy === 'scoped-cells' &&
      statement.type === 'FunctionDeclaration' &&
      statement.id
    ) {
      declarations.push({ name: statement.id.name, kind: 'function' });
      hoisted.push(
        `__realmInit(${JSON.stringify(statement.id.name)},(${source.slice(statement.start, statement.end)}));`,
      );
      edits.push({ start: statement.start, end: statement.end, text: ';' });
    }
  }
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  if (hoisted.length) {
    // Preserve a strict directive before injecting the hoisted declarations.
    const directiveEnd =
      tree.body.find(
        (node) => node.type !== 'ExpressionStatement' || !('directive' in node),
      )?.start ?? source.length;
    const adjusted = edits
      .filter((edit) => edit.end <= directiveEnd)
      .reduce(
        (sum, edit) => sum + edit.text.length - (edit.end - edit.start),
        directiveEnd,
      );
    output = output.slice(0, adjusted) + hoisted.join('') + output.slice(adjusted);
  }
  return { source: output, declarations };
}

const cases = [
  {
    name: 'lexicals-and-reflection',
    scripts: ['let hidden=3;const fixed=5;class Box {}'],
    query:
      '[hidden,fixed,typeof Box,Object.hasOwn(globalThis,"hidden"),Object.hasOwn(globalThis,"fixed"),Object.hasOwn(globalThis,"Box")]',
  },
  {
    name: 'forward-closure',
    scripts: ['function readLater(){return later}', 'let later=7;'],
    query: 'readLater()',
  },
  {
    name: 'temporal-dead-zone',
    scripts: [
      'globalThis.tdz=(()=>{try{return typeof value}catch(e){return e.name}})();let value=1;',
    ],
    query: 'tdz',
  },
  {
    name: 'constant-assignment',
    scripts: [
      'const fixed=5;globalThis.assignment="allowed";try{fixed=6}catch(e){assignment=e.name}',
    ],
    query: 'assignment',
  },
  {
    name: 'redeclaration-rejects-whole-script',
    scripts: [
      'let repeated=1;globalThis.secondRan=false;',
      'globalThis.secondRan=true;let repeated=2;',
    ],
    query: '[secondRan,repeated]',
  },
  {
    name: 'strict-global-var',
    scripts: ['"use strict";var strictValue=4;'],
    query: '[strictValue,Object.hasOwn(globalThis,"strictValue")]',
  },
  {
    name: 'destructuring',
    scripts: ['let {amount=11}={};const [first,...remaining]=[1,2,3];'],
    query: '[amount,first,remaining.join(","),Object.hasOwn(globalThis,"amount")]',
  },
  {
    name: 'direct-eval-global-var',
    scripts: ['eval("var fromEval=12");'],
    query: '[fromEval,Object.hasOwn(globalThis,"fromEval")]',
  },
  {
    name: 'direct-eval-local-lexical',
    scripts: [
      'globalThis.localEval=(function(){let value=1;eval("value=2");return value})();',
    ],
    query: 'localEval',
  },
  {
    name: 'indirect-eval-global-property',
    scripts: ['globalThis.publicValue=23;'],
    query: '(0,eval)("publicValue")',
  },
  {
    name: 'Function-construction-native-control',
    scripts: [],
    query:
      '(()=>{try{return new Function("return 24")()}catch(e){return e.name+":"+e.message}})()',
  },
  {
    name: 'indirect-eval-global-lexical',
    scripts: ['let value=9;globalThis.indirect=(0,eval)("value");'],
    query: 'indirect',
  },
  {
    name: 'Function-global-lexical',
    scripts: ['let value=9;globalThis.constructed=new Function("return value");'],
    query: 'constructed()',
  },
  {
    name: 'recovered-Function-global-lexical',
    scripts: ['let value=9;globalThis.recovered=(()=>{}).constructor("return value");'],
    query: 'recovered()',
  },
  {
    name: 'closure-observes-future-eval-var',
    scripts: ['function future(){return introduced}', 'eval("var introduced=13");'],
    query: 'future()',
  },
  {
    name: 'dynamic-classic-script',
    scripts: ['globalThis.beforeDynamic=()=>dynamicValue;'],
    dynamic: 'let dynamicValue=17;',
    query: 'beforeDynamic()',
  },
  {
    name: 'failed-script-retains-lexical',
    scripts: ['let survived=18;throw new Error("expected");'],
    query: 'survived',
  },
  {
    name: 'sloppy-block-global-var',
    scripts: ['if(true){var blockValue=19}'],
    query: '[blockValue,Object.hasOwn(globalThis,"blockValue")]',
  },
  {
    name: 'lexical-conflicts-with-earlier-var',
    scripts: ['var collision=1;', 'let collision=2;'],
    query: 'collision',
  },
];

const continuationBootstrap = `(()=>{
  let next;
  const save=value=>{next=value};
  next=source=>eval(source);
  return source=>{const strict=/^\\s*(["'])use strict\\1\\s*;?/.exec(source);const offset=strict?strict[0].length:0;return next(source.slice(0,offset)+';save(source=>eval(source));'+source.slice(offset)+'\\n;void 0');};
})()`;
const cellsBootstrap = `(()=>{
  const bindings=new Map();
  const scope=new Proxy(Object.create(null),{
    has(_target,key){return bindings.has(key)},
    get(_target,key){if(key===Symbol.unscopables)return undefined;const cell=bindings.get(key);if(!cell.initialized)throw new ReferenceError('Uninitialized binding');return cell.value},
    set(_target,key,value){const cell=bindings.get(key);if(!cell.initialized)throw new ReferenceError('Uninitialized binding');if(!cell.mutable)throw new TypeError('Constant assignment');cell.value=value;return true}
  });
  const __realmInit=(name,value)=>{const cell=bindings.get(name);if(cell){cell.value=value;cell.initialized=true}else{globalThis[name]=value}return value};
  function evaluate(source){with(scope){return eval(source)}}
  return (source,serialized)=>{
    const declarations=JSON.parse(serialized);
    for(const item of declarations){if(bindings.has(item.name))throw new SyntaxError('Redeclaration');}
    for(const item of declarations){if(item.kind==='var'||item.kind==='function'){if(!Object.hasOwn(globalThis,item.name))Object.defineProperty(globalThis,item.name,{value:undefined,writable:true,enumerable:true,configurable:false})}else bindings.set(item.name,{value:undefined,initialized:false,mutable:item.kind!=='const'});}
    return evaluate(source+'\\n;void 0');
  };
})()`;

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'ts',
    contents: `import {createApplicationRealm} from './test/realm-research/realms/index.ts';
      const pending=new Map();let requestId=0;
      window.addEventListener('message',event=>{if(event.source!==window||event.origin!==location.origin||event.data?.type!=='classic-lowered')return;const callback=pending.get(event.data.id);if(callback){pending.delete(event.data.id);callback(event.data)}});
      const compile=(source,strategy)=>new Promise((resolve,reject)=>{const id=++requestId;pending.set(id,message=>message.error?reject(new Error(message.error)):resolve(message.result));window.dispatchEvent(new CustomEvent('classic-compile',{detail:JSON.stringify({id,source,strategy})}));});
      globalThis.runClassic=async(backend,strategy,item)=>{
        let realm,frame,run;
        const errors=[];
        try{
          if(strategy==='browser-script'){
            frame=document.createElement('iframe');document.body.append(frame);
            const win=frame.contentWindow;win.addEventListener('error',event=>{errors.push(event.error?.name||'Error');event.preventDefault()});
            run=source=>{const script=win.document.createElement('script');script.textContent=source;win.document.head.append(script);script.remove();};
          }else{
            realm=createApplicationRealm(backend);
            const evaluate=source=>realm.evaluate(source);
            const continuation=strategy==='continuation'?evaluate(${JSON.stringify(continuationBootstrap)}):null;
            const cells=strategy==='scoped-cells'?evaluate(${JSON.stringify(cellsBootstrap)}):null;
            run=async source=>{try{if(continuation)continuation(source);else if(strategy==='scoped-cells'){const lowered=await compile(source,strategy);cells(lowered.source,JSON.stringify(lowered.declarations));}else if(strategy==='top-level-var'){const lowered=await compile(source,strategy);evaluate(lowered.source+'\\n;void 0');}else evaluate(source+'\\n;void 0')}catch(error){errors.push(String(error).match(/(?:SyntaxError|ReferenceError|TypeError|UnsupportedPattern)/)?.[0]||'Error')}};
          }
          for(const source of item.scripts)await run(source);
          if(item.dynamic){await new Promise(resolve=>setTimeout(resolve,0));await run(item.dynamic)}
          let value;
          if(frame){run('globalThis.__classicResult=JSON.stringify('+item.query+');');value=frame.contentWindow.__classicResult;}
          else {
            // Query within the SAME retained lexical environment. Its result is a
            // primitive string, rather than a host object escaping the boundary.
            await run('globalThis.__classicResult=JSON.stringify('+item.query+');');
            value=realm.evaluate('globalThis.__classicResult');
          }
          return {errors,value:value===undefined?null:JSON.parse(value)};
        }finally{realm?.revoke();frame?.remove()}
      };`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2022',
});
const server = http.createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader(
    'Content-Type',
    request.url === '/spike.js' ? 'text/javascript' : 'text/html',
  );
  response.end(
    request.url === '/spike.js'
      ? bundle.outputFiles[0].text
      : '<!doctype html><body><script src="/spike.js"></script>',
  );
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const receipt = {
  provenance: {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    capturedAt: new Date().toISOString(),
    runnerSHA256: createHash('sha256')
      .update(await readFile(new URL(import.meta.url)))
      .digest('hex'),
    scope:
      'Classic-script semantic research, isolated realm adapters. Candidate lowerings are deliberately unqualified; mismatches are recorded, not accepted as compatibility.',
  },
  results: [] as {
    browser: string;
    version: string;
    backend: string;
    case: string;
    strategy: string;
    expected: unknown;
    actual: unknown;
    matches: boolean;
  }[],
};
try {
  for (const [engine, backend, args] of [
    [chromium, 'native', ['--js-flags=--harmony-shadow-realm']],
    [chromium, 'membrane', []],
    [firefox, 'membrane', []],
  ] as const) {
    const browser = await launch(engine, { args: [...args] });
    try {
      const page = await browser.newPage();
      await page.exposeFunction('lowerClassic', (source: string, strategy: string) =>
        lower(source, strategy),
      );
      await page.goto('http://127.0.0.1:' + address.port);
      await page.evaluate(() => {
        window.addEventListener('classic-compile', async (event) => {
          const request = JSON.parse(event.detail);
          try {
            const result = await globalThis.lowerClassic(
              request.source,
              request.strategy,
            );
            window.postMessage(
              { type: 'classic-lowered', id: request.id, result },
              location.origin,
            );
          } catch (error) {
            window.postMessage(
              { type: 'classic-lowered', id: request.id, error: String(error) },
              location.origin,
            );
          }
        });
      });
      for (const item of cases) {
        const expected = await page.evaluate(
          ({ backend, item }) => globalThis.runClassic(backend, 'browser-script', item),
          { backend, item },
        );
        if (item.name === 'lexicals-and-reflection')
          assert.deepEqual(expected, {
            errors: [],
            value: [3, 5, 'function', false, false, false],
          });
        if (item.name === 'forward-closure')
          assert.deepEqual(expected, { errors: [], value: 7 });
        if (item.name === 'temporal-dead-zone')
          assert.deepEqual(expected, { errors: [], value: 'ReferenceError' });
        if (item.name === 'constant-assignment')
          assert.deepEqual(expected, { errors: [], value: 'TypeError' });
        if (item.name === 'redeclaration-rejects-whole-script')
          assert.deepEqual(expected, { errors: ['SyntaxError'], value: [false, 1] });
        if (item.name === 'strict-global-var')
          assert.deepEqual(expected, { errors: [], value: [4, true] });
        if (item.name === 'Function-global-lexical')
          assert.deepEqual(expected, { errors: [], value: 9 });
        for (const strategy of [
          'evaluate',
          'top-level-var',
          'continuation',
          'scoped-cells',
        ]) {
          const actual = await page.evaluate(
            ({ backend, strategy, item }) =>
              globalThis.runClassic(backend, strategy, item),
            { backend, strategy, item },
          );
          // Native ShadowRealm intentionally replaces escaping guest exceptions
          // with TypeError. Compare rejection counts and guest-observed values;
          // retain the original classes in the receipt for diagnosis.
          const matches =
            expected.errors.length === actual.errors.length &&
            JSON.stringify(expected.value) === JSON.stringify(actual.value);
          receipt.results.push({
            browser: engine.name(),
            version: browser.version(),
            backend,
            case: item.name,
            strategy,
            expected,
            actual,
            matches,
          });
          console.log(JSON.stringify(receipt.results.at(-1)));
        }
      }
      await page.close();
    } finally {
      await browser.close();
    }
  }
  // The spike must retain genuine native controls and demonstrate the known
  // counterexamples. A candidate mismatch is evidence, not a test runner error.
  assert(
    receipt.results.some(
      (row) =>
        row.strategy === 'continuation' && row.case === 'forward-closure' && !row.matches,
    ),
  );
  assert(
    receipt.results.some(
      (row) =>
        row.strategy === 'top-level-var' &&
        row.case === 'constant-assignment' &&
        !row.matches,
    ),
  );
  assert(
    receipt.results.some(
      (row) =>
        row.strategy === 'scoped-cells' &&
        row.case === 'Function-global-lexical' &&
        !row.matches,
    ),
  );
  await mkdir('results/realms', { recursive: true });
  await writeFile(
    process.env.REALM_RESULTS || 'results/realms/classic-spike.json',
    JSON.stringify(receipt, null, 2) + '\n',
  );
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
