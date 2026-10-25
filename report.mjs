import {marked} from 'marked';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const source=await readFile(new URL('./REPORT.md',import.meta.url),'utf8');
const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Static application host — Research report</title><link rel="stylesheet" href="./host.css"><style>main{max-width:850px}main h1{font-size:30px;line-height:1.2}main h2{margin-top:40px}main p,main li{font-size:15px;line-height:1.8;color:#bdc5d2}code{font-size:13px;background:#252c36;padding:2px 4px}li{margin-bottom:12px}a{text-underline-offset:3px}</style></head><body><header><a class="brand" href="./">▣ Privacy Frames</a><span class="research">RESEARCH REPORT</span></header><main>'+marked.parse(source)+'</main></body></html>';
const dist=process.env.BUILD_DIRECTORY?pathToFileURL(resolve(process.env.BUILD_DIRECTORY)+'/'):new URL('./dist/',import.meta.url);
await writeFile(new URL('report.html',dist),html);
