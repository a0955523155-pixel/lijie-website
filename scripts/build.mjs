import { readdir, readFile, cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const roots=['api','admin','js','housekeeping'];
let checked=0;
async function check(dir){
  for(const file of await readdir(dir,{withFileTypes:true})){
    const name=path.join(dir,file.name);
    if(file.isDirectory())await check(name);
    else if(name.endsWith('.js')){
      const result=spawnSync(process.execPath,['--check',name],{encoding:'utf8'});
      if(result.status!==0)throw new Error(result.stderr);checked++;
    }
  }
}
for(const root of roots)await check(root);
const html=await readFile('index.html','utf8');
const structured=JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
if(structured.maximumAttendeeCapacity!==12)throw new Error('Incorrect capacity');
await rm('dist',{recursive:true,force:true});await mkdir('dist');
for(const dir of ['admin','js','housekeeping','css','images'])await cp(dir,`dist/${dir}`,{recursive:true});
for(const file of await readdir('.'))if(file.endsWith('.html')||['_headers','robots.txt','sitemap.xml'].includes(file))await cp(file,`dist/${file}`);
console.log(`Static build complete: ${checked} JavaScript files validated; dist/ generated. No deployment performed.`);
