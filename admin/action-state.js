const active=new Set();
export async function runBusyAction(key,root,work,onError){
  if(active.has(key))return;
  active.add(key);
  const buttons=[...(root?.querySelectorAll('button')||[])];
  const states=buttons.map(button=>button.disabled);
  root?.setAttribute('aria-busy','true');buttons.forEach(button=>button.disabled=true);
  try{return await work();}
  catch(error){onError(error);}
  finally{active.delete(key);root?.removeAttribute('aria-busy');buttons.forEach((button,i)=>{button.disabled=states[i];});}
}
