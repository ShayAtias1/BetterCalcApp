const listeners=new Set<()=>void>();
export function openingsChanged(){for(const listener of listeners)listener();}
export function subscribeOpeningsChanged(listener:()=>void){listeners.add(listener);return ()=>{listeners.delete(listener);};}
