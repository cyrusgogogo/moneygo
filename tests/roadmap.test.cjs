'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const roadmap=fs.readFileSync(path.join(__dirname,'../ROADMAP.md'),'utf8'),status=fs.readFileSync(path.join(__dirname,'../IMPLEMENTATION_STATUS.md'),'utf8');
const rows=[...roadmap.matchAll(/#### (\d+)\.[^\n]+\n\n- [^\n]*?\*\*([^*]+)\*\*/g)].map(m=>({id:Number(m[1]),status:m[2].split('（')[0]}));
test('roadmap retains every unique original item 1 through 120',()=>{assert.equal(rows.length,120);assert.deepEqual(rows.map(r=>r.id),Array.from({length:120},(_,i)=>i+1));assert.match(roadmap,/每项“完成”的共同定义/);});
test('current implementation count matches individual roadmap states exactly',()=>{
 const expected=[['核心已发布',/已发布可用核心覆盖：(\d+)/],['局部基础',/其他已有局部基础：(\d+)/],['施工中',/当前新增施工：(\d+)/],['未开始',/尚未施工：(\d+)/],['已交付',/完整逐项验收交付：(\d+)/]];
 for(const [name,re] of expected){const m=status.match(re);assert.ok(m,'document count '+name);assert.equal(Number(m[1]),rows.filter(r=>r.status===name).length,name);}
});

test('roadmap keeps the exact original title at every numbered item',()=>{
 const original=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/roadmap-original-titles.json'),'utf8'));
 const headings=[...roadmap.matchAll(/^#### (\d+)\. ([^\n]+)$/gm)].map(m=>({id:Number(m[1]),title:m[2]}));
 assert.deepEqual(headings,original);
 assert.match(status,/\| #89 \| 手记实付/);
});
