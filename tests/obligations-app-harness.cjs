'use strict';
const {readEntryManifest,applyBodyAttributes,addListener,removeListener}=require('./entry-manifest.cjs');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {modelDir,L}=require('./obligations-ui-harness.cjs');
const root=path.resolve(__dirname,'..'), integrationDir=path.join(root,'dist');
function memoryStorage(raw=null){const values=new Map(raw===null?[]:[[L.STORAGE_KEY,raw]]);return {values,writes:[],failSet:false,getItem(k){return values.get(k)??null;},setItem(k,v){if(this.failSet)throw Error('quota');values.set(k,String(v));this.writes.push([k,String(v)]);},removeItem(k){values.delete(k);}};}
const decode=s=>(s||'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const attr=(s,k)=>decode(s.match(new RegExp('(?:^|\\s)'+k+'="([^"]*)"'))?.[1]||'');
function loadApp(storage=memoryStorage()){
 const nodes=new Map(),listeners=new Map(),windowListeners=new Map();let form=null,formBody='';
 const document={body:{style:{},append(){}},activeElement:null,addEventListener(k,f){const rows=listeners.get(k)||[];rows.push(f);listeners.set(k,rows);},removeEventListener(k,f){listeners.set(k,(listeners.get(k)||[]).filter(fn=>fn!==f));}};
 function fresh(){return {innerHTML:'',textContent:'',value:'',checked:false,disabled:false,hidden:false,isConnected:true,dataset:{},style:{},classList:{add(){},remove(){},contains(){return false;}},focus(){document.activeElement=this;},addEventListener(){},setSelectionRange(){},querySelectorAll(){return [];},closest(){return null;}};}
 function node(s){if(!nodes.has(s))nodes.set(s,fresh());return nodes.get(s);}
 function parse(body){const f=fresh(),fields=new Map();for(const x of body.matchAll(/<input\b([^>]*)>|<(select|textarea)\b([^>]*)>([\s\S]*?)<\/\2>/g)){const a=x[1]??x[3],name=attr(a,'name');if(!name)continue;const v=fresh();v.value=attr(a,'value');v.checked=/\schecked(?:\s|$)/.test(a);if(x[2]==='textarea')v.value=decode(x[4]);if(x[2]==='select'){const opts=[...x[4].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)],o=opts.find(v=>/\sselected(?:\s|$)/.test(v[1]))||opts[0];v.value=o?attr(o[1],'value'):'';}fields.set(name,v);}f.elements={namedItem:k=>fields.get(k)};f.reportValidity=()=>true;return f;}
 document.querySelectorAll=()=>[...nodes.values(),...(form?[form]:[])];
 document.querySelector=s=>{const body=node('#modal-root').innerHTML;if(s==='.modal'&&!body)return null;if(s==='#entry-form'){if(!body.includes('id="entry-form"')){form=null;formBody='';return null;}if(formBody!==body){formBody=body;form=parse(body);}return form;}return node(s);};
 const window={document,localStorage:storage,scrollTo(){},confirm(){return true;},addEventListener(k,f){addListener(windowListeners,k,f);},removeEventListener(k,f){removeListener(windowListeners,k,f);}};
 const context=vm.createContext({window,document,console,TextEncoder,TextDecoder,setTimeout(){return 1;},clearTimeout(){},FormData:class{constructor(f){this.f=f;}getAll(n){return this.f.formData?.[n]||[];}}});
 const entry=readEntryManifest(integrationDir),files=entry.scripts;applyBodyAttributes(document.body,entry);
 for(const file of files){if(!/^[a-z0-9-]+\.js$/.test(file))throw Error('Unexpected application script');vm.runInContext(fs.readFileSync(path.join(integrationDir,file),'utf8'),context,{filename:file});}
 const api={node,storage,windowListeners,run:s=>vm.runInContext(s,context),value:s=>JSON.parse(vm.runInContext(`JSON.stringify(${s})`,context)),get form(){return document.querySelector('#entry-form');},click(action,id,extra={}){api.moduleClick('ob',action,id,extra);},moduleClick(prefix,action,id,extra={}){const target={dataset:{[prefix+'Action']:action,[prefix+'Id']:id,...extra},disabled:false,hasAttribute(){return false;},closest(sel){return sel===`[data-${prefix}-action]`||sel==='button,a'?this:null;}};for(const fn of listeners.get('click')||[])fn({target});},fields(values){for(const [k,v]of Object.entries(values)){const f=api.form.elements.namedItem(k);if(!f)throw Error('No field '+k);if(typeof v==='boolean')f.checked=v;else f.value=v;}},submit(){api.form.onsubmit({preventDefault(){}});},approve(){api.fields({reason:'核对明确证据',confirmed:true});api.submit();}};return api;
}
module.exports={loadApp,memoryStorage,integrationDir};
