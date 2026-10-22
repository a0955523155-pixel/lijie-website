import http from 'node:http';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
const root=process.cwd(),types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  try{
    let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname));
    if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403).end();return;}
    if((await stat(file)).isDirectory())file=path.join(file,'index.html');
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}).end(await readFile(file));
  }catch{res.writeHead(404).end('Not found');}
}).listen(4178,'127.0.0.1',()=>console.log('Isolated test files: http://127.0.0.1:4178'));
