import {parse,serialize} from 'parse5';
import {validateMarkup} from './package.js';

export function cssReferences(text,base){
 const urls=[];
 for(const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)|@import\s+["']([^"']+)["']/gi)){
  const value=match[1]??match[2]??match[3]??match[4];
  if(value&&!/^(?:data:|blob:|#)/i.test(value))urls.push(new URL(value,base).href);
 }
 return urls;
}
function absoluteCSS(text,base){return text.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]*))\s*\)/gi,(whole,a,b,c)=>{
 const value=a??b??c;return /^(?:data:|blob:|#)/i.test(value)?whole:`url(${JSON.stringify(new URL(value,base).href)})`;
}).replace(/(@import\s+)["']([^"']+)["']/gi,(_,prefix,value)=>prefix+JSON.stringify(new URL(value,base).href));}

// Interpret publisher metadata once during public installation. Runtime never
// receives authority to change its document base or create execution contexts.
export function prepareDocument(text,documentURL){
 const ast=parse(text),links=new Set();let title='',base=documentURL,baseFound=false,canonical=documentURL,manifestURL=null;
 const attr=(node,name)=>node.attrs?.find(a=>a.name===name);
 function metadata(node){
  if(node.tagName==='base'&&!baseFound&&attr(node,'href')){baseFound=true;try{base=new URL(attr(node,'href').value,documentURL).href;}catch{}}
  for(const child of node.childNodes||[])metadata(child);
 }
 metadata(ast);
 function hints(node){
  if(node.tagName==='link'){
   const rel=(attr(node,'rel')?.value||'').toLowerCase().split(/\s+/),href=attr(node,'href')?.value;
   if(href){if(!manifestURL&&rel.includes('manifest'))manifestURL=new URL(href,base).href;if(rel.includes('canonical')||rel.includes('dc:isversionof'))canonical=new URL(href,base).href;}
  }
  for(const child of node.childNodes||[])hints(child);
 }
 hints(ast);
 function add(value){if(value&&!/^(?:data:|blob:|#)/i.test(value))links.add(new URL(value,base).href);}
 function walk(node){
  node.childNodes=(node.childNodes||[]).filter(child=>{
   const get=name=>attr(child,name)?.value;
   if(child.tagName==='base')return false;
   if(child.tagName==='title')title=(child.childNodes||[]).map(n=>n.value||'').join('');
   if(child.tagName==='meta'&&!get('charset')&&!['viewport','color-scheme','theme-color'].includes(get('name')?.toLowerCase()))return false;
   if(child.tagName==='link'&&get('rel')?.toLowerCase()!=='stylesheet')return false;
   // A fixed installed resource is selected instead of retaining a browser
   // candidate list that could initiate uncaptured requests after confinement.
   const candidates=attr(child,'srcset');
   if(candidates){if(!get('src'))child.attrs.push({name:'src',value:candidates.value.split(',')[0].trim().split(/\s+/)[0]});child.attrs=child.attrs.filter(a=>a!==candidates);}
   for(const a of child.attrs||[]){
    if(['src','href','poster'].includes(a.name)&&a.value){
     if(child.tagName==='a'&&a.name==='href'){
      if(a.value.startsWith('#'))continue;
      const target=new URL(a.value,base),identity=new URL(canonical);
      const fragment=target.hash;target.hash='';identity.hash='';
      a.value=fragment&&target.href===identity.href?fragment:new URL(a.value,base).href;
     }else if(!/^(?:data:|blob:|#)/i.test(a.value))a.value=new URL(a.value,base).href;
    }
    if(a.name==='style'){a.value=absoluteCSS(a.value,base);for(const url of cssReferences(a.value,base))add(url);}
   }
   if(child.tagName==='script'&&get('src'))add(get('src'));
   if(child.tagName==='link'&&get('href'))add(get('href'));
   if(['img','audio','video','source','input'].includes(child.tagName)){add(get('src'));add(get('poster'));}
   if(child.tagName==='style')for(const c of child.childNodes||[])if(c.nodeName==='#text'){c.value=absoluteCSS(c.value,base);for(const url of cssReferences(c.value,base))add(url);}
   walk(child);return true;
  });if(node.content)walk(node.content);
 }
 walk(ast);const html=serialize(ast);validateMarkup(html,{document:true,initial:true});return {html,title,links:[...links],manifestURL};
}
