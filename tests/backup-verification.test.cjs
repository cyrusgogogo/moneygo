'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const L=require('../dist/ledger.js');
test('isolated backup verification checks records and balances without modifying live state',()=>{
 let state=L.putTransaction(L.createEmpty(),{type:'expense',date:'2026-10-01',amountCents:12345,accountId:'account-cash',categoryId:'expense-other',note:'合成记录'});
 const before=JSON.stringify(state),result=L.verifyBackup(L.backup(state));
 assert.equal(result.counts.transactions,1);assert.equal(result.balances['account-cash'],-12345);
 assert.equal(JSON.stringify(state),before);assert.notEqual(result.state,state);
 result.state.transactions[0].note='副本';assert.equal(state.transactions[0].note,'合成记录');
});
test('isolated verification rejects corrupt amounts and mismatched envelope versions',()=>{
 const backup=JSON.parse(L.backup(L.createEmpty()));
 backup.data.version=2;assert.throws(()=>L.verifyBackup(JSON.stringify(backup)));
 backup.data.version=1;backup.data.accounts[0].openingBalanceCents=0.5;
 assert.throws(()=>L.verifyBackup(JSON.stringify(backup)),/整数分/);
});
test('isolated v2 verification preserves simulation and deleted transaction balances',()=>{
 const S=require('../dist/scenario.js');let state=L.createEmpty();state.simulation=S.defaultSettings();state=L.validateState(state);
 state=L.putTransaction(state,{type:'income',date:'2026-10-02',amountCents:100,accountId:'account-cash',categoryId:'income-other'});
 state=L.deleteTransaction(state,state.transactions[0].id);
 const result=L.verifyBackup(L.backup(state));assert.equal(result.state.version,2);assert.equal(result.counts.trash,1);assert.equal(result.balances['account-cash'],0);assert.deepEqual(result.state.simulation,state.simulation);
});
