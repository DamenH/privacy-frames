import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {writeFileSync} from 'node:fs';
const cwd=fileURLToPath(new URL('../',import.meta.url));
for(const output of ['dist-manager','dist-runtime']){
 const env={...process.env,BUILD_DIRECTORY:output,HOST_CONFIG:fileURLToPath(new URL('./config.json',import.meta.url))};
 for(const script of ['build.mjs','report.mjs'])execFileSync(process.execPath,[script],{cwd,env,stdio:'inherit'});
 writeFileSync(new URL('../'+output+'/_redirects',import.meta.url),'/ /index.html 200\n');
}
