import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

function fixture(body: string) {
  const output = buildSync({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import {parseProgram, children, node, relocateImportMeta} from './src/shared/module-source.ts';
import {Parser} from 'acorn';
import {internalRecord} from './src/shared/primordials.ts';
${body}
`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
  }).outputFiles[0]!.text;
  const context = vm.createContext({});
  vm.runInContext(output, context);
  return JSON.parse(String(vm.runInContext('result', context)));
}

test('actual syntax nodes and arrays do not inherit application optional-field hooks', () => {
  const result = fixture(`
let hits=0;
Object.defineProperty(Object.prototype,'optionalSyntaxField',{configurable:true,get(){hits++;return 'injected';}});
Object.defineProperty(Object.prototype,'toJSON',{configurable:true,get(){hits++;return ()=> 'injected';}});
const tree=parseProgram('const item = object.field; const values = [1, 2];');
let records=0, arrays=0;
const visit=current=>{
 records++;
 if(current.optionalSyntaxField!==undefined)throw new Error('Inherited optional field');
 const values=children(current); arrays++;
 for(const child of values)visit(child);
};
visit(tree);
const serialized=JSON.stringify(tree);
globalThis.result=JSON.stringify(internalRecord({hits,records,arrays,serialized:serialized.includes('VariableDeclaration')}));
`);
  assert.equal(result.hits, 0);
  assert(result.records > 10);
  assert(result.arrays > 10);
  assert.equal(result.serialized, true);
});

test('syntax detachment ignores accessors and inherited descriptor value fields', () => {
  const result = fixture(`
let accessorHits=0,descriptorHits=0;
const identifier={type:'Identifier',start:0,end:4,name:'item'};
Object.defineProperty(identifier,'accessor',{enumerable:true,get(){accessorHits++;return 'unexpected';}});
const program={type:'Program',start:0,end:4,body:[identifier]};
program.cycle=program;
Parser.parse=()=>program;
Object.defineProperty(Object.prototype,'missingSyntaxField',{configurable:true,get(){accessorHits++;return 'unexpected';}});
Object.defineProperty(Object.prototype,'value',{configurable:true,get(){descriptorHits++;return 'unexpected';}});
const parsed=parseProgram('item');
const child=parsed.body[0];
globalThis.result=JSON.stringify({accessorHits,descriptorHits,optionalMissing:child.missingSyntaxField===undefined,cycle:parsed.cycle===parsed,recordDetached:Object.getPrototypeOf(Object.getPrototypeOf(child))===null,arrayDetached:Object.getPrototypeOf(Object.getPrototypeOf(parsed.body))===null});
`);
  assert.deepEqual(result, {
    accessorHits: 0,
    descriptorHits: 0,
    optionalMissing: true,
    cycle: true,
    recordDetached: true,
    arrayDetached: true,
  });
});
