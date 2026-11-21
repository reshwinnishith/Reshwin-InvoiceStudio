// App-logic tests: runs app.js in a vm with a DOM stub and an in-memory FAKE cloud (no network, no Firebase).
// Real Firebase behaviour is covered separately by the emulator suites under tests/rules and tests/cloud.
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const core=require('../core.js');
const source=fs.readFileSync('app.js','utf8');
const store=new Map();
const nodes=new Map();
function node(id){
 return {id,value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,dataset:{},className:'',style:{},
  classList:{add(){},remove(){}},children:[],clientWidth:400,handlers:{},attrs:{},
  focus(){},scrollIntoView(){},appendChild(x){this.children.push(x)},replaceChildren(){this.children=[]},
  addEventListener(t,fn){this.handlers[t]=fn},querySelectorAll(){return[]},setAttribute(k,v){this.attrs[k]=v},matches(){return false},closest(){return null}};
}
const get=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id);};
const context=vm.createContext({
 console,InvoiceCore:core,
 localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>{store.set(k,v)},removeItem:k=>store.delete(k)},
 location:{reload(){context.__reloads=(context.__reloads||0)+1;}},
 document:{getElementById:get,createElement:tag=>node(tag),addEventListener(){},querySelectorAll(){return[]},title:'test',visibilityState:'visible'},
 window:{scrollTo(){},addEventListener(){},print(){}},
 navigator:{onLine:true},confirm:()=>true,
 requestAnimationFrame:fn=>fn(),setTimeout:(fn)=>{return 1},clearTimeout(){},setInterval:()=>1,clearInterval(){},
 Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}}
});
vm.runInContext(source,context,{filename:'app.js'});
const run=code=>vm.runInContext(code,context);
const flush=()=>new Promise(r=>setImmediate(r));
const settle=async()=>{for(let i=0;i<8;i++)await flush();};
const toasts=()=>get('toast').textContent;
const visible=()=>[...nodes.keys()].filter(k=>k.startsWith('v-')&&nodes.get(k).hidden===false).map(k=>k.slice(2));
const click=async id=>{await get(id).onclick();await settle();};
const submit=async id=>{await get(id).handlers.submit({preventDefault(){}});await settle();};
for(const v of ['loading','welcome','verify','reset','home','generate','invoice','details','clients','client','client-edit','settings','migrate'])get('v-'+v).hidden=true;

/* ---- fake cloud ---- */
class CloudError extends Error{constructor(code,message){super(message);this.code=code;}}
function makeFake(){
 const accounts={};let session={status:'signedOut'};const subs=new Set();const log=[];let seq=0;
 const f={log,workspaces:[],failNext:null,gate:null,
  describeAuthError:e=>'AUTH:'+(e.code||e.message),
  get session(){return session;},
  setSession(s){session=s;[...subs].forEach(cb=>cb(s));},
  onSession(cb){subs.add(cb);cb(session);return()=>subs.delete(cb);},
  async signUp(email,pw){log.push('signUp');if(accounts[email])throw Object.assign(Error('x'),{code:'auth/email-already-in-use'});accounts[email]={uid:'u-'+email,data:{sender:null,clients:[],invoices:[],counter:0},verified:false};f.setSession({status:'unverified',uid:accounts[email].uid,email});return{verificationSent:true};},
  async signIn(email,pw){log.push('signIn');const a=accounts[email];if(!a||pw==='bad')throw Object.assign(Error('x'),{code:'auth/invalid-credential'});f.setSession(a.verified?{status:'ready',uid:a.uid,email}:{status:'unverified',uid:a.uid,email});},
  async signOut(){log.push('signOut');f.setSession({status:'signedOut'});},
  async resendVerification(){log.push('resend');if(f.cooldown)throw new CloudError('cooldown','Please wait 30 seconds before requesting another email.');},
  async refreshVerification(){log.push('refresh');const email=session.email;if(accounts[email]?.verified){f.setSession({status:'ready',uid:session.uid,email});}return session;},
  async requestPasswordReset(email){log.push('reset:'+email);},
  verify(email){accounts[email].verified=true;},
  openWorkspace(uid,h){
   const acct=Object.values(accounts).find(a=>a.uid===uid);const d=acct.data;let closed=false;
   const push=()=>{if(!closed)Promise.resolve().then(()=>{if(!closed)h.onData({sender:d.sender?.doc||null,senderToken:d.sender?.t??null,clients:d.clients.map(x=>({...x})),invoices:d.invoices.map(x=>({...x})),counter:d.counter},{ready:true,offline:!!f.offline});});};
   const op=async(name,fn)=>{if(closed)throw new CloudError('account-changed','Your session changed.');log.push(name);if(f.gate)await f.gate;if(f.failNext){const e=f.failNext;f.failNext=null;throw e;}const r=fn();push();return r;};
   const ws={uid,closed:()=>closed,close(){closed=true;},
    async ensureProfile(){log.push('profile');},
    saveSender:(s,t)=>op('saveSender',()=>{d.sender={doc:s,t:(d.sender?.t||0)+1};}),
    saveClient:(c,cid,t)=>op('saveClient',()=>{const x=cid||'c'+(++seq);const i=d.clients.findIndex(y=>y.id===x);const rec={id:x,...c,updateToken:1};if(i>=0)d.clients[i]=rec;else d.clients.push(rec);return x;}),
    deleteClient:cid=>op('deleteClient',()=>{d.clients=d.clients.filter(x=>x.id!==cid);}),
    saveDraft:(iid,input,client,sender,t)=>op('saveDraft',()=>{const x=iid||'i'+(++seq);const rec={id:x,no:'',sequence:0,date:input.date,clientId:client.id,client:{id:client.id,...core.validateClient(client).value},from:{...sender},reg:input.reg,amountPaise:input.amountPaise,taxRate:input.taxRate,taxPaise:input.taxPaise,totalPaise:input.totalPaise,status:'draft',createdAt:String(seq),updateToken:1};const i=d.invoices.findIndex(y=>y.id===x);if(i>=0)d.invoices[i]=rec;else d.invoices.unshift(rec);return x;}),
    deleteDraft:iid=>op('deleteDraft',()=>{d.invoices=d.invoices.filter(x=>x.id!==iid);}),
    issue:(iid,t)=>op('issue',()=>{const inv=d.invoices.find(x=>x.id===iid);d.counter++;inv.status='issued';inv.sequence=d.counter;inv.no=core.formatNumber(inv.date,d.counter);return{sequence:d.counter,number:inv.no};}),
    setStatus:(iid,s,t)=>op('setStatus:'+s,()=>{d.invoices.find(x=>x.id===iid).status=s;})
   };
   f.workspaces.push(ws);push();return ws;
  }};
 return f;
}
(async()=>{
 const fake=makeFake();
 context.window.InvoiceApp.start(fake);
 await settle();
 assert.deepEqual(visible(),['welcome'],'signed-out users see only the welcome screen');
 assert.ok(!get('bar').innerHTML.includes('setBtn'),'no private chrome while signed out');

 /* sign-up validation and errors */
 run("setAuthMode('up')");
 get('au_email').value='not-an-email';get('au_pass').value='x';await submit('au_form');
 assert.match(get('au_msg').textContent,/valid email/);
 get('au_email').value='a@example.test';get('au_pass').value='short';await submit('au_form');
 assert.match(get('au_msg').textContent,/12 characters/);
 get('au_pass').value='Fictional-Pass-1234';get('au_pass2').value='different-pass-1234';await submit('au_form');
 assert.match(get('au_msg').textContent,/do not match/); assert.ok(!fake.log.includes('signUp'));
 get('au_pass2').value='Fictional-Pass-1234';await submit('au_form');
 assert.ok(fake.log.includes('signUp')); assert.deepEqual(visible(),['verify']); assert.equal(get('vf_email').textContent,'a@example.test');
 assert.equal(get('au_pass').value,'','password field is cleared after submit');

 /* verification gate: nothing private opens, resend/cooldown/check */
 assert.equal(fake.workspaces.length,0,'no workspace for an unverified account');
 await click('vf_check'); assert.match(get('vf_msg').textContent,/Not verified yet/); assert.deepEqual(visible(),['verify']);
 fake.cooldown=true; await click('vf_resend'); assert.match(get('vf_msg').textContent,/wait 30 seconds/); fake.cooldown=false;
 get('vf_resend').disabled=false; await click('vf_resend'); assert.match(get('vf_msg').textContent,/sent again/);
 fake.verify('a@example.test'); await click('vf_check');
 assert.deepEqual(visible(),['home'],'verified users reach the app'); assert.equal(fake.workspaces.length,1);
 assert.match(get('set_account').textContent,/a@example\.test/);

 /* duplicate account + wrong password messages */
 await click('signOut'); assert.deepEqual(visible(),['welcome']);
 run("setAuthMode('in')");get('au_email').value='a@example.test';get('au_pass').value='bad';await submit('au_form');
 assert.equal(get('au_msg').textContent,'AUTH:auth/invalid-credential');

 /* reset flow */
 await click('au_forgot'); assert.deepEqual(visible(),['reset']); get('rs_email').value='bad';await submit('rs_form');assert.match(get('rs_msg').textContent,/valid email/);
 get('rs_email').value='a@example.test';await submit('rs_form');assert.match(get('rs_msg').textContent,/If an account exists/); assert.ok(fake.log.includes('reset:a@example.test'));
 await click('rs_back');

 /* legacy browser data exists: must NOT be attached to the account */
 const legacy={from:{name:'Legacy Sender',addr:'Legacy Addr',pan:'',type:'',bank:'',branch:'',acc:'',ifsc:''},clients:[{id:'lc1',name:'Legacy Client',addr:'A',pan:'',gstin:''}],invoices:[{id:'li1',no:'RESH-2026-001',date:'2026-11-20',clientId:'lc1',client:{id:'lc1',name:'Legacy Client',addr:'A',pan:'',gstin:''},from:{name:'Legacy Sender',addr:'Legacy Addr',pan:'',type:'',bank:'',branch:'',acc:'',ifsc:''},reg:'Old work',amountPaise:10000,taxRate:0,taxPaise:0,totalPaise:10000,status:'issued'}],seq:2};
 store.set('reshwin-invoice-studio-v2',JSON.stringify(legacy));const legacyRaw=store.get('reshwin-invoice-studio-v2');
 get('au_email').value='a@example.test';get('au_pass').value='Fictional-Pass-1234';await submit('au_form');
 assert.deepEqual(visible(),['home']);
 assert.equal(run('state.invoices.length'),0,'legacy invoices are not silently attached'); assert.equal(run('state.clients.length'),0);

 /* details, client, draft, issue */
 await click('navDetails');
 for(const [k,v] of Object.entries({name:'Fictional Sender',addr:'Example City',pan:'',type:'Savings',bank:'Bank',branch:'Br',acc:'123456',ifsc:''}))get('f_'+k).value=v;
 get('f_acc').value='12';await click('f_save');assert.match(toasts(),/bank account/);assert.ok(!fake.log.includes('saveSender'),'invalid input never reaches the cloud');
 get('f_acc').value='123456789';await click('f_save');assert.equal(toasts(),'Details saved');assert.equal(run('state.from.name'),'Fictional Sender');
 await click('addClient'); get('ce_name').value='<img src=x onerror=alert(1)>';get('ce_addr').value='Client address';await click('ce_save');
 assert.equal(run('state.clients.length'),1); assert.ok(!get('clientList').innerHTML.includes('<img'),'client names are escaped');
 const cid=run('state.clients[0].id');
 await click('fab');get('g_client').value=cid;get('g_reg').value='Performance';get('g_amt').value='25000.50';get('g_date').value='2026-11-20';get('g_tax').value='0';
 await click('g_go'); assert.equal(run('state.invoices.length'),1); assert.equal(run('state.invoices[0].status'),'draft'); assert.equal(run('state.invoices[0].no'),'');
 assert.equal(visible()[0],'invoice'); assert.match(get('paper').innerHTML,/Assigned when issued/); assert.ok(!get('paper').innerHTML.includes('<img src'),'invoice paper escapes content');
 assert.equal(get('issueInv').hidden,false);assert.equal(get('deleteInv').hidden,false);
 await click('issueInv'); assert.match(toasts(),/RESH-2026-001 issued/); assert.equal(run('state.invoices[0].status'),'issued');
 assert.equal(get('editInv').hidden,true);assert.equal(get('deleteInv').hidden,true);assert.match(get('paper').innerHTML,/RESH-2026-001/);
 run("openInvoiceEditor(state.invoices[0].id)");assert.match(toasts(),/cannot be edited/);
 await click('paidInv');assert.equal(run('state.invoices[0].status'),'paid');
 await click('voidInv');assert.equal(run('state.invoices[0].status'),'paid','paid invoices cannot be voided');

 /* failed write: no success message, no state change, no double counting */
 let before=run('state.clients.length');
 fake.failNext=new CloudError('offline','You appear to be offline. Nothing was saved.');
 await click('navClients'); await click('addClient');get('ce_name').value='Will Fail';get('ce_addr').value='x';await click('ce_save');
 assert.match(toasts(),/Nothing was saved/);assert.equal(run('state.clients.length'),before);assert.equal(visible()[0],'client-edit','stay on the form so nothing is lost');
 assert.equal(get('ce_name').value,'Will Fail','typed data is preserved after a failed save');
 await click('ce_save'); assert.equal(toasts(),'Client saved'); assert.equal(run('state.clients.length'),before+1);

 /* double submit: only one write while the first is pending */
 let release;fake.gate=new Promise(r=>{release=r;});
 await click('addClient');get('ce_name').value='Once';get('ce_addr').value='x';
 const writesBefore=fake.log.filter(x=>x==='saveClient').length;
 const p1=get('ce_save').onclick(),p2=get('ce_save').onclick();
 await settle();release();fake.gate=null;await p1;await p2;await settle();
 assert.equal(fake.log.filter(x=>x==='saveClient').length,writesBefore+1,'double tap sends one write');

 /* offline blocks writes with a clear message and a banner */
 await click('navDetails');await click('addClient');get('ce_name').value='Offline';get('ce_addr').value='x';
 // simulate the listener reporting cache-only (offline) data
 run("onData({sender:null,senderToken:null,clients:state.clients,invoices:state.invoices,counter:state.counter},{ready:true,offline:true})");
 const writes=fake.log.length;await click('ce_save');assert.match(toasts(),/offline/i);assert.equal(fake.log.length,writes,'no write is attempted while offline');
 assert.equal(get('netBanner').hidden,false);
 run("onData({sender:null,senderToken:null,clients:state.clients,invoices:state.invoices,counter:state.counter},{ready:true,offline:false})");fake.offline=false;
 assert.equal(get('netBanner').hidden,true);

 /* account switch: old private state, DOM and workspace are gone; stale operations cannot land */
 const oldWs=fake.workspaces.at(-1);
 await click('signOut');
 assert.ok(oldWs.closed(),'workspace closed on logout'); assert.ok(context.__reloads>=1,'page reloads on logout so the SDK memory cache cannot outlive the account'); assert.equal(run('state.invoices.length'),0);assert.equal(run('state.clients.length'),0);assert.equal(run('state.from.name'),'');
 assert.equal(get('iblist').innerHTML,'');assert.equal(get('paper').innerHTML,'');assert.equal(get('clientList').innerHTML,'');assert.equal(get('clientDetail').innerHTML,'');
 assert.deepEqual(visible(),['welcome']);
 await assert.rejects(oldWs.saveSender({}),/changed/,'stale workspace rejects writes');
 // account B
 run("setAuthMode('up')");get('au_email').value='b@example.test';get('au_pass').value='Fictional-Pass-9999';get('au_pass2').value='Fictional-Pass-9999';await submit('au_form');
 fake.verify('b@example.test');await click('vf_check');
 assert.deepEqual(visible(),['home']);assert.equal(run('state.invoices.length'),0,'account B starts empty');assert.equal(get('iblist').innerHTML.includes('Legacy'),false);
 assert.equal(run('state.from.name'),'');
 await click('navDetails');assert.equal(get('f_name').value,'','details form does not leak account A data');

 /* in-flight write from account B fails after switching away: the old account's error is never shown */
 await click('navClients');await click('addClient');get('ce_name').value='InFlight';get('ce_addr').value='x';
 let rel;fake.gate=new Promise(r=>{rel=r;});fake.failNext=new CloudError('unknown','OLD-ACCOUNT-ERROR');
 const inflight=get('ce_save').onclick();await settle();
 get('toast').textContent='';await click('signOut');rel();fake.gate=null;await inflight;await settle();
 assert.notEqual(get('toast').textContent,'OLD-ACCOUNT-ERROR','stale failure from the previous account is suppressed');
 assert.deepEqual(visible(),['welcome']);
 get('au_email').value='b@example.test';get('au_pass').value='Fictional-Pass-9999';await submit('au_form');
 assert.deepEqual(visible(),['home']);

 /* migration preview performs no writes and leaves the browser copy untouched */
 await click('setBtn');assert.equal(get('openMigrate').hidden,false);
 const w2=fake.log.length;await click('openMigrate');
 assert.equal(visible()[0],'migrate'); assert.ok(run('migrationPlan.ok'),run('migrationPlan.errors.join()'));assert.match(get('mg_report').innerHTML,/Validation passed/);
 assert.equal(get('mg_import').disabled,true,'import stays disabled');assert.equal(get('mg_backup').disabled,false);
 assert.equal(fake.log.length,w2,'preview makes no cloud calls'); assert.equal(store.get('reshwin-invoice-studio-v2'),legacyRaw,'browser data untouched');
 console.log('PASS: app flows — auth gate, verification, isolation, failed/offline/duplicate writes, issuing, migration preview');
})().catch(e=>{console.error(e);process.exit(1);});
