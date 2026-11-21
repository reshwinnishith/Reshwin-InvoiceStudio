'use strict';
/* Reshwin Invoice Studio V2 — account-based. Private data lives in Firestore under users/{uid}/… and is held in memory only
   while its owner is signed in with a verified email. The legacy browser copy (localStorage) is never read into an account
   automatically, never written and never deleted by this file. */
const LEGACY_KEY = 'reshwin-invoice-studio-v2';
const Core = globalThis.InvoiceCore;
const $ = id => document.getElementById(id);
const today = () => { const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const blankFrom = () => Core.blankFrom();
const newState = () => ({from:blankFrom(),senderToken:null,clients:[],invoices:[],counter:0});
let state=newState(), view='loading', history=[], editingClient=null, viewingClient=null, editingInvoice=null, viewingInvoice=null, dirty=false;
let pendingInvoice=null, cloud=null, ws=null, sessionUid=null, synced=false, offline=false, busy=false, authMode='in', resendTimer=null, migrationPlan=null;
const AUTH_VIEWS=['loading','welcome','verify','reset'];
const VIEWS=['loading','welcome','verify','reset','home','generate','invoice','details','clients','client','client-edit','settings','migrate'];
const GEAR='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"/></svg>';
const ARROW='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>';
const TITLES={generate:'Invoice editor',invoice:'Invoice',details:'Your Details',clients:'Clients',client:'Client Details','client-edit':'Edit Client',settings:'Settings',migrate:'Import browser data'};
const id = () => (globalThis.crypto?.randomUUID?.() || ('id-'+Date.now()+'-'+Math.random().toString(36).slice(2)));
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function toast(msg){const e=$('toast');e.textContent=msg;e.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>e.classList.remove('show'),3200);}
const parseAmount=Core.parseAmount;
function money(paise){return '₹'+(Number(paise||0)/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function dateLabel(s){if(!Core.validDate(s))return '—';const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});}

/* ---------- navigation ---------- */
function checkLeave(){
 if(!dirty)return true;
 if(!confirm('Discard your unsaved changes?'))return false;
 dirty=false;return true;
}
function show(next){
 view=next;VIEWS.forEach(v=>{const e=$('v-'+v);if(e)e.hidden=v!==view});renderBar();window.scrollTo(0,0);
 // Move keyboard/screen-reader focus to the new screen's heading.
 const h=$('v-'+view)?.querySelector?.('h2,.invoicebox .h');if(h){h.setAttribute('tabindex','-1');h.focus?.({preventScroll:true});}
}
function paintView(){
 if(view==='home')renderInvoices();
 if(view==='clients')renderClients();
 if(view==='invoice'){renderInvoice(viewingInvoice);requestAnimationFrame(scalePaper);}
 if(view==='settings')renderSettings();
}
function go(next,{replace=false}={}){
 if(!VIEWS.includes(next)||!checkLeave())return;
 if(next!==view){if(!replace)history.push(view);}
 show(next);paintView();
}
function back(){
 if(!checkLeave())return;
 const previous=history.pop()||'home';
 show(previous);paintView();
}
function renderBar(){
 const bar=$('bar');
 const brand='<span class="mark"></span><span class="brandtext"><span class="t">Reshwin Invoice Studio</span><span class="s">Simple invoicing</span></span>';
 if(AUTH_VIEWS.includes(view)){bar.innerHTML=brand;return;}
 if(view==='home'){
   bar.innerHTML=brand+'<span class="spacer"></span><button class="iconbtn" id="setBtn" aria-label="Settings">'+GEAR+'</button>';
   $('setBtn').onclick=()=>go('settings');
 }else{
   bar.innerHTML='<button class="iconbtn back" id="backBtn" aria-label="Back">'+ARROW+'</button><span class="bartitle">'+esc(TITLES[view]||'')+'</span>';
   $('backBtn').onclick=back;
 }
}
function wireDirty(section){
 $(section).querySelectorAll('input,textarea,select').forEach(e=>e.addEventListener('input',()=>dirty=true));
}
function formValues(fields,prefix){return Object.fromEntries(fields.map(field=>[field,$(prefix+field).value.trim()]));}
function fillFields(fields,prefix,obj){fields.forEach(field=>$(prefix+field).value=obj?.[field]||'');}
const fromFields=['name','addr','pan','type','bank','branch','acc','ifsc'];
const clientFields=['name','addr','pan','gstin'];

/* ---------- write helper: one write at a time, success only after the server confirms ---------- */
async function perform(button,fn){
 if(busy)return false;
 if(!ws){toast('Please sign in again');return false;}
 if(offline||globalThis.navigator?.onLine===false){toast('You are offline. Nothing was saved.');return false;}
 const w=ws;busy=true;if(button)button.disabled=true;
 try{await fn(w);return true;}
 catch(e){
  if(w!==ws)return false; // account changed meanwhile: say nothing about the old account
  toast(e?.message||'Could not save. Nothing was changed.');
  if(e?.code==='conflict')paintView();
  return false;
 }finally{busy=false;if(button)button.disabled=false;}
}

/* ---------- account / session ---------- */
function teardown(){
 const w=ws;ws=null;sessionUid=null;
 try{w?.close();}catch(e){}
 state=newState();synced=false;offline=false;history=[];
 editingClient=viewingClient=editingInvoice=viewingInvoice=null;dirty=false;migrationPlan=null;
 for(const e of document.querySelectorAll('#v-home input,#v-generate input,#v-generate select,#v-details input,#v-details textarea,#v-client-edit input,#v-client-edit textarea,#v-generate textarea,#v-details select')){try{e.value='';}catch(_){}}
 for(const idn of ['iblist','clientList','clientDetail','paper','mg_report'])if($(idn))$(idn).innerHTML='';
 for(const idn of ['au_pass','au_pass2'])if($(idn))$(idn).value='';
 $('netBanner').hidden=true;
}
function showLoading(title,text,{retry=false}={}){
 $('ld_title').textContent=title;$('ld_text').textContent=text;$('ld_retry').hidden=!retry;$('ld_out').hidden=!retry;
 show('loading');
}
function setMsg(el,text,kind){el.textContent=text||'';el.hidden=!text;el.className='msg'+(kind?' '+kind:'');}
let knownUid=null;
// The Firestore SDK keeps fetched documents in an in-memory cache for the life of the page. When the signed-in account
// goes away or changes, discard private state and reload the page so no cached record can outlive its owner.
function hardResetIfAccountEnded(s){
 const ended=knownUid&&(s.status!=='ready'&&s.status!=='error'&&s.status!=='loading'||(s.status==='ready'&&s.uid!==knownUid));
 if(!ended)return false;
 knownUid=null;teardown();
 try{globalThis.location?.reload?.();}catch(e){}
 return false; // keep rendering the new state; the reload (if any) replaces the page right after
}
function onSession(s){
 hardResetIfAccountEnded(s);
 if(s.status==='ready')knownUid=s.uid;
 if(s.status==='ready'){
  if(sessionUid===s.uid&&ws)return;
  teardown();sessionUid=s.uid;$('set_account').textContent='Signed in as '+s.email;
  try{
   ws=cloud.openWorkspace(s.uid,{onData,onError:e=>{if(e?.code==='permission'||!synced)showLoading('Could not open your workspace',e?.message||'Please try again.',{retry:true});}});
  }catch(e){showLoading('Could not open your workspace',e?.message||'Please try again.',{retry:true});return;}
  showLoading('Opening your workspace…','Loading your invoices.');
  const name=String(s.email||'Account').split('@')[0].slice(0,200)||'Account';
  ws.ensureProfile(name).catch(()=>{/* retried on next sign-in; profile is not needed to view data */});
  return;
 }
 teardown();
 if(s.status==='signedOut'){history=[];setAuthMode('in');setMsg($('au_msg'),'');show('welcome');}
 else if(s.status==='unverified'){$('vf_email').textContent=s.email||'';setMsg($('vf_msg'),'');history=[];show('verify');}
 else if(s.status==='error'){showLoading('Could not confirm your session',s.message||'Check your connection and retry.',{retry:true});}
 else showLoading('Opening Invoice Studio…','Checking your sign-in.');
}
function onData(data,meta){
 if(!ws)return;
 const first=!synced;
 state.from=data.sender||blankFrom();state.senderToken=data.senderToken??null;state.clients=data.clients;state.invoices=data.invoices;state.counter=data.counter;
 offline=!!meta.offline;
 if(!meta.ready)return;
 synced=true;renderSync();
 if(first){history=[];dirty=false;show('home');paintView();return;}
 if(view==='invoice'&&viewingInvoice&&!state.invoices.some(x=>x.id===viewingInvoice)&&!pendingInvoice){viewingInvoice=null;show('home');history=[];toast('That invoice is no longer available');}
 if(!dirty||['home','clients','invoice','settings'].includes(view))paintView();
 if(pendingInvoice&&state.invoices.some(x=>x.id===pendingInvoice))pendingInvoice=null;
}
function renderSync(){
 const online=!offline&&globalThis.navigator?.onLine!==false;
 $('netBanner').hidden=online;
 $('netBanner').textContent=online?'':'You are offline. Changes cannot be saved until you reconnect.';
 const dot=$('syncDot');if(dot)dot.className='dot'+(online?' ok':' off');
 const t=$('syncText');if(t)t.textContent=online?'Synced with your account':'Offline — showing the last loaded data; changes cannot be saved';
}
function renderSettings(){
 renderSync();
 let legacy=false;try{legacy=!!globalThis.localStorage?.getItem(LEGACY_KEY);}catch(e){}
 $('openMigrate').hidden=!legacy;
}

/* ---------- auth screens ---------- */
function setAuthMode(mode){
 authMode=mode;const up=mode==='up';
 $('au_tab_in').setAttribute('aria-selected',String(!up));$('au_tab_up').setAttribute('aria-selected',String(up));
 $('au_heading').textContent=up?'Create your account':'Welcome back';
 $('au_hint').textContent=up?'One private workspace for your invoices, clients and details.':'Sign in to your private invoice workspace.';
 $('au_confirm_row').hidden=!up;$('au_pass_help').hidden=!up;$('au_forgot').hidden=up;
 $('au_pass').setAttribute('autocomplete',up?'new-password':'current-password');
 $('au_submit').textContent=up?'Create account':'Sign in';setMsg($('au_msg'),'');
}
const EMAIL_OK=e=>Core.RE.email.test(e);
async function submitAuth(ev){
 ev?.preventDefault?.();
 if(busy)return;
 const email=$('au_email').value.trim(),pass=$('au_pass').value;
 if(!EMAIL_OK(email)){setMsg($('au_msg'),'Enter a valid email address.','err');return;}
 if(!pass){setMsg($('au_msg'),'Enter your password.','err');return;}
 if(authMode==='up'){
  if(pass.length<12){setMsg($('au_msg'),'Choose a password of at least 12 characters.','err');return;}
  if(pass!==$('au_pass2').value){setMsg($('au_msg'),'The two passwords do not match.','err');return;}
 }
 busy=true;$('au_submit').disabled=true;setMsg($('au_msg'),authMode==='up'?'Creating your account…':'Signing in…','');
 try{
  if(authMode==='up'){const r=await cloud.signUp(email,pass);if(!r.verificationSent)toast('Account created, but the verification email could not be sent. Use “Resend email”.');}
  else await cloud.signIn(email,pass);
  $('au_pass').value='';$('au_pass2').value='';
 }catch(e){setMsg($('au_msg'),cloud.describeAuthError(e),'err');}
 finally{busy=false;$('au_submit').disabled=false;}
}
async function submitReset(ev){
 ev?.preventDefault?.();
 const email=$('rs_email').value.trim();
 if(!EMAIL_OK(email)){setMsg($('rs_msg'),'Enter a valid email address.','err');return;}
 $('rs_submit').disabled=true;
 try{await cloud.requestPasswordReset(email);setMsg($('rs_msg'),'If an account exists for that address, a reset link is on its way. Check your inbox and spam folder.','ok');}
 catch(e){setMsg($('rs_msg'),cloud.describeAuthError(e),'err');}
 finally{$('rs_submit').disabled=false;}
}
async function checkVerified(){
 $('vf_check').disabled=true;setMsg($('vf_msg'),'Checking…','');
 try{const s=await cloud.refreshVerification();if(s.status==='unverified')setMsg($('vf_msg'),'Not verified yet. Open the link in the email we sent, then tap this button again.','err');}
 catch(e){setMsg($('vf_msg'),cloud.describeAuthError(e),'err');}
 finally{$('vf_check').disabled=false;}
}
async function resendVerification(){
 $('vf_resend').disabled=true;
 try{await cloud.resendVerification();setMsg($('vf_msg'),'Verification email sent again. It may take a minute.','ok');startResendCooldown(60);}
 catch(e){setMsg($('vf_msg'),e?.code==='cooldown'?e.message:cloud.describeAuthError(e),'err');if(e?.code==='cooldown')startResendCooldown(60);else $('vf_resend').disabled=false;}
}
function startResendCooldown(sec){
 clearInterval(resendTimer);let left=sec;const b=$('vf_resend');b.disabled=true;b.textContent='Resend in '+left+'s';
 resendTimer=setInterval(()=>{left--;if(left<=0){clearInterval(resendTimer);b.disabled=false;b.textContent='Resend email';}else b.textContent='Resend in '+left+'s';},1000);
}
async function signOutNow(){
 if(dirty&&!confirm('You have unsaved changes. Sign out anyway?'))return;
 dirty=false;
 try{await cloud.signOut();}catch(e){toast('Could not sign out. Try again.');}
}

/* ---------- details & clients ---------- */
function showDetails(){fillFields(fromFields,'f_',state.from);dirty=false;go('details');}
async function saveDetails(){
 const v=Core.validateSender(formValues(fromFields,'f_'));
 if(v.error){toast(v.error);return;}
 const ok=await perform($('f_save'),w=>w.saveSender(v.value,state.senderToken));
 if(ok){dirty=false;toast('Details saved');back();}
}
function renderClients(){
 const box=$('clientList');box.innerHTML='';
 $('clientCount').textContent=state.clients.length+' '+(state.clients.length===1?'client':'clients');
 if(!state.clients.length){box.innerHTML='<p class="empty">No clients yet. Tap + to add one.</p>';return;}
 state.clients.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(c=>{
  const button=document.createElement('button');button.className='item clientrow';
  button.innerHTML='<span class="ix">'+esc(c.name.slice(0,1).toUpperCase())+'</span><span class="id"><span class="in">'+esc(c.name)+'</span><span class="isub">'+esc(c.addr.replace(/\n/g,', '))+'</span></span><span class="chevron">›</span>';
  button.onclick=()=>openClient(c.id);box.appendChild(button);
 });
}
function openClient(clientId){
 const c=state.clients.find(x=>x.id===clientId);if(!c)return;
 viewingClient=clientId;
 $('clientDetail').innerHTML='<h2>'+esc(c.name)+'</h2><dl class="details-list"><dt>Address</dt><dd>'+esc(c.addr).replace(/\n/g,'<br>')+'</dd><dt>PAN</dt><dd>'+esc(c.pan||'—')+'</dd><dt>GSTIN</dt><dd>'+esc(c.gstin||'—')+'</dd></dl>';
 go('client');
}
function openClientEditor(clientId=null){
 editingClient=clientId;
 const c=state.clients.find(x=>x.id===clientId)||{name:'',addr:'',pan:'',gstin:''};
 fillFields(clientFields,'ce_',c);
 $('ce_title').textContent=clientId?'Edit Client':'Add Client';
 $('ce_save').textContent=clientId?'Save Changes':'Add Client';
 $('ce_delete').hidden=!clientId;
 dirty=false;
 go('client-edit');
}
async function saveClient(){
 const v=Core.validateClient(formValues(clientFields,'ce_'));
 if(v.error){toast(v.error);return;}
 const token=editingClient?state.clients.find(x=>x.id===editingClient)?.updateToken:undefined;
 const ok=await perform($('ce_save'),w=>w.saveClient(v.value,editingClient,token));
 if(ok){dirty=false;history=['home'];show('clients');paintView();toast('Client saved');}
}
async function deleteClient(){
 if(!editingClient)return;
 if(!confirm('Remove this client? Existing invoices will remain unchanged.'))return;
 const target=editingClient;
 const ok=await perform($('ce_delete'),w=>w.deleteClient(target));
 if(ok){dirty=false;history=['home'];editingClient=null;show('clients');paintView();toast('Client removed');}
}

/* ---------- invoices ---------- */
function invoiceStatus(inv){return Core.STATUSES.includes(inv?.status)?inv.status:'issued';}
function renderInvoices(){
 const box=$('iblist');box.innerHTML='';
 $('ibcount').textContent=state.invoices.length+' '+(state.invoices.length===1?'invoice':'invoices');
 if(!state.invoices.length){box.className='ibempty';box.innerHTML='<div class="big">No invoices yet</div><div class="sub">Tap + to create your first invoice.</div>';return;}
 box.className='iblist';
 state.invoices.forEach(inv=>{
  const b=document.createElement('button');b.className='inv';
  b.innerHTML='<span class="num">'+esc(inv.no||'Draft')+'</span><span class="cn">'+esc(inv.client?.name||'Client')+'</span><span class="amt">'+esc(money(inv.totalPaise??inv.amountPaise))+'</span>';
  b.onclick=()=>showInvoice(inv.id);box.appendChild(b);
 });
}
function fillClients(selected){
 const s=$('g_client');s.replaceChildren();
 if(!state.clients.length){
  const o=document.createElement('option');o.textContent='Add a client first';o.value='';s.appendChild(o);
  $('g_go').disabled=true;return;
 }
 for(const c of state.clients){const o=document.createElement('option');o.value=c.id;o.textContent=c.name;s.appendChild(o);}
 $('g_go').disabled=false;if(selected&&state.clients.some(c=>c.id===selected))s.value=selected;
}
function openInvoiceEditor(invoiceId=null){
 const inv=state.invoices.find(x=>x.id===invoiceId);
 if(inv && invoiceStatus(inv)!=='draft'){toast('Issued invoices cannot be edited');return;}
 editingInvoice=invoiceId;
 fillClients(inv?.clientId);
 $('g_reg').value=inv?.reg||'';
 $('g_amt').value=inv?(inv.amountPaise/100).toFixed(2):'';
 $('g_date').value=inv?.date||today();
 $('g_tax').value=String(inv?.taxRate??0);
 $('g_heading').textContent=inv?'Edit draft':'New invoice';
 $('g_go').textContent=inv?'Save draft':'Create draft';
 dirty=false;go('generate');
}
async function submitInvoice(){
 if(!state.from.name||!state.from.addr){toast('Add Your Details before creating an invoice');return;}
 const client=state.clients.find(c=>c.id===$('g_client').value);
 if(!client){toast('Select a client');return;}
 const v=Core.validateInvoiceInput({amount:$('g_amt').value,reg:$('g_reg').value,date:$('g_date').value,taxRate:$('g_tax').value,clientId:client.id});
 if(v.error){toast(v.error);return;}
 if(v.value.taxRate>0&&!confirm('Confirm you are entitled to charge GST at the selected rate. The app does not determine your GST obligations.'))return;
 const old=state.invoices.find(x=>x.id===editingInvoice);
 if(old && invoiceStatus(old)!=='draft'){toast('Issued invoices cannot be edited. Duplicate to make a correction.');return;}
 let savedId=null;
 const ok=await perform($('g_go'),async w=>{savedId=await w.saveDraft(old?.id||null,v.value,client,state.from,old?.updateToken);});
 if(ok){dirty=false;editingInvoice=null;history=['home'];viewingInvoice=savedId;pendingInvoice=savedId;show('invoice');paintView();toast('Draft saved. Issue it when it is ready.');}
}
const ONES=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
const TENS=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
function below1000(n){const h=Math.floor(n/100),r=n%100;return (h?ONES[h]+' Hundred'+(r?' ':''):'')+(r?(r<20?ONES[r]:TENS[Math.floor(r/10)]+(r%10?' '+ONES[r%10]:'')):'');}
function words(n){
 if(n===0)return 'Zero';
 let parts=[];for(const [v,label] of [[10000000,'Crore'],[100000,'Lakh'],[1000,'Thousand'],[1,'']]){
  const count=Math.floor(n/v);n%=v;
  if(count)parts.push((count<1000?below1000(count):words(count))+(label?' '+label:''));
 }return parts.join(' ');
}
function amountWords(paise){const rupees=Math.floor(paise/100),p=paise%100;return 'Rupees '+words(rupees)+(p?' and '+words(p)+' Paise':'')+' Only';}
async function updateInvoiceStatus(status){
 const inv=state.invoices.find(x=>x.id===viewingInvoice);
 if(!inv)return;
 const old=invoiceStatus(inv);
 if(!Core.canTransition(old,status)){toast('This status change is not allowed');return;}
 const message=status==='issued'?'Issue this invoice? It will get its invoice number, and after issuing its details cannot be edited.':status==='paid'?'Mark this invoice as paid?':'Void this invoice? Its original record will remain for your records.';
 if(!confirm(message))return;
 let result=null;
 const ok=await perform(null,async w=>{result=status==='issued'?await w.issue(inv.id,inv.updateToken):await w.setStatus(inv.id,status,inv.updateToken);});
 if(ok)toast(status==='issued'?'Invoice '+result.number+' issued':'Invoice marked '+status);
}
async function deleteDraft(){
 const inv=state.invoices.find(x=>x.id===viewingInvoice);
 if(!inv||invoiceStatus(inv)!=='draft')return;
 if(!confirm('Delete this draft? This cannot be undone.'))return;
 const target=inv.id;
 const ok=await perform($('deleteInv'),w=>w.deleteDraft(target));
 if(ok){viewingInvoice=null;history=[];show('home');paintView();toast('Draft deleted');}
}
function duplicateInvoice(){
 const inv=state.invoices.find(x=>x.id===viewingInvoice);
 if(!inv)return;
 editingInvoice=null;
 fillClients(inv.clientId);
 $('g_reg').value=inv.reg||'';
 $('g_amt').value=(inv.amountPaise/100).toFixed(2);
 $('g_date').value=today();
 $('g_tax').value=String(inv.taxRate??0);
 $('g_heading').textContent='Duplicate invoice';
 $('g_go').textContent='Create draft';
 dirty=false;go('generate');
}
function showInvoice(invoiceId){viewingInvoice=invoiceId;go('invoice');}
function renderInvoice(invoiceId){
 const inv=state.invoices.find(x=>x.id===invoiceId);
 if(!inv){$('paper').innerHTML='<div class="p-title">Loading…</div>';return;}
 const f=inv.from||blankFrom(),c=inv.client||{},subtotal=inv.amountPaise||0,tax=inv.taxPaise||0,total=inv.totalPaise??subtotal;
 const status=invoiceStatus(inv);
 $('invoiceStatus').textContent=status.charAt(0).toUpperCase()+status.slice(1);
 $('editInv').hidden=status!=='draft';
 $('issueInv').hidden=status!=='draft';
 $('deleteInv').hidden=status!=='draft';
 $('paidInv').hidden=status!=='issued';
 $('voidInv').hidden=status!=='issued';
 const ctax=(c.pan?'<div><span class="k">PAN </span>'+esc(c.pan)+'</div>':'')+(c.gstin?'<div><span class="k">GSTIN </span>'+esc(c.gstin)+'</div>':'');
 $('paper').innerHTML=
 '<div class="p-top"></div><div class="p-title">Invoice'+(status==='draft'?' — Draft':status==='void'?' — Void':'')+'</div>'+
 '<div class="p-meta"><div><div class="p-ek">Invoice No.</div><div class="p-ev">'+(inv.no?esc(inv.no):'Assigned when issued')+'</div></div><div><div class="p-ek">Invoice Date</div><div class="p-ev">'+dateLabel(inv.date)+'</div></div></div>'+
 '<div class="p-parties"><div><div class="p-lbl">From</div><div class="p-nm">'+esc(f.name)+'</div><div class="p-ad">'+esc(f.addr)+'</div>'+(f.pan?'<div class="p-tax">PAN '+esc(f.pan)+'</div>':'')+'</div>'+
 '<div><div class="p-lbl">Invoice To</div><div class="p-nm">'+esc(c.name)+'</div><div class="p-ad">'+esc(c.addr)+'</div><div class="p-tax">'+ctax+'</div></div></div>'+
 '<table class="p-items"><thead><tr><th>S.No</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody><tr><td>01</td><td class="desc">'+esc(inv.reg)+'</td><td class="r">'+money(subtotal)+'</td></tr></tbody></table>'+
 '<div class="p-spacer"></div><div class="p-tot"><div class="box"><div class="p-trow"><span>Subtotal</span><span>'+money(subtotal)+'</span></div><div class="p-trow line"><span>GST ('+(inv.taxRate||0)+'%)</span><span>'+money(tax)+'</span></div><div class="p-grand"><span class="gl">Grand Total</span><span class="gv">'+money(total)+'</span></div></div></div>'+
 '<div class="p-words"><div class="wk">Amount in words</div><div class="wv">'+amountWords(total)+'</div></div>'+
 '<div class="p-bank"><div class="bl">Bank Details for NEFT / RTGS</div><div class="p-bgrid">'+
 '<span class="k">Name</span><span class="v">'+esc(f.name)+'</span><span class="k">Account No.</span><span class="v">'+esc(f.acc)+'</span>'+
 '<span class="k">Bank</span><span class="v">'+esc(f.bank)+'</span><span class="k">Branch</span><span class="v">'+esc(f.branch)+'</span>'+
 '<span class="k">Type</span><span class="v">'+esc(f.type)+'</span><span class="k">IFSC</span><span class="v">'+esc(f.ifsc)+'</span></div></div>';
 requestAnimationFrame(scalePaper);
}
function scalePaper(){
 if($('v-invoice').hidden)return;
 const paper=$('paper'),stage=$('stage');
 const s=Math.min(1,stage.clientWidth/794);
 paper.style.transform='scale('+s+')';
 stage.style.height=(1123*s)+'px';
}
function copyInvoice(){
 const inv=state.invoices.find(x=>x.id===viewingInvoice);if(!inv)return;
 const f=inv.from,c=inv.client;
 const txt=['INVOICE '+(inv.no||'(draft)'),'Date: '+dateLabel(inv.date),'','From:',f.name,f.addr,'PAN: '+(f.pan||'—'),'','To:',c.name,c.addr,'',inv.reg,'Subtotal: '+money(inv.amountPaise),'GST ('+inv.taxRate+'%): '+money(inv.taxPaise),'Total: '+money(inv.totalPaise),amountWords(inv.totalPaise),'','Bank: '+f.bank,'Account: '+f.acc,'IFSC: '+f.ifsc].join('\n');
 if(navigator.clipboard?.writeText)navigator.clipboard.writeText(txt).then(()=>toast('Copied'),()=>toast('Copy unavailable'));
 else toast('Clipboard requires a secure connection');
}
function download(name,text){
 const blob=new Blob([text],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function exportBackup(){
 download('invoice-studio-backup-'+today()+'.json',JSON.stringify({version:3,exportedAt:new Date().toISOString(),from:state.from,clients:state.clients.map(({updateToken,...c})=>c),invoices:state.invoices.map(({updateToken,...i})=>i)},null,2));
 toast('Backup downloaded');
}

/* ---------- migration of the pre-account browser copy: preview, validate, back up. No writes. ---------- */
function readLegacy(){
 try{const raw=globalThis.localStorage?.getItem(LEGACY_KEY);return raw?JSON.parse(raw):null;}catch(e){return undefined;}
}
function openMigrate(){
 const legacy=readLegacy();const box=$('mg_report');box.innerHTML='';
 if(legacy===undefined){box.innerHTML='<p class="msg err">The browser data could not be read. It has not been changed.</p>';migrationPlan=null;}
 else if(!legacy){box.innerHTML='<p class="empty">No browser data found.</p>';migrationPlan=null;}
 else{
  migrationPlan=Core.planMigration(legacy,{existing:{clients:state.clients,invoices:state.invoices,lastSequence:state.counter},now:new Date().toISOString()});
  const s=migrationPlan.summary;
  const li=a=>a.map(x=>'<li>'+esc(x)+'</li>').join('');
  box.innerHTML=(s?'<ul class="mg-sum"><li><b>'+s.invoices+'</b> invoices ('+s.skippedInvoices+' already in this account)</li><li><b>'+s.clients+'</b> clients ('+s.skippedClients+' already in this account)</li><li>Highest historical number: <b>'+s.highestHistoricalSequence+'</b>; new invoices would continue from <b>'+s.nextSequenceAfterImport+'</b></li></ul>':'')+
   (migrationPlan.errors.length?'<p class="msg err">Fix these before importing:</p><ul>'+li(migrationPlan.errors.slice(0,20))+'</ul>':'<p class="msg ok">Validation passed.</p>')+
   (migrationPlan.warnings.length?'<p class="subhead">Notes</p><ul>'+li(migrationPlan.warnings.slice(0,20))+'</ul>':'')+
   '<p class="subhead">Rollback plan</p><p class="note">'+esc(migrationPlan.rollback.note)+' '+migrationPlan.rollback.deletes.length+' documents would be tagged '+esc(migrationPlan.rollback.batchId)+'.</p>';
 }
 $('mg_backup').disabled=!migrationPlan?.backup;
 $('mg_import').disabled=true;
 $('mg_note').textContent='This data belongs to this browser, not to your account, and it is shown to whoever is signed in here. Importing is not enabled in this version. Download the backup now; a later release will add the confirmed import once its security rules are approved. Your browser copy is never deleted by this app.';
 go('migrate');
}

/* ---------- wiring ---------- */
function bind(){
 for(const l of document.querySelectorAll('.f > label:not([for])')){const c=l.parentElement?.querySelector?.('input,select,textarea');if(c?.id)l.setAttribute('for',c.id);}
 window.addEventListener('resize',scalePaper);
 window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 // A page restored from the back/forward cache could show a previous session's data: reload so auth is re-evaluated.
 window.addEventListener('pageshow',e=>{if(e.persisted){try{globalThis.location?.reload?.();}catch(_){}}});
 window.addEventListener('online',renderSync);window.addEventListener('offline',renderSync);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&view==='verify'&&cloud&&!busy)checkVerified();});
 $('fab').onclick=()=>openInvoiceEditor();
 $('navDetails').onclick=showDetails;
 $('navClients').onclick=()=>go('clients');
 $('setDetails').onclick=showDetails;
 $('setClients').onclick=()=>go('clients');
 $('f_save').onclick=saveDetails;
 $('addClient').onclick=()=>openClientEditor();
 $('viewEditClient').onclick=()=>openClientEditor(viewingClient);
 $('ce_save').onclick=saveClient;
 $('ce_cancel').onclick=back;
 $('ce_delete').onclick=deleteClient;
 $('g_go').onclick=submitInvoice;
 $('newInv').onclick=()=>openInvoiceEditor();
 $('editInv').onclick=()=>openInvoiceEditor(viewingInvoice);
 $('issueInv').onclick=()=>updateInvoiceStatus('issued');
 $('paidInv').onclick=()=>updateInvoiceStatus('paid');
 $('voidInv').onclick=()=>updateInvoiceStatus('void');
 $('deleteInv').onclick=deleteDraft;
 $('duplicateInv').onclick=duplicateInvoice;
 $('dl').onclick=async()=>{
  const inv=state.invoices.find(x=>x.id===viewingInvoice);if(!inv)return;
  $('dl').disabled=true;
  try{await window.InvoicePDF.download(inv,{money,dateLabel,amountWords,invoiceStatus});toast('PDF downloaded');}
  catch(e){console.error('PDF download failed',e);toast('PDF unavailable. Use Print / Save as PDF.');}
  finally{$('dl').disabled=false;}
 };
 $('printInv').onclick=()=>{
  const t=document.title,inv=state.invoices.find(x=>x.id===viewingInvoice);
  document.title=inv?.no||'Invoice';window.print();setTimeout(()=>document.title=t,1000);
 };
 $('copy').onclick=copyInvoice;
 $('exportBackup').onclick=exportBackup;
 $('openMigrate').onclick=openMigrate;
 $('mg_backup').onclick=()=>{if(migrationPlan?.backup){download(migrationPlan.backup.fileName,migrationPlan.backup.body);toast('Backup downloaded (checksum '+migrationPlan.backup.checksum+')');}};
 $('signOut').onclick=signOutNow;
 $('au_tab_in').onclick=()=>setAuthMode('in');
 $('au_tab_up').onclick=()=>setAuthMode('up');
 $('au_form').addEventListener('submit',submitAuth);
 $('au_forgot').onclick=()=>{$('rs_email').value=$('au_email').value.trim();setMsg($('rs_msg'),'');show('reset');};
 $('rs_form').addEventListener('submit',submitReset);
 $('rs_back').onclick=()=>{setAuthMode('in');show('welcome');};
 $('vf_check').onclick=checkVerified;
 $('vf_resend').onclick=resendVerification;
 $('vf_out').onclick=signOutNow;
 $('ld_retry').onclick=()=>{sessionUid=null;showLoading('Opening Invoice Studio…','Checking your sign-in.');cloud.refreshVerification().then(r=>{if(r?.status==='signedOut')onSession(r);}).catch(e=>showLoading('Could not confirm your session',cloud.describeAuthError(e),{retry:true}));};
 $('ld_out').onclick=signOutNow;
 wireDirty('v-details');wireDirty('v-client-edit');wireDirty('v-generate');
 document.addEventListener('pointerdown',e=>{
  if(e.target?.closest?.('input,textarea,select,button,a,label'))return;
  if(document.activeElement?.matches?.('input,textarea,select'))document.activeElement.blur();
 });
}
let bound=false;
function start(c,opts={}){
 cloud=c;
 if(!bound){bind();bound=true;}
 if(opts.emulator){const b=$('netBanner');b.dataset.emulator='1';document.title='[EMULATOR] '+document.title;}
 showLoading('Opening Invoice Studio…','Checking your sign-in.');
 cloud.onSession(onSession);
}
function fatal(message){showLoading('Invoice Studio could not start',message);}
window.InvoiceApp={start,fatal};
