import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {rmSync} from 'node:fs';
const cwd=fileURLToPath(new URL('../',import.meta.url));
for(const output of ['dist-manager','dist-runtime']){
 rmSync(new URL('../'+output+'/',import.meta.url),{recursive:true,force:true});
 const env={...process.env,BUILD_DIRECTORY:output,HOST_ROLE:output==='dist-manager'?'manager':'runtime',HOST_CONFIG:fileURLToPath(new URL('./config.json',import.meta.url))};
 for(const script of ['build.mjs','report.mjs'])execFileSync(process.execPath,[script],{cwd,env,stdio:'inherit'});

}
