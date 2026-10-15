'use strict';
const {readEntryManifest,applyBodyAttributes,addListener,removeListener}=require('./entry-manifest.cjs');
// Small markup-backed DOM test double. It runs the exact host script list without
// editing source. It verifies rendered-control/event wiring, not browser layout.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const decode=s=>String(s).replace(/&(?:amp|lt|gt|quot|#39|#10);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&#10;':'\n'}[x]));
const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
function host(initial, config={}) {
 const values=new Map(initial||[]),writes=[],log=[],winListeners=new Map(),docListeners=new Map();
 const store={values,log,writes,onGet:null,onSet:null,onRemove:null,afterSet:null,
  getItem(k){log.push(['get',k]);const r=this.onGet?.(k);if(r&&Object.hasOwn(r,'value'))return r.value;return values.has(k)?values.get(k):null;},
  setItem(k,v){v=String(v);log.push(['set',k,v]);const r=this.onSet?.(k,v);if(r?.skip)return;values.set(k,v);writes.push([k,v]);this.afterSet?.(k,v);},
  removeItem(k){log.push(['remove',k]);const r=this.onRemove?.(k);if(!r?.skip)values.delete(k);}
 };
 config.setupStore?.(store);

 let doc;
 class Node {
  constructor(tag,attrs={},parent=null){this.tagName=tag.toUpperCase();this.attrs=attrs;this.parentNode=parent;this.children=[];this.dataset=Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));this.value=attrs.value||'';this.checked=Object.hasOwn(attrs,'checked');this.disabled=Object.hasOwn(attrs,'disabled');this.hidden=Object.hasOwn(attrs,'hidden');this.style={};this.listeners=new Map();this.classList={add(){},remove(){},contains(){return false;}};this.textContent='';this._html='';}
  hasAttribute(k){return Object.hasOwn(this.attrs,k);} getAttribute(k){return this.attrs[k]??null;}
  get name(){return this.attrs.name;} get id(){return this.attrs.id;} get isConnected(){let n=this;while(n&&n!==doc)n=n.parentNode;return n===doc;}
  set innerHTML(html){this._html=String(html);this.children=[];parse(this._html,this);} get innerHTML(){return this._html;}
  querySelectorAll(selector){const out=[];for(const c of this.children){if(matches(c,selector))out.push(c);out.push(...c.querySelectorAll(selector));}return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let n=this;n&&n!==doc;n=n.parentNode)if(matches(n,selector))return n;return null;}
  get elements(){const result={};for(const n of this.querySelectorAll('input,select,textarea,button').filter(n=>n.name)){if(result[n.name]){const list=Array.isArray(result[n.name])?result[n.name]:[result[n.name]];list.push(n);Object.defineProperty(list,'value',{get(){return this.find(x=>x.checked)?.value||'';},configurable:true});result[n.name]=list;}else result[n.name]=n;}Object.defineProperty(result,'namedItem',{value:k=>result[k]||null});return result;}
  focus(){doc.activeElement=this;}addEventListener(type,fn){addListener(this.listeners,type,fn);}removeEventListener(type,fn){removeListener(this.listeners,type,fn);}setSelectionRange(){}append(n){n.parentNode=this;this.children.push(n);}remove(){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
  dispatch(type){if(type==='click'&&this.disabled)return;const e={type,target:this,preventDefault(){},stopPropagation(){this.stopped=true;}};for(let n=this;n&&n!==doc&&!e.stopped;n=n.parentNode){n['on'+type]?.(e);n.listeners.get(type)?.(e);}if(!e.stopped)for(const listener of docListeners.get(type)||[])listener(e);return e;}
  click(){return this.dispatch('click');}
 }
 function matches(n,s){return s.split(',').some(raw=>{const sel=raw.trim();if(sel.includes(' ')){const bits=sel.split(/\s+/),last=bits.pop();return matches(n,last)&&n.parentNode?.closest(bits.join(' '));}if(sel.startsWith('#'))return n.id===sel.slice(1);if(sel.startsWith('.'))return (n.attrs.class||'').split(/\s+/).includes(sel.slice(1));const m=/^(\w+)?\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);if(m)return (!m[1]||n.tagName===m[1].toUpperCase())&&Object.hasOwn(n.attrs,m[2])&&(m[3]===undefined||n.attrs[m[2]]===m[3]);return n.tagName===sel.toUpperCase();});}
 function parse(html,parent){const stack=[parent];for(const token of html.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g)||[]){if(token.startsWith('<!'))continue;if(token.startsWith('</')){const tag=token.slice(2,-1).trim().toUpperCase();for(let i=stack.length-1;i>0;i--)if(stack[i].tagName===tag){stack.length=i;break;}continue;}if(token[0]==='<'){const m=/^<([\w-]+)([\s\S]*?)\/?\s*>$/.exec(token);if(!m)continue;const attrs={};for(const a of m[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[a[1]]=decode(a[2]??a[3]??a[4]??'');const n=new Node(m[1],attrs,stack.at(-1));stack.at(-1).children.push(n);if(!voids.has(m[1])&&!token.endsWith('/>'))stack.push(n);}else{const text=decode(token);for(const n of stack)n.textContent+=text;if(stack.at(-1).tagName==='TEXTAREA')stack.at(-1).value+=text;}}
  for(const n of parent.querySelectorAll('select')){const opts=n.querySelectorAll('option');const o=opts.find(o=>Object.hasOwn(o.attrs,'selected'))||opts[0];n.value=o?(o.attrs.value??o.textContent):'';}
 }
 doc=new Node('document');doc.activeElement=null;doc.addEventListener=(t,f)=>{if(!docListeners.has(t))docListeners.set(t,[]);docListeners.get(t).push(f);};doc.removeEventListener=(t,f)=>{docListeners.set(t,(docListeners.get(t)||[]).filter(fn=>fn!==f));};doc.createElement=t=>new Node(t);doc.body=new Node('body',{},doc);doc.children.push(doc.body);
 const entry=readEntryManifest(),{root,scripts}=entry;applyBodyAttributes(doc.body,entry);doc.body.innerHTML=entry.bodyHTML;
 const window={document:doc,localStorage:store,confirm(){return true;},scrollTo(){},addEventListener:(t,f)=>addListener(winListeners,t,f),removeEventListener:(t,f)=>removeListener(winListeners,t,f)};if(config.storageGetterError)Object.defineProperty(window,'localStorage',{get(){throw config.storageGetterError;}});
 const context=vm.createContext({window,document:doc,console,TextEncoder,TextDecoder,Blob,URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},setTimeout(){return 1;},clearTimeout(){},...(config.globals||{})});
 for(const file of scripts){config.beforeScript?.(file,context,doc);vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});config.afterScript?.(file,context,doc);}
 return {scripts,store,writes,log,values,doc,window,winListeners,docListeners,node:sel=>doc.querySelector(sel),run:code=>vm.runInContext(code,context),value:code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context)),put:(k,v)=>{context[k]=v;}};
}
module.exports={host};
