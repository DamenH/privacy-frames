import {parse, parseFragment} from 'parse5';
export const LIMITS=Object.freeze({files:100,bytes:20*1024*1024});
const blocked=new Set(['iframe','frame','frameset','object','embed','applet','portal','fencedframe','webview','base']);
export function elementAllowed(name){
 const tag=String(name).toLowerCase();
 if(blocked.has(tag)||tag.includes(':'))throw new Error(`Element not admitted: ${tag}`);
}
export function validateMarkup(html,{document=false,initial=false}={}){
 // Conservative lexical gate is independent of HTML/SVG/MathML parser context.
 // It intentionally also rejects forbidden tag spellings inside comments/raw text.
 if(/<\/?\s*(?:iframe|frame|frameset|object|embed|applet|portal|fencedframe|webview|base)/i.test(html))throw new Error('Context-producing markup is not admitted');
 if(!initial&&/<\/?\s*(?:script|link|meta)/i.test(html))throw new Error('Dynamic policy/resource markup is not admitted');
 const ast=document?parse(html):parseFragment(html);
 function visit(n){
  if(n.tagName){
   elementAllowed(n.tagName);
   const tag=n.tagName.toLowerCase();
   if(tag==='meta'&&(n.attrs.some(a=>a.name==='http-equiv')||n.attrs.some(a=>a.name==='name'&&!['viewport','color-scheme','theme-color'].includes(a.value.toLowerCase()))))throw new Error('Application response policy must be supplied by the host');
   if(tag==='link'&&n.attrs.find(a=>a.name==='rel')?.value.toLowerCase()!=='stylesheet')throw new Error('Only stylesheet links are admitted');
   if(tag==='script'&&(!initial||!n.attrs.some(a=>a.name==='src')||n.childNodes?.some(x=>x.value?.trim())))throw new Error('Inline scripts are not supported yet; reference an external JavaScript file with src');
   for(const a of n.attrs){
    if(a.name.startsWith('on')||['srcdoc','is','manifest'].includes(a.name))throw new Error(`Attribute not admitted: ${a.name}`);
   }
  }
  for(const c of n.childNodes||[])visit(c);
  if(n.content)visit(n.content);
 }
 visit(ast);return ast;
}
export function safePath(path){
 if(typeof path!=='string'||!path||path.length>200||path.startsWith('/')||path.includes('\\')||path.includes('%')||path.includes('?')||path.includes('#')||path.split('/').some(x=>!x||x==='.'||x==='..'))throw new Error('Invalid package path');
 return path;
}
export function validateManifest(m){
 if(!m||m.format!==1||!/^[-a-z0-9]{1,48}$/.test(m.id)||typeof m.name!=='string'||!m.name.trim()||m.name.length>100||!Array.isArray(m.resources)||m.resources.length<1||m.resources.length>LIMITS.files)throw new Error('Invalid installation manifest');
 safePath(m.entry);
 if(!m.entry.endsWith('.html'))throw new Error('Entry must be HTML');
 const paths=m.resources.map(x=>safePath(x));
 if(new Set(paths).size!==paths.length||!paths.includes(m.entry))throw new Error('Duplicate resources or missing entry');
 return {format:1,id:m.id,name:m.name,entry:m.entry,resources:paths};
}
export async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function downloadPackage(input,options={}){
 const source=new URL(input);if(!['https:','http:'].includes(source.protocol)||source.username||source.password)throw new Error('Expected an HTTPS application or manifest URL');
 // HTTP is supported only for loopback development.
 if(source.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(source.hostname))throw new Error('Installation requires HTTPS');
 source.hash='';const original=source.href,explicit=source.pathname.endsWith('.json');
 if(/\.html?$/.test(source.pathname))return(await import('./website.js')).downloadWebsite(original,options);
 if(!explicit)source.pathname=source.pathname.replace(/\/?$/,'/')+'app.json';
 const response=await fetch(source,{credentials:'omit',redirect:'error',cache:'no-store'});
 if(response.status===404&&!explicit)return(await import('./website.js')).downloadWebsite(original,options);
 if(!response.ok)throw new Error(`Manifest: HTTP ${response.status}`);
 const manifest=validateManifest(await response.json());let size=0;
 const resources=[];
 for(const path of manifest.resources){
  const url=new URL(path,source);const r=await fetch(url,{credentials:'omit',redirect:'error',cache:'no-store'});if(!r.ok)throw new Error(`${path}: HTTP ${r.status}`);
  const bytes=await r.arrayBuffer();size+=bytes.byteLength;if(size>LIMITS.bytes)throw new Error('Package exceeds installation size limit');
  if(path.endsWith('.html'))validateMarkup(new TextDecoder().decode(bytes),{document:true,initial:true});
  resources.push({path,url:url.href,bytes,sha256:await digest(bytes)});
 }
 return {id:manifest.id+'-'+(await digest(new TextEncoder().encode(source.href))),manifest,source:source.href,resources,size,installedAt:new Date().toISOString()};
}
export const mime=path=>({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',webmanifest:'application/manifest+json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',webp:'image/webp',txt:'text/plain',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',woff2:'font/woff2'})[path.split('.').pop()]||'application/octet-stream';
