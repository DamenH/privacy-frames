// Public aliases select installations; names are canonical, readable labels.
// Full source identities still govern storage, resource ownership and admission.
export function publicAlias(id){
 const digest=String(id).match(/-([a-f0-9]{64})$/)?.[1];
 if(!digest)throw new Error('Invalid installation identity');
 const bytes=Uint8Array.from(digest.slice(0,16).match(/../g),hex=>parseInt(hex,16));
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function applicationURL(app,base){return new URL(`${publicAlias(app.id)}/${app.manifest.id}/`,base);}
export function resourceURL(app,path,base){return new URL(path,applicationURL(app,base));}
export function applicationIdentity(input,base){
 try{
  const url=new URL(input),root=new URL(base);
  if(url.origin!==root.origin||!url.pathname.startsWith(root.pathname))return null;
  const relative=url.pathname.slice(root.pathname.length),parts=relative.split('/');
  if(/^[A-Za-z0-9_-]{11}$/.test(parts[0]))return parts[0];
  if(parts[0]==='run')return /^[-a-z0-9]+-[a-f0-9]{64}$/.test(parts[1]||'')?parts[1]:null;
  if(parts[0]==='apps')return /^[-a-z0-9]+-[a-f0-9]{64}$/.test(parts[2]||'')?parts[2]:null;
  return null;
 }catch{return null;}
}
