// Display names are not identities. The worker always uses the complete
// source-derived installation ID, regardless of the readable path segment.
export function applicationURL(app,base){
 return new URL(`apps/${app.manifest.id}/${app.id}/${app.manifest.entry}`,base);
}
export function resourceURL(app,path,base){return new URL(`apps/${app.manifest.id}/${app.id}/${path}`,base);}
export function applicationIdentity(input,base){
 try{
  const url=new URL(input),root=new URL(base);
  if(url.origin!==root.origin)return null;
  const prefix=root.pathname+'apps/';
  if(url.pathname.startsWith(prefix)){
   const [name,id]=url.pathname.slice(prefix.length).split('/');
   return name&&id&&/^[-a-z0-9]+-[a-f0-9]{64}$/.test(id)&&id.startsWith(name+'-')?id:null;
  }
  // Existing installed links remain usable while lifecycle work is deferred.
  const legacy=root.pathname+'run/';
  return url.pathname.startsWith(legacy)?url.pathname.slice(legacy.length).split('/')[0]||null:null;
 }catch{return null;}
}
