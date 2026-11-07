const {test}=require('node:test'),assert=require('node:assert/strict');
const {isViolation,nextState}=require('../../src/textModeration');
test('filter catches obfuscation without matching harmless substrings',()=>{
 for(const text of ['gago','g a g o','g@go','GAAAGO','putangina!','p.u.t.a.n.g.i.n.a','sh!t','papatayin kita','send me nudes'])assert.equal(isViolation(text),true,text);
 for(const text of ['Good morning','Tangan ko ang bag','Scunthorpe','I study sexual health'])assert.equal(isViolation(text),false,text);
 assert.equal(isViolation('shit',false),false);assert.equal(isViolation('papatayin kita',false),true);
});
test('fixed warning window and restriction expire without attempts extending the clock',()=>{
 const now=1800000000000;let state=nextState({},true,now);state=nextState(state,false,now+100);assert.equal(state.violations,1);
 state=nextState(state,true,now+3599999);assert.equal(state.violations,2);assert.equal(+state.window_started_at,now);
 const reset=nextState(state,true,now+3600000);assert.equal(reset.violations,1);
 state=nextState(state,true,now+3599999);assert.equal(state.restricted,true);
 const repeat=nextState(state,true,now+3600000);assert.equal(repeat.violations,3);assert.equal(+repeat.restricted_until,+state.restricted_until);
 assert.equal(nextState(state,false,+state.restricted_until).violations,0);
});
