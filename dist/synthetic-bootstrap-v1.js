'use strict';
(function(root){
 let gate;
 try{
  const descriptor=Object.getOwnPropertyDescriptor(root,'MoneygoRuntimeGate');if(!descriptor||!Object.hasOwn(descriptor,'value')||!Object.isFrozen(descriptor.value))throw Error('Runtime gate unavailable');gate=descriptor.value;
  gate.marker('synthetic');gate.dependencies();if(Object.getOwnPropertyDescriptor(root,'MoneygoRuntimeCapability'))return;
  const own=(o,k)=>{const d=Object.getOwnPropertyDescriptor(o||{},k);if(!d||!Object.hasOwn(d,'value'))throw Error('Sample data unavailable');return d.value;};
  const pack=own(root,'MoneygoSyntheticSamples');
  if(!Object.isFrozen(pack)||own(pack,'protocol')!=='moneygo-synthetic-samples-v1'||own(pack,'version')!==1||own(pack,'testedEngineRelease')!=='0.23.0'||own(pack,'defaultSeed')!=='complex'||own(pack,'fixedReferenceDate')!=='2026-11-02')throw Error('Sample package mismatch');
  const seeds=own(pack,'seeds');if(!Object.isFrozen(seeds))throw Error('Mutable samples');let initial;
  for(const id of ['complex','starter']){const seed=own(seeds,id);if(!Object.isFrozen(seed)||own(seed,'id')!==id||own(seed,'initialMonth')!==(id==='complex'?'2026-10':'2026-09')||typeof own(seed,'backupText')!=='string')throw Error('Invalid sample');const parsed=root.MoneygoLedger.parseBackup(seed.backupText);root.MoneygoLedger.verifyBackup(seed.backupText);if(id==='complex')initial=JSON.stringify(parsed);}
  const names=['SYNTHETIC-complex-v6.json','SYNTHETIC-starter.json','SYNTHETIC-practice-bank.csv','SYNTHETIC-practice-credit.tsv','SYNTHETIC-practice-coffee-correction.csv','SYNTHETIC-practice-coffee-cancellation.csv'];
  const files=own(pack,'files');if(!Array.isArray(files)||!Object.isFrozen(files)||files.length!==names.length)throw Error('Invalid sample catalog');const seen=new Set(),ids=new Set(),expectedIds=['complex-json','starter-json','bank-csv','credit-tsv','coffee-correction','coffee-cancellation'];
  for(const file of files){if(!Object.isFrozen(file)||!names.includes(own(file,'fileName'))||own(file,'path')!=='samples/'+file.fileName||seen.has(file.fileName)||typeof own(file,'text')!=='string'||typeof own(file,'label')!=='string'||!expectedIds.includes(own(file,'id'))||ids.has(file.id)||!['application/json;charset=utf-8','text/csv;charset=utf-8','text/tab-separated-values;charset=utf-8'].includes(own(file,'mimeType')))throw Error('Invalid sample download');seen.add(file.fileName);ids.add(file.id);}
  if(files.find(f=>f.id==='complex-json')?.text!==seeds.complex.backupText||files.find(f=>f.id==='starter-json')?.text!==seeds.starter.backupText)throw Error('Sample backup catalog mismatch');
  const values=new Map([[gate.keys[0],initial]]),check=key=>{if(!gate.keys.includes(key))throw Error('Unaudited session key');};
  const adapter={getItem(key){check(key);return values.has(key)?values.get(key):null;},setItem(key,value){check(key);values.set(key,String(value));},removeItem(key){check(key);values.delete(key);}};
  gate.prepare('synthetic',adapter,'available','',{initialMonth:seeds.complex.initialMonth,fixedReferenceDate:pack.fixedReferenceDate},()=>values.clear());
 }catch(_){gate?.unavailable();}
})(window);
