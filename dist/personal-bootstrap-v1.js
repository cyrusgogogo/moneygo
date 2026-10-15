'use strict';
(function(root){
 let gate;
 try{
  const descriptor=Object.getOwnPropertyDescriptor(root,'MoneygoRuntimeGate');if(!descriptor||!Object.hasOwn(descriptor,'value')||!Object.isFrozen(descriptor.value))throw Error('Runtime gate unavailable');gate=descriptor.value;
  gate.marker('personal');gate.dependencies();if(Object.getOwnPropertyDescriptor(root,'MoneygoRuntimeCapability'))return;
  let nativeStorage=null,startupError='';
  try{nativeStorage=root.localStorage;if(!nativeStorage)throw Error('Storage unavailable');}catch(_){startupError='浏览器不允许本地存储。请允许此网站保存数据，或使用普通浏览模式后重试。';}
  const adapter=nativeStorage?{getItem:key=>nativeStorage.getItem(key),setItem:(key,value)=>nativeStorage.setItem(key,value),removeItem:key=>nativeStorage.removeItem(key)}:null;
  gate.prepare('personal',adapter,adapter?'available':'unavailable',startupError,{},()=>{nativeStorage=null;});
 }catch(_){gate?.unavailable();}
})(window);
