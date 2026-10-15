'use strict';
const L=require('../dist/ledger.js'),H=require('../dist/held-funds.js');
function base(){const state=L.createEmpty();state.accounts[0].openingBalanceCents=200000;state.transactions=[{id:'held-source',type:'expense',date:'2026-01-02',amountCents:100000,accountId:state.accounts[0].id,categoryId:'expense-other',note:'SYNTHETIC paid principal'},{id:'held-receipt',type:'income',date:'2026-03-02',amountCents:30000,accountId:state.accounts[0].id,categoryId:'income-other',note:'SYNTHETIC recorded return'}];return L.validateState(state);}
const coordinator=()=>H.createCoordinator({now:()=> '2026-04-15T12:00:00.000Z'});
const positionCommand=()=>({action:'create-position',asOfDate:'2026-04-15',expenseId:'held-source',amountCents:100000,kind:'deposit',name:'SYNTHETIC held deposit',purpose:'Synthetic integration fixture',reference:'',expiry:{kind:'unknown',date:null},refundability:'unknown',terms:'',termsSource:'',confirmations:{paidPrincipalOnly:true,noTrackedWalletOverlap:true}});
function run(api,state,command){const ticket=api.preview(state,command);return api.commit(state,ticket,{confirmed:true,reason:'SYNTHETIC explicit classification'});}
function funded(){const api=coordinator();return run(api,base(),positionCommand());}
function used(){const api=coordinator(),state=funded();return run(api,state,{action:'recognize',asOfDate:'2026-04-15',positionId:state.bookkeeping.heldPositions[0].id,kind:'use',amountCents:20000,effectiveDate:'2026-02-03',categoryId:'expense-food',merchant:'SYNTHETIC merchant',reference:'',confirmations:{notAlreadyRecordedAsExpense:true}});}
function full(){const api=coordinator(),state=used();return run(api,state,{action:'allocate-return',asOfDate:'2026-04-15',positionId:state.bookkeeping.heldPositions[0].id,incomeId:'held-receipt',amountCents:30000,reference:''});}
module.exports={L,H,base,coordinator,positionCommand,run,funded,used,full};
