// Only a successful server response can establish that a missing date is open.
export function createAvailabilityCache(read,ttl=30_000,clock=Date.now){
  const entries=new Map();
  const requests=new Map();
  return {
    async load(key,{force=false}={}){
      const entry=entries.get(key);
      if(!force&&entry&&clock()-entry.time<ttl)return entry.states;
      entries.delete(key);
      const request=Symbol(key);requests.set(key,request);
      const states=await read(key);
      if(requests.get(key)===request)entries.set(key,{states,time:clock()});
      return states;
    },
    state(day){
      const entry=entries.get(day.slice(0,7));
      return entry&&clock()-entry.time<ttl?(entry.states.get(day)||'available'):'unknown';
    },
    clear(){entries.clear();requests.clear();}
  };
}
