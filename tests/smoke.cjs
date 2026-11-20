const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync('app.js','utf8');
const store=new Map();
function node(id){
 return {id,value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,
  className:'',style:{},classList:{add(){},remove(){}},
  children:[],clientWidth:400,
  focus(){},scrollIntoView(){},appendChild(x){this.children.push(x)},
  replaceChildren(){this.children=[]},
  addEventListener(){},querySelectorAll(){return[]},
  setAttribute(){}};
}
const elements=new Map();
const get=id=>{if(!elements.has(id))elements.set(id,node(id));return elements.get(id);};
const context=vm.createContext({
 console,
 localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
 document:{getElementById:get,createElement:tag=>node(tag),addEventListener(){},title:'test'},
 window:{scrollTo(){},addEventListener(){},print(){}},
 navigator:{},confirm:()=>true,
 requestAnimationFrame:fn=>fn(),setTimeout:()=>1,clearTimeout(){},
 Blob,URL:{createObjectURL:()=>'',revokeObjectURL(){}}
});
vm.runInContext(source,context,{filename:'app.js'});
const run=code=>vm.runInContext(code,context);
assert.equal(run("view"),'home');
assert.equal(run("state.invoices.length"),0);
assert.equal(run("parseAmount('25000.50')"),2500050);
assert.equal(run("parseAmount('25abc')"),null);
assert.equal(run("parseAmount('12.345')"),null);
assert.equal(run("dateLabel('2026-02-30')"),'—');
assert.equal(run("money(2500050)"),'₹25,000.50');
assert.equal(run("amountWords(125075)"),'Rupees One Thousand Two Hundred Fifty and Seventy Five Paise Only');
assert.equal(run("esc('<script>')"),'&lt;script&gt;');
run("state.from={name:'Sender',addr:'Address',pan:'',type:'Savings',bank:'Bank',branch:'Branch',acc:'123',ifsc:'IFSC'};save()");
run("openClientEditor()");
get('ce_name').value='Client A';get('ce_addr').value='Client address';
run("saveClient()");
assert.equal(run("state.clients.length"),1);
const cid=run("state.clients[0].id");
run("openInvoiceEditor()");
get('g_client').value=cid;get('g_reg').value='Performance';get('g_amt').value='25000.50';get('g_date').value='2026-11-20';get('g_tax').value='0';
run("submitInvoice()");
assert.equal(run("state.invoices.length"),1);
assert.equal(run("state.invoices[0].totalPaise"),2500050);
assert.equal(run("state.invoices[0].no"),'RESH-2026-001');
run("state.from.bank='Changed Bank';state.clients[0].name='New Name';save()");
assert.equal(run("state.invoices[0].from.bank"),'Bank');
assert.equal(run("state.invoices[0].client.name"),'Client A');
run("openInvoiceEditor()");
assert.equal(run("state.seq"),2);
assert.ok(store.has('reshwin-invoice-studio-v2'));
run("viewingInvoice=state.invoices[0].id;renderInvoice(viewingInvoice)");
assert.equal(get('invoiceStatus').textContent,'Draft');
run("updateInvoiceStatus('issued')");
assert.equal(run("state.invoices[0].status"),'issued');
assert.equal(get('editInv').hidden,true);
run("openInvoiceEditor(state.invoices[0].id)");
assert.equal(run("editingInvoice"),null);
run("updateInvoiceStatus('paid')");
assert.equal(run("state.invoices[0].status"),'paid');
run("updateInvoiceStatus('void')");
assert.equal(run("state.invoices[0].status"),'paid');
run("duplicateInvoice()");
assert.equal(run("view"),'generate');
assert.equal(get('g_reg').value,'Performance');
assert.equal(run("editingInvoice"),null);

console.log('PASS: calculations, validation, persistence, immutable issued invoices, status flow, and duplication');
