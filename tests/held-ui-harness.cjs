'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const L=require('../dist/ledger.js'),R=require('../dist/relations.js'),H=require('../dist/held-funds.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const money=n=>`¥${(n/100).toFixed(2)}`,amountText=n=>(n/100).toFixed(2);
const decode=s=>(s||'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const attr=(s,key)=>{const m=s.match(new RegExp('(?:^|\\s)'+key+'="([^"]*)"'));return m?decode(m[1]):'';};
function fixture(){const s=L.createEmpty();s.transactions=[{id:'pay',type:'expense',date:'2026-01-10',amountCents:100000,accountId:'account-cash',categoryId:'expense-food',note:'School'},{id:'receipt',type:'income',date:'2026-03-10',amountCents:30000,accountId:'account-cash',categoryId:'income-other',note:'Actual receipt'}];return s;}
// Deterministic VM form/event harness, not native DOM, keyboard, layout or storage acceptance.
function harness(initial=fixture(),options={}){
 let state=initial,writes=0,html='',modal='',title='',form=null,nodes=new Map(),errors=[],failWrite=false,staleStorage=false,isActive=true;
 let primary=JSON.stringify(initial),recovery='preserved recovery';const listeners=new Map(),disposers=[];
 function node(){return {value:'',checked:false,disabled:false,hidden:false,textContent:'',innerHTML:'',dataset:{},focus(){},addEventListener(){},reportValidity(){return true;}};}
 function parse(body){const f=node(),fields=new Map();for(const x of body.matchAll(/<input\b([^>]*)>|<(select|textarea)\b([^>]*)>([\s\S]*?)<\/\2>/g)){const attrs=x[1]===undefined?x[3]:x[1],name=attr(attrs,'name'),n=node();n.value=attr(attrs,'value');n.checked=/\schecked(?:\s|$)/.test(attrs);if(x[2]==='textarea')n.value=decode(x[4]);if(x[2]==='select'){const opts=[...x[4].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)],chosen=opts.find(o=>/\sselected(?:\s|$)/.test(o[1]))||opts[0];n.value=chosen?attr(chosen[1],'value'):'';}if(name)fields.set(name,n);const id=attr(attrs,'id');if(id)nodes.set('#'+id,n);}f.elements={namedItem:key=>fields.get(key)};return f;}
 const document={addEventListener(type,fn,capture){const list=listeners.get(type)||[];list.push({fn,capture});listeners.set(type,list);},removeEventListener(type,fn){listeners.set(type,(listeners.get(type)||[]).filter(x=>x.fn!==fn));}};
 const window={document,confirm:()=>true};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/held-funds-ui.js'),'utf8'),{window,console});const UI=window.MoneygoHeldFundsUI;
 const model=options.engine||H.createCoordinator({now:()=> '2026-04-15T12:00:00.000Z'});
 // Preserve real opaque tickets. Only bridge public plain command/option records from VM realm.
 const engine={view:(s,o)=>model.view(s,copy(o)),eligibility:(s,o)=>model.eligibility(s,copy(o)),preview:(s,c)=>model.preview(s,copy(c)),commit:(s,t,o)=>model.commit(s,t,copy(o))};
 const onDispose=fn=>disposers.push(fn);
 const ctx={getState:()=>state,engine,ledger:L,relations:R,money,amountText,today:()=> '2026-04-15',isActive:()=>isActive,onDispose,accountName:id=>state.accounts.find(a=>a.id===id)?.name||id,categoryName:id=>state.categories.find(c=>c.id===id)?.name||'',cancel:'<button type="button" data-close>取消</button>',
  $(s){if(s==='#entry-form')return form;if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);},
  modal(t,body,buttons,ready){title=t;modal=body+(buttons||'');nodes=new Map();form=body.includes('id="entry-form"')?parse(body):null;ready?.();},closeModal(){form=null;modal='';},error(message){errors.push(message);},
  change(fn){try{const candidate=fn();L.validateState(candidate);if(failWrite)throw Error('Storage quota failure');if(staleStorage)throw Error('Stale storage compare');state=candidate;primary=JSON.stringify(candidate);writes++;ctx.closeModal();ctx.render();return true;}catch(error){errors.push(error.message);return false;}},
  render(){html=UI.render(ctx);UI.bind(ctx);}
 };ctx.render();
 const api={ctx,UI,get state(){return state;},set state(v){state=v;},get html(){return html;},get modal(){return modal;},get title(){return title;},get form(){return form;},get writes(){return writes;},get errors(){return errors;},get primary(){return primary;},get recovery(){return recovery;},get listenerCount(){return [...listeners.values()].reduce((n,l)=>n+l.length,0);},set failWrite(v){failWrite=v;},set staleStorage(v){staleStorage=v;},
  click(action,id,extra={}){const target={dataset:{heldAction:action,heldId:id,...extra},disabled:false};const event={type:'click',target:{closest(selector){return selector==='[data-held-action]'?target:null;}}};for(const {fn} of [...listeners.get('click')||[]])fn(event);},
  fields(values){for(const [name,value]of Object.entries(values)){const f=form?.elements.namedItem(name);assert.ok(f,'field '+name+' exists');if(typeof value==='boolean')f.checked=value;else f.value=value;}},
  submit(){assert.ok(form,'form is open');form.onsubmit({preventDefault(){}});},approve(reason='Explicitly reviewed synthetic fixture'){this.fields({reason,confirmed:true});this.submit();},action(selector){const n=ctx.$(selector);assert.equal(typeof n.onclick,'function',selector+' click handler');n.onclick();},
  attemptClose(accepted){const target={closest(selector){return selector==='[data-close]'?{}:null;}};for(const {fn}of [...listeners.get('click')||[]])fn({type:'click',target});if(accepted)ctx.closeModal();},close(){this.attemptClose(true);},dispose(){isActive=false;for(const fn of disposers)fn();},
  snapshot(){return {state:JSON.stringify(state),primary,recovery,writes};}
 };return api;
}
function create(h,overrides={}){h.click('new');h.fields({expenseId:'pay',amount:'1000.00',name:'Synthetic school principal',reason:'Original paid principal reviewed',paidPrincipalOnly:true,noTrackedWalletOverlap:true,...overrides});h.submit();assert.match(h.title,/逐项核对/,(h.errors||[]).join(';'));h.approve();assert.equal(h.state.bookkeeping?.heldPositions.length,1,(h.errors||[]).join(';'));return h.state.bookkeeping.heldPositions[0].id;}
module.exports={L,R,H,harness,fixture,create,copy};
