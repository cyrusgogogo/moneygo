'use strict';
// H05-H07 and H10 actual-entry lifecycle coverage; all fixtures synthetic.
const test=require('node:test'),assert=require('node:assert/strict');
const H=require('./payday-room-host-harness.cjs');
function current(a,r=H.latest(a,'confirmRoom')){return r.real.isRoomCurrent(a.run('state'),r.out,r.args[3]);}
function noRevival(a,r,old){const count=a.counts.confirmRoom||0;old.dispatch('click');assert.equal(a.counts.confirmRoom||0,count);assert.equal(current(a,r),false);assert.doesNotMatch(a.node('#daily-room-result')?.textContent||'',/本次已确认/);}
for(const personal of [true,false])for(const event of ['close','navigation','modal','pagehide','window-freeze','document-freeze','popstate','hashchange','visibility','mutation','dispose'])test('room host H07 '+(personal?'index':'demo')+': '+event+' retires all ancestor authority and detached room handlers',()=>{
 const a=H.roomReady({personal}),r=H.latest(a,'confirmRoom'),d=H.latest(a,'confirm'),b=H.latest(a,'confirmBasis'),old=a.node('#daily-room-full'),before=H.snapshot(a);
 switch(event){case'close':H.click(a,'#daily-close');H.click(a,'#daily-close');break;case'navigation':H.click(a,'[data-page="report"]');H.click(a,'[data-page="daily-cash"]');break;case'modal':H.click(a,'[data-action="new"]');break;case'window-freeze':a.windowEvent('freeze');break;case'document-freeze':a.documentEvent('freeze');break;case'visibility':a.doc.visibilityState='hidden';a.documentEvent('visibilitychange');break;case'mutation':a.run('state=L.putTransaction(state,{type:"expense",date:"2026-10-14",amountCents:1,accountId:"account-cash",categoryId:"expense-other",note:"Synthetic changed raw state"});DC.invalidate();render()');break;case'dispose':a.run('runtime.lifecycle.dispose()');break;default:a.windowEvent(event);}
 noRevival(a,r,old);assert.equal(d.real.isCurrent(a.run('state'),d.out,d.args[3]),false);assert.equal(b.real.isAnchorCurrent(a.run('state'),b.out.anchor),false);assert.deepEqual(a.value('roomWrites'),[]);assert.deepEqual(a.counters.forbidden,[]);if(event!=='mutation'&&a.run('active()'))assert.equal(a.run('JSON.stringify(state)'),before.state);if(!personal){assert.equal(a.counters.localStorage,0);assert.equal(a.counters.sessionStorage,0);}
});
for(const key of [H.KEY,'moneygo.backupVerification.note.v1','unrelated-key',null])test('room host H07: personal storage event '+key+' retires room and daily',()=>{
 const a=H.roomReady(),r=H.latest(a,'confirmRoom'),d=H.latest(a,'confirm'),old=a.node('#daily-room-full');a.windowEvent('storage',{key});noRevival(a,r,old);assert.equal(d.real.isCurrent(a.run('state'),d.out,d.args[3]),false);H.quiet(a);
});
for(const control of ['daily-horizon-input','daily-horizon-change','daily-show-review','daily-show-basis','daily-preview'])test('room host H07: ancestor '+control+' retires room permanently with original query reversion',()=>{
 const a=H.roomReady(),r=H.latest(a,'confirmRoom'),d=H.latest(a,'confirm'),b=H.latest(a,'confirmBasis'),old=a.node('#daily-room-full'),horizon=d.out.horizonEnd;
 if(control==='daily-horizon-input')H.field(a,'#daily-horizon','2026-11-14','input');else if(control==='daily-horizon-change')H.field(a,'#daily-horizon','2026-11-14','change');else H.click(a,'#'+control);
 noRevival(a,r,old);assert.equal(d.real.isCurrent(a.run('state'),d.out,d.args[3]),false);assert.equal(b.real.isAnchorCurrent(a.run('state'),b.out.anchor),true);if(a.node('#daily-horizon'))H.field(a,'#daily-horizon',horizon,'input');assert.equal(current(a,r),false);H.quiet(a);
});
for(const event of ['focus','pageshow','visibilitychange','click'])test('room host H10: day rollover is detected before '+event+' and old source cannot revive',()=>{
 let now=H.NOW;class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
 const a=H.roomReady({Date:Clock}),r=H.latest(a,'confirmRoom'),d=H.latest(a,'confirm'),old=a.node('#daily-room-full');now='2026-10-15T12:00:00.000Z';a.run('roomStateReads=0');if(event==='click')H.click(a,'#daily-room-full');else if(event==='visibilitychange'){a.doc.visibilityState='visible';a.documentEvent(event);}else a.windowEvent(event);assert.equal(a.run('roomStateReads'),1);noRevival(a,r,old);assert.equal(d.real.isCurrent(a.run('state'),d.out,d.args[3]),false);now=H.NOW;assert.equal(current(a,r),false);H.quiet(a);
});
test('room host H07: restore opening retires room, then stale detached handlers stay inert',()=>{
 const a=H.roomReady(),r=H.latest(a,'confirmRoom'),old=a.node('#daily-room-full');a.run('showRestore()');assert.ok(a.node('#restore-file'));noRevival(a,r,old);H.quiet(a);
});
test('room host H07: demo reset retires room before reload, without acquiring personal storage',()=>{
 const a=H.roomReady({personal:false}),r=H.latest(a,'confirmRoom'),old=a.node('#daily-room-full');H.click(a,'[data-action="reset-demo"]');H.click(a,'#confirm-demo-reset');assert.equal(a.run('active()'),false);assert.equal(a.counters.reloads,1);noRevival(a,r,old);assert.equal(a.counters.localStorage,0);assert.equal(a.counters.sessionStorage,0);assert.deepEqual(a.counters.personalIO,[]);
});
test('room host H07: a pending detached confirmation cannot run after navigation and fresh entry',()=>{
 const a=H.roomPreview(H.roomInputs(H.openRoom(H.ready()))),old=a.node('#daily-room-consent');H.fill(old,{...Object.fromEntries(H.ROOM_CONSENT.map(k=>[k,true])),reason:'Detached pre-navigation consent'});H.click(a,'[data-page="report"]');H.click(a,'[data-page="daily-cash"]');old.dispatch('submit');assert.equal(a.counts.confirmRoom||0,0);assert.equal(a.node('#daily-review-sources').disabled,true);assert.equal(a.node('#daily-room-result'),null);assert.equal(a.node('#cash-daily-account-account-cash').value,'unreviewed');H.quiet(a);
});
test('room host H10: raw-state getter failure clears visible room and retires original daily anchor',()=>{
 const a=H.app({open:false});a.run('globalThis.roomReadFails=false;globalThis.roomFailureContext=dailyCashContext;dailyCashContext=()=>{const c=roomFailureContext();return {...c,getState(){if(roomReadFails)throw Error("Synthetic unavailable state");return c.getState();}}}');H.click(a,'[data-page="daily-cash"]');H.confirm(H.preview(H.inventory(a)));H.roomConfirm(H.roomPreview(H.roomInputs(H.openRoom(a))));const r=H.latest(a,'confirmRoom'),d=H.latest(a,'confirm'),b=H.latest(a,'confirmBasis'),old=a.node('#daily-room-full');a.run('roomReadFails=true');H.click(a,'#daily-room-full');noRevival(a,r,old);assert.equal(d.real.isCurrent(a.run('state'),d.out,d.args[3]),false);assert.equal(b.real.isAnchorCurrent(a.run('state'),b.out.anchor),false);H.quiet(a);
});
test('room host H10: alternating host outputs are captured once for room preview and redraw',()=>{
 const a=H.roomInputs(H.openRoom(H.ready()));a.run('globalThis.roomMovedState=JSON.parse(JSON.stringify(state));roomMovedState.accounts[0].name="Changed between reads";globalThis.roomMovingReads=0;window.MoneygoDailyCashUI.initialize({...dailyCashContext(),getState(){roomMovingReads++;return roomMovingReads===1?state:roomMovedState;}})');H.roomPreview(a);assert.equal(a.run('roomMovingReads'),1);assert.equal(H.latest(a,'previewRoom').out.report.sourceReport,H.report(a));H.quiet(a);
});
