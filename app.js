'use strict';
/* Reshwin Invoice Studio — local-first, no accounts or external data transfers. */
const STORAGE_KEY = 'reshwin-invoice-studio-v2';
const ISSUED_STATUSES = ['issued','paid','void'];
const $ = id => document.getElementById(id);
const today = () => { const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const blankFrom = () => ({name:'',addr:'',pan:'',type:'',bank:'',branch:'',acc:'',ifsc:''});
const newState = () => ({from:blankFrom(),clients:[],invoices:[],seq:1});
let state=newState(), view='home', history=[], editingClient=null, viewingClient=null, editingInvoice=null, viewingInvoice=null, dirty=false, storageOK=true;
const VIEWS=['home','generate','invoice','details','clients','client','client-edit','settings'];
const GEAR='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"/></svg>';
const ARROW='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>';
const TITLES={generate:'Invoice editor',invoice:'Invoice',details:'Your Details',clients:'Clients',client:'Client Details','client-edit':'Edit Client',settings:'Settings'};
const id = () => (globalThis.crypto?.randomUUID?.() || ('id-'+Date.now()+'-'+Math.random().toString(36).slice(2)));
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function toast(msg){const e=$('toast');e.textContent=msg;e.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>e.classList.remove('show'),2500);}
function load(){
 try{
   const raw=localStorage.getItem(STORAGE_KEY);
   if(!raw)return;
   const data=JSON.parse(raw);
   if(!data || !Array.isArray(data.clients) || !Array.isArray(data.invoices)) throw Error('Invalid saved data');
   state={from:{...blankFrom(),...(data.from||{})},clients:data.clients,invoices:data.invoices,seq:Math.max(1,Number(data.seq)||1)};
   // Never reuse a number even after deletions or restoring older data.
   const greatest=state.invoices.reduce((m,x)=>Math.max(m,Number(String(x.no||'').match(/-(\d+)$/)?.[1])||0),0);
   state.seq=Math.max(state.seq,greatest+1);
 }catch(e){storageOK=false;toast('Saved data could not be loaded; original browser data was not changed.');}
}
function save(){
 if(!storageOK)return false;
 try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));return true;}
 catch(e){storageOK=false;toast('Storage unavailable. Export a backup before closing.');return false;}
}
function checkLeave(){
 if(!dirty)return true;
 if(!confirm('Discard your unsaved changes?'))return false;
 dirty=false;return true;
}
function go(next,{replace=false}={}){
 if(!VIEWS.includes(next)||!checkLeave())return;
 if(next!==view){if(!replace)history.push(view);view=next;}
 VIEWS.forEach(v=>{$('v-'+v).hidden=v!==view});
 renderBar();
 if(view==='home')renderInvoices();
 if(view==='clients')renderClients();
 if(view==='invoice'){renderInvoice(viewingInvoice);requestAnimationFrame(scalePaper);}
 window.scrollTo(0,0);
}
function back(){
 if(!checkLeave())return;
 let previous=history.pop()||'home';
 view=previous;VIEWS.forEach(v=>{$('v-'+v).hidden=v!==view});renderBar();
 if(view==='home')renderInvoices();
 if(view==='clients')renderClients();
 if(view==='invoice')renderInvoice(viewingInvoice);
 window.scrollTo(0,0);
}
function renderBar(){
 const bar=$('bar');
 if(view==='home'){
   bar.innerHTML='<span class="mark"></span><span class="brandtext"><span class="t">Reshwin Invoice Studio</span><span class="s">Simple invoicing</span></span><span class="spacer"></span><button class="iconbtn" id="setBtn" aria-label="Settings">'+GEAR+'</button>';
   $('setBtn').onclick=()=>go('settings');
 }else{
   bar.innerHTML='<button class="iconbtn back" id="backBtn" aria-label="Back">'+ARROW+'</button><span class="bartitle">'+TITLES[view]+'</span>';
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
function showDetails(){fillFields(fromFields,'f_',state.from);dirty=false;go('details');}
function saveDetails(){
 const f=formValues(fromFields,'f_');
 if(!f.name||!f.addr){toast('Enter your name and address');return;}
 if(f.pan&&!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(f.pan.toUpperCase())){toast('Check the PAN format');return;}
 f.pan=f.pan.toUpperCase();
 if(f.ifsc&&!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(f.ifsc.toUpperCase())){toast('Check IFSC format');return;}
 f.ifsc=f.ifsc.toUpperCase();
 if(f.acc&&!/^\d{6,20}$/.test(f.acc)){toast('Check bank account number');return;}
 state.from=f;if(!save())return;dirty=false;toast('Details saved');back();
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
function saveClient(){
 const c=formValues(clientFields,'ce_');
 if(!c.name){toast('Enter a client name');return;}
 c.pan=c.pan.toUpperCase();c.gstin=c.gstin.toUpperCase();
 if(c.pan&&!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(c.pan)){toast('Check client PAN');return;}
 if(c.gstin&&!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(c.gstin)){toast('Check GSTIN');return;}
 if(c.pan&&c.gstin&&c.gstin.slice(2,12)!==c.pan){toast('Client GSTIN must match client PAN');return;}
 if(editingClient){const i=state.clients.findIndex(x=>x.id===editingClient);if(i<0)return;state.clients[i]={...state.clients[i],...c};}
 else {editingClient=id();state.clients.push({id:editingClient,...c});}
 if(!save())return;dirty=false;
 history=['home'];
 view='clients';VIEWS.forEach(v=>{$('v-'+v).hidden=v!==view});renderBar();renderClients();window.scrollTo(0,0);toast('Client saved');
}
function deleteClient(){
 const i=state.clients.findIndex(x=>x.id===editingClient);if(i<0)return;
 if(!confirm('Remove this client? Existing invoices will remain unchanged.'))return;
 state.clients.splice(i,1);if(!save())return;dirty=false;history=[];
 go('clients',{replace:true});toast('Client removed');
}
function renderInvoices(){
 const box=$('iblist');box.innerHTML='';
 $('ibcount').textContent=state.invoices.length+' '+(state.invoices.length===1?'invoice':'invoices');
 if(!state.invoices.length){box.className='ibempty';box.innerHTML='<div class="big">No invoices yet</div><div class="sub">Tap + to create your first invoice.</div>';return;}
 box.className='iblist';
 state.invoices.forEach(inv=>{
  const b=document.createElement('button');b.className='inv';
  b.innerHTML='<span class="num">'+esc(inv.no)+'</span><span class="cn">'+esc(inv.client?.name||'Client')+'</span><span class="amt">'+esc(money(inv.totalPaise??inv.amountPaise))+'</span>';
  b.onclick=()=>showInvoice(inv.id);box.appendChild(b);
 });
}
function money(paise){return '₹'+(Number(paise||0)/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});}
function parseAmount(s){
 if(!/^\d+(?:\.\d{1,2})?$/.test(s.trim()))return null;
 const n=Number(s);if(!Number.isFinite(n)||n<=0||n>100000000)return null;
 return Math.round(n*100);
}
function dateLabel(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '—';const [y,m,d]=s.split('-').map(Number);const dt=new Date(y,m-1,d);if(dt.getFullYear()!==y||dt.getMonth()!==m-1||dt.getDate()!==d)return '—';return dt.toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'});}
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
 $('g_heading').textContent=inv?'Edit invoice':'New invoice';
 $('g_go').textContent=inv?'Save invoice':'Generate invoice';
 dirty=false;go('generate');
}
function submitInvoice(){
 if(!state.from.name||!state.from.addr){toast('Add Your Details before creating an invoice');return;}
 const client=state.clients.find(c=>c.id===$('g_client').value);
 if(!client){toast('Select a client');return;}
 const amountPaise=parseAmount($('g_amt').value);
 if(amountPaise===null){toast('Enter an amount with up to 2 decimal places');return;}
 const reg=$('g_reg').value.trim();
 if(!reg){toast('Describe the work');return;}
 const date=$('g_date').value;if(dateLabel(date)==='—'){toast('Choose a valid invoice date');return;}
 const taxRate=Number($('g_tax').value);
 if(![0,5,12,18,28].includes(taxRate)){toast('Choose a valid tax rate');return;}
 const taxPaise=Math.round(amountPaise*taxRate/100);
 if(taxRate>0&&!confirm('Confirm you are entitled to charge GST at the selected rate. The app does not determine your GST obligations.'))return;
 const old=state.invoices.find(x=>x.id===editingInvoice);
 if(old && invoiceStatus(old)!=='draft'){toast('Issued invoices cannot be edited. Duplicate to make a correction.');return;}
 const number=old?.no||('RESH-'+date.slice(0,4)+'-'+String(state.seq).padStart(3,'0'));
 const inv={id:old?.id||id(),no:number,date,clientId:client.id,client:{...client},from:{...state.from},reg,amountPaise,taxRate,taxPaise,totalPaise:amountPaise+taxPaise,status:'draft',createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
 if(old){state.invoices[state.invoices.indexOf(old)]=inv;}else{state.invoices.unshift(inv);state.seq++;}
 if(!save())return;
 dirty=false;editingInvoice=null;history=['home'];viewingInvoice=inv.id;go('invoice',{replace:true});toast('Invoice saved');
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
function invoiceStatus(inv){return ['draft','issued','paid','void'].includes(inv?.status)?inv.status:'issued';}
function updateInvoiceStatus(status){
 const inv=state.invoices.find(x=>x.id===viewingInvoice);
 if(!inv)return;
 const old=invoiceStatus(inv);
 const valid={draft:['issued'],issued:['paid','void'],paid:[],void:[]};
 if(!valid[old].includes(status)){toast('This status change is not allowed');return;}
 const message=status==='issued'?'Issue this invoice? After issuing it, its details cannot be edited.':status==='paid'?'Mark this invoice as paid?':'Void this invoice? Its original record will remain for your records.';
 if(!confirm(message))return;
 const previous={...inv};
 inv.status=status;inv.updatedAt=new Date().toISOString();
 if(status==='issued')inv.issuedAt=inv.updatedAt;
 if(status==='paid')inv.paidAt=inv.updatedAt;
 if(status==='void')inv.voidedAt=inv.updatedAt;
 if(!save()){Object.assign(inv,previous);return;}
 renderInvoice(inv.id);toast('Invoice marked '+status);
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
function showInvoice(invoiceId){
 viewingInvoice=invoiceId;go('invoice');
}
function renderInvoice(invoiceId){
 const inv=state.invoices.find(x=>x.id===invoiceId);
 if(!inv)return;
 const f=inv.from||blankFrom(),c=inv.client||{},subtotal=inv.amountPaise||0,tax=inv.taxPaise||0,total=inv.totalPaise??subtotal;
 const status=invoiceStatus(inv);
 $('invoiceStatus').textContent=status.charAt(0).toUpperCase()+status.slice(1);
 $('editInv').hidden=status!=='draft';
 $('issueInv').hidden=status!=='draft';
 $('paidInv').hidden=status!=='issued';
 $('voidInv').hidden=status!=='issued';
 const ctax=(c.pan?'<div><span class="k">PAN </span>'+esc(c.pan)+'</div>':'')+(c.gstin?'<div><span class="k">GSTIN </span>'+esc(c.gstin)+'</div>':'');
 $('paper').innerHTML=
 '<div class="p-top"></div><div class="p-title">Invoice'+(status==='draft'?' — Draft':status==='void'?' — Void':'')+'</div>'+
 '<div class="p-meta"><div><div class="p-ek">Invoice No.</div><div class="p-ev">'+esc(inv.no)+'</div></div><div><div class="p-ek">Invoice Date</div><div class="p-ev">'+dateLabel(inv.date)+'</div></div></div>'+
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
 const txt=['INVOICE '+inv.no,'Date: '+dateLabel(inv.date),'','From:',f.name,f.addr,'PAN: '+(f.pan||'—'),'','To:',c.name,c.addr,'',inv.reg,'Subtotal: '+money(inv.amountPaise),'GST ('+inv.taxRate+'%): '+money(inv.taxPaise),'Total: '+money(inv.totalPaise),amountWords(inv.totalPaise),'','Bank: '+f.bank,'Account: '+f.acc,'IFSC: '+f.ifsc].join('\n');
 if(navigator.clipboard?.writeText)navigator.clipboard.writeText(txt).then(()=>toast('Copied'),()=>toast('Copy unavailable'));
 else toast('Clipboard requires a secure connection');
}
function exportBackup(){
 const blob=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),...state},null,2)],{type:'application/json'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='invoice-studio-backup-'+today()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('Backup downloaded');
}
async function importBackup(file){
 if(!file)return;
 try{
  const data=JSON.parse(await file.text());
  if(!Array.isArray(data.clients)||!Array.isArray(data.invoices)||!data.from)throw Error('Invalid backup');
  if(!confirm('Replace all invoices, clients and details in this browser with the backup?'))return;
  const previous=state;state={from:{...blankFrom(),...data.from},clients:data.clients,invoices:data.invoices,seq:Math.max(1,Number(data.seq)||1)};
  state.seq=Math.max(state.seq,state.invoices.reduce((m,x)=>Math.max(m,Number(String(x.no||'').match(/-(\d+)$/)?.[1])||0),0)+1);
  if(!save()){state=previous;return;}
  history=[];go('home',{replace:true});toast('Backup restored');
 }catch(e){toast('Not a valid Invoice Studio backup');}
}
window.addEventListener('resize',scalePaper);
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
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
$('importBackup').onclick=()=>$('backupFile').click();
$('backupFile').onchange=e=>{importBackup(e.target.files?.[0]);e.target.value='';};
wireDirty('v-details');wireDirty('v-client-edit');wireDirty('v-generate');
document.addEventListener('pointerdown',e=>{
 if(e.target?.closest?.('input,textarea,select,button,a,label'))return;
 if(document.activeElement?.matches?.('input,textarea,select'))document.activeElement.blur();
});
load();go('home',{replace:true});
if(!storageOK)toast('Browser storage unavailable. Your changes may not survive refresh.');
