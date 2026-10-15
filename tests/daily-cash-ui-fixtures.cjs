'use strict';
// Public-writer-only synthetic stress fixtures. No unknown ledger keys or forged reports.
const F=require('./daily-cash-model/boundary-fixtures.cjs');
function quarantines(rows=1){let state=F.fixture();const long='x'.repeat(1000),note='😀'.repeat(500);const csv='Date,Amount,Direction,Note,Id,Status,Channel\n'+Array.from({length:rows},(_,i)=>['2027-01-01','invalid',long,note,'row'+i,long,long].join(',')).join('\n');const preview=F.I.preview(state,csv,{sourceKey:'large-source',accountId:'account-cash',delimiter:',',columns:{date:0,amount:1,direction:2,note:3,stableId:4,status:5,channel:6},defaultType:'expense'});state=F.I.commit(state,preview,[]);return state;}
module.exports={quarantines,F};
