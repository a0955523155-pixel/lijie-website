import crypto from 'node:crypto';
export function installFakeFirestore(){
  const privateKey=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
  process.env.FIREBASE_SERVICE_ACCOUNT_JSON=JSON.stringify({project_id:'demo-lijie-isolated',client_email:'test@example.invalid',private_key:privateKey});
  process.env.BOOKING_SESSION_SECRET='isolated-test-session-secret';
  process.env.LINE_CHANNEL_SECRET='isolated-webhook-secret';
  process.env.LINE_CHANNEL_ACCESS_TOKEN='';
  for(const key of ['GMAIL_CLIENT_ID','GMAIL_CLIENT_SECRET','GMAIL_REFRESH_TOKEN','GMAIL_SENDER_EMAIL','ADMIN_NOTIFICATION_EMAIL'])process.env[key]='';
  const docs=new Map(),versions=new Map(),transactions=new Map(),calls=[],replies=[];
  let sequence=0,failCommit=false,abortOnce=false,failRead=false,onLinePush=null,authUser={localId:'synthetic-admin'},pageSize=500,dropCommitResponse=false;
  const enc=v=>v===null?{nullValue:null}:typeof v==='string'?{stringValue:v}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:Array.isArray(v)?{arrayValue:{values:v.map(enc)}}:{mapValue:{fields:fields(v)}};
  const fields=v=>Object.fromEntries(Object.entries(v).map(([k,v])=>[k,enc(v)]));
  const dec=v=>'stringValue'in v?v.stringValue:'integerValue'in v?Number(v.integerValue):'booleanValue'in v?v.booleanValue:'nullValue'in v?null:'arrayValue'in v?(v.arrayValue.values||[]).map(dec):Object.fromEntries(Object.entries(v.mapValue.fields).map(([k,v])=>[k,dec(v)]));
  const document=(key,value)=>({name:`projects/demo-lijie-isolated/databases/(default)/documents/${key}`,fields:fields(value)});
  const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  const set=(key,value)=>{docs.set(key,structuredClone(value));versions.set(key,(versions.get(key)||0)+1);};
  globalThis.fetch=async (input,options={})=>{
    const url=new URL(input),body=options.body?JSON.parse(String(options.body).startsWith('{')?options.body:'{}'):{};
    calls.push({url:String(url),method:options.method||'GET',body});
    if(url.host==='oauth2.googleapis.com')return response({access_token:'FAKE_ONLY',expires_in:3600});
    if(url.host==='identitytoolkit.googleapis.com')return response({users:authUser?[authUser]:[]});
    if(url.host==='api.line.me'&&url.pathname.endsWith('/reply')){replies.push(body);return response({});}
    if(url.host==='api.line.me'&&url.pathname.endsWith('/push')&&onLinePush){await onLinePush();return response({});}
    if(url.host!=='firestore.googleapis.com'||!url.pathname.includes('/projects/demo-lijie-isolated/'))throw new Error(`External network forbidden in test: ${url.host}`);
    if(url.pathname.endsWith(':beginTransaction')){const id=`t${++sequence}`;transactions.set(id,new Map());return response({transaction:id});}
    if(url.pathname.endsWith(':rollback')){transactions.delete(body.transaction);return response({});}
    if(url.pathname.endsWith(':commit')){
      if(failCommit)return response({error:{status:'UNAVAILABLE'}},503);
      const reads=transactions.get(body.transaction);
      if(abortOnce||[...reads].some(([key,version])=>(versions.get(key)||0)!==version)){abortOnce=false;return response({error:{status:'ABORTED'}},409);}
      for(const write of body.writes){
        const key=(write.delete||write.update.name).split('/documents/')[1];
        if(write.delete){docs.delete(key);versions.set(key,(versions.get(key)||0)+1);}
        else{const value=Object.fromEntries(Object.entries(write.update.fields).map(([k,v])=>[k,dec(v)]));set(key,write.updateMask?{...docs.get(key),...value}:value);}
      }
      transactions.delete(body.transaction);if(dropCommitResponse){dropCommitResponse=false;throw new Error('SYNTHETIC_COMMIT_REPLY_LOST');}return response({commitTime:new Date().toISOString()});
    }
    if(url.pathname.endsWith(':runQuery')){
      const filter=body.structuredQuery.where.fieldFilter;
      return response([...docs].filter(([key,v])=>key.startsWith('bookings/')&&v[filter.field.fieldPath]===filter.value.stringValue).map(([key,v])=>({document:document(key,v)})));
    }
    const key=decodeURIComponent(url.pathname.split('/documents/')[1]);
    if(!key.includes('/')){const all=[...docs].filter(([path])=>path.startsWith(key+'/')),offset=Number(url.searchParams.get('pageToken')||0),size=Math.min(pageSize,Number(url.searchParams.get('pageSize')||500));return response({documents:all.slice(offset,offset+size).map(([path,v])=>document(path,v)),...(offset+size<all.length?{nextPageToken:String(offset+size)}:{})});}
    if(failRead&&key.startsWith('availability/'))return response({error:{status:'UNAVAILABLE'}},503);
    const tx=url.searchParams.get('transaction');if(tx)transactions.get(tx).set(key,versions.get(key)||0);
    return docs.has(key)?response(document(key,docs.get(key))):response({error:{status:'NOT_FOUND'}},404);
  };
  return {docs,calls,replies,set,reset(){docs.clear();versions.clear();transactions.clear();calls.length=0;replies.length=0;failCommit=false;abortOnce=false;failRead=false;onLinePush=null;authUser={localId:'synthetic-admin'};pageSize=500;dropCommitResponse=false;},set authUser(v){authUser=v;},set pageSize(v){pageSize=v;},set dropCommitResponse(v){dropCommitResponse=v;},set failCommit(v){failCommit=v;},set abortOnce(v){abortOnce=v;},set failRead(v){failRead=v;},set onLinePush(v){onLinePush=v;}};
}
export function session(uid){const body=Buffer.from(JSON.stringify({uid,exp:Date.now()+3600000})).toString('base64url');return `${body}.${crypto.createHmac('sha256',process.env.BOOKING_SESSION_SECRET).update(body).digest('base64url')}`;}
export async function invoke(handler,body,{method='POST',query={},headers={}}={}){
  const result={status:0,data:null};
  const res={setHeader(key,value){result.headers||={};result.headers[key]=value;return this;},status(n){result.status=n;return this;},json(data){result.data=data;return this;},send(data){if(typeof data==='string'){try{result.data=JSON.parse(data);}catch{result.data=data;}}else result.data=data;return this;}};
  await handler({method,body,headers,query},res);return result;
}
