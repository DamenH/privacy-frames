import {applicationURL,publicAlias,resourceURL} from './runtime-url.js';

const text=(value,max=200)=>typeof value==='string'?value.slice(0,max):undefined;
export function webManifest(app,base){
 const entry=applicationURL(app,base),root=new URL(publicAlias(app.id)+'/',base);
 const original=app.publisherManifest?.value||{},manifestURL=app.publisherManifest?.url;
 const result={id:root.pathname,name:text(original.name,100)||app.manifest.name,short_name:text(original.short_name,40)||app.manifest.name.slice(0,40),start_url:entry.pathname,scope:root.pathname,display:'standalone',icons:[]};
 for(const key of ['description','lang','theme_color','background_color']){const value=text(original[key]);if(value)result[key]=value;}
 if(['ltr','rtl','auto'].includes(original.dir))result.dir=original.dir;
 if(['fullscreen','standalone','minimal-ui','browser'].includes(original.display))result.display=original.display;
 if(['any','natural','landscape','landscape-primary','landscape-secondary','portrait','portrait-primary','portrait-secondary'].includes(original.orientation))result.orientation=original.orientation;
 if(manifestURL){
  try{
   const start=new URL(original.start_url||app.source,manifestURL),source=new URL(app.source);
   if(start.origin===source.origin&&start.pathname===source.pathname&&start.search===source.search)result.start_url=entry.pathname+start.hash;
  }catch{}
  for(const icon of Array.isArray(original.icons)?original.icons.slice(0,8):[]){
   try{
    const url=new URL(icon.src,manifestURL);url.hash='';const resource=app.resources.find(r=>r.url===url.href);
    if(!resource||!/^image\//i.test(resource.contentType||''))continue;
    result.icons.push({src:new URL(`__icon/${app.resources.indexOf(resource)}`,root).pathname,...(text(icon.sizes,100)?{sizes:icon.sizes}:{}),...(text(icon.type,100)?{type:icon.type}:{}),...(typeof icon.purpose==='string'&&/^(any|maskable|monochrome)( (any|maskable|monochrome))*$/.test(icon.purpose)?{purpose:icon.purpose}:{})});
   }catch{}
  }
  const shortcuts=[];
  for(const shortcut of Array.isArray(original.shortcuts)?original.shortcuts.slice(0,8):[]){
   try{const url=new URL(shortcut.url,manifestURL),source=new URL(app.source);
    if(url.origin===source.origin&&url.pathname===source.pathname&&url.search===source.search&&text(shortcut.name,80))shortcuts.push({name:shortcut.name.slice(0,80),url:entry.pathname+url.hash});
   }catch{}
  }
  if(shortcuts.length)result.shortcuts=shortcuts;
 }
 for(const size of [192,512])if(!result.icons.some(icon=>(icon.sizes||'').split(/\s+/).some(value=>value==='any'||value===`${size}x${size}`)))result.icons.push({src:new URL(`pwa-${size}.png`,base).pathname,sizes:`${size}x${size}`,type:'image/png',purpose:'any'});
 return result;
}
export function manifestURL(app,base){return new URL(`${publicAlias(app.id)}/__manifest.webmanifest`,base);}
