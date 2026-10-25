import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const publisher=process.env.APPS_DIRECTORY?path.resolve(process.env.APPS_DIRECTORY):fileURLToPath(new URL('../../privacy-frames-apps/apps/',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
export async function servers({separateRuntime=false}={}){
 const traffic=[],connections=[],servers=[];
 for(const port of [4210,4211,4212,4213,4214,4215,4216,4217,4218]){
  const server=http.createServer(async(req,res)=>{
   const u=new URL(req.url,'http://local');traffic.push({port,path:req.url,method:req.method});
   res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cache-Control','no-store');
   if(port===4216){res.end('diagnostic receiver');return;}
   try{
    let relative=decodeURIComponent(u.pathname);
    // Host under a project prefix reproduces GitHub Pages scope and relative URL behavior.
    const prefix=port===4211?'/runtime':'/privacy-frames';
    if(port===4210||port===4211){if(relative===prefix){res.writeHead(301,{Location:prefix+'/'});res.end();return;}if(!relative.startsWith(prefix+'/')){res.statusCode=404;res.end('Not found');return;}relative=relative.slice(prefix.length);}
    if(separateRuntime&&port===4210&&relative==='/config.json'){
     const config=JSON.parse(await readFile(path.join(root,'config.json'),'utf8'));
     config.runtimeURL='http://localhost:4211/runtime/';
     res.setHeader('Content-Type','application/json');res.end(JSON.stringify(config));return;
    }
    if(port===4212&&relative.startsWith('/copy/'))relative=relative.slice(5);
    if(port===4212&&u.pathname==='/broken/app.json'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({format:1,id:'broken',name:'Broken install',entry:'index.html',resources:['index.html','missing.js']}));return;}
    if(port===4212&&u.pathname==='/broken/index.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><p>Incomplete package</p>');return;}
    if(port===4218&&relative.startsWith('/reject/')){
     if(relative==='/reject/sw.js'){res.setHeader('Content-Type','text/javascript');res.end("self.addEventListener('install',event=>event.waitUntil(Promise.reject(new Error('Installation deliberately rejected'))));");return;}
     relative=relative.slice('/reject'.length);
    }
    if(relative.endsWith('/'))relative+='index.html';
    const app=port===4218?'ordinary':port===4217?'playground':port>=4212?['notes','image','resources','adversary'][port-4212]:null;
    const base=app?path.resolve(publisher,app):root;
    const filename=path.resolve(base,'.'+relative);
    if(!filename.startsWith(base+path.sep))throw new Error('Invalid path');
    const bytes=await readFile(filename);res.setHeader('Content-Type',types[path.extname(filename)]||'application/octet-stream');res.end(bytes);
   }catch{res.statusCode=404;res.end('Not found');}
  });
  server.on('connection',()=>connections.push({port,time:Date.now()}));
  server.on('upgrade',(req,socket)=>{traffic.push({port,path:req.url,method:'UPGRADE'});socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});servers.push(server);
 }
 return {traffic,connections,close:async()=>{await Promise.all(servers.map(s=>new Promise(resolve=>{s.closeAllConnections();s.close(resolve);})));}};
}
