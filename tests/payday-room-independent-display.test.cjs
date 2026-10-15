'use strict';
const test=require('node:test'),H=require('./payday-room-independent-host-fixtures.cjs'),{A,F}=H;
const mutations=[
 ['extra top-level field','r.safeToSpend=true;'],
 ['extra account field','r.accounts[0].guarantee=true;'],
 ['extra floor field','r.accounts[0].protectionFloor.date=r.nextIncomeDate;'],
 ['extra scope field','r.scope.complete=true;'],
 ['extra consent field','r.consent={...r.consent,permanent:true};'],
 ['extra source warnings','r.sourceWarnings.hidden=true;'],
 ['missing report field','delete r.disclosures;'],
 ['unresolved fixed reference','r.partitions.beforeCheckpoint.fixedIds.push("nonexistent");'],
 ['unresolved residual reference','r.partitions.unplacedResidualIds.push("nonexistent");'],
 ['unresolved blocker reference','r.accounts[0].inheritedBlockerIds.push("nonexistent");'],
 ['fake source identity','r.sourceReport=JSON.parse(JSON.stringify(r.sourceReport));'],
 ['changed room date','r.nextIncomeDate="2026-10-21";'],
 ['changed source closing','r.accounts[0].sourceDailyClosingAtWindowEndCents+=1;'],
 ['changed source anchor','r.accounts[0].supportedAnchorCents+=1;'],
 ['changed warning count','r.scope.originalSourceWarningCount+=1;'],
 ['changed floor purpose','r.accounts[0].protectionFloor.purpose="different";'],
 ['new shared alias','r.accounts[0].protectionFloor=r.query.protectionFloors[0];'],
 ['nested getter','Object.defineProperty(r.accounts[0],"conditionalRoomCents",{enumerable:true,get(){reviewHostileCalls++;throw 1}});'],
 ['own toJSON','r.toJSON=function(){reviewHostileCalls++;throw 1};'],
 ['inherited toJSON','Object.setPrototypeOf(r,{toJSON(){reviewHostileCalls++;throw 1}});'],
 ['symbol key','r[Symbol("x")]=true;'],
 ['sparse account array','delete r.accounts[0];'],
 ['cycle','r.disclosures.push(r);'],
];
for(const [name,mutation]of mutations)test('PRI HD01 closed room display rejects '+name+' before display or getter execution',()=>{const a=H.inputs(H.open(H.daily(H.app(true))));a.run(`globalThis.reviewHostileCalls=0;reviewRoomTransform=(name,out,args)=>{if(name!=='previewRoom')return out;const r=JSON.parse(JSON.stringify(out.report));r.sourceReport=out.report.sourceReport;${mutation}return {ticket:out.ticket,report:r};};`);H.click(a,'#daily-room-preview');A.equal(a.node('#daily-room-consent'),null);A.doesNotMatch(a.node('#daily-room-result')?.textContent||'',/待确认：各账户/);A.equal(a.run('reviewHostileCalls'),0);A.equal(H.sourceCurrent(a),true);H.quiet(a);});
for(const personal of [true,false])for(const stage of ['previewRoom','confirmRoom'])test('PRI HD02 '+(personal?'index':'demo')+' '+stage+' hostile thrown error never inspected',()=>{const a=H.inputs(H.open(H.daily(H.app(personal))));if(stage==='confirmRoom')H.preview(a);a.run(`globalThis.reviewHostileCalls=0;reviewRoomTransform=(name,out,args)=>{if(name!==${JSON.stringify(stage)})return out;throw new Proxy({},{get(){reviewHostileCalls++;throw 1},ownKeys(){reviewHostileCalls++;throw 1},getOwnPropertyDescriptor(){reviewHostileCalls++;throw 1},getPrototypeOf(){reviewHostileCalls++;throw 1}})};`);if(stage==='previewRoom')H.click(a,'#daily-room-preview');else{const form=a.node('#daily-room-consent');H.fill(form,F.roomConsent());form.dispatch('submit');}A.equal(a.run('reviewHostileCalls'),0);A.equal(a.node('#daily-room-consent')?.querySelectorAll('input,button').length||0,0);A.doesNotMatch(a.node('#daily-room-result')?.textContent||'',/本次已确认/);A.equal(H.sourceCurrent(a),true);H.quiet(a);});
