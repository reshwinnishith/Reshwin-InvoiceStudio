/* PDF generation: pinned jsPDF, loaded only when requested.
   No data is sent to a PDF service: document rendering happens locally in the browser. */
(function(){
 'use strict';
 let loading;
 function ensurePdf(){
  if(window.jspdf?.jsPDF)return Promise.resolve(window.jspdf.jsPDF);
  if(!loading)loading=new Promise((resolve,reject)=>{
   const tag=document.createElement('script');
   tag.src='https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js';
   // Subresource Integrity: the browser refuses the file if the CDN copy differs from the audited jsPDF 4.2.1 build.
   tag.integrity='sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3';
   tag.crossOrigin='anonymous';
   tag.onload=()=>window.jspdf?.jsPDF?resolve(window.jspdf.jsPDF):reject(Error('PDF library unavailable'));
   tag.onerror=()=>reject(Error('Could not load PDF library'));
   document.head.appendChild(tag);
  }).catch(e=>{loading=null;throw e;});
  return loading;
 }
 function safe(s){return String(s??'').replace(/[^\x20-\x7E\n]/g,ch=>ch==='₹'?'INR ':ch==='–'||ch==='—'?'-':ch==='’'?"'":' ');}
 async function download(inv,utils){
  const PDF=await ensurePdf();
  const doc=new PDF({orientation:'portrait',unit:'mm',format:'a4',compress:true});
  const width=210,left=20,right=190,bottom=277;
  let y=22,page=1;
  const line=(x1,yy,x2)=>{doc.setDrawColor(220,216,207);doc.line(x1,yy,x2,yy);};
  function pageBreak(required){
   if(y+required<=bottom)return;
   footer();doc.addPage();page++;
   y=22;doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(110,100,95);
   doc.text((inv.no?safe(inv.no):'Draft invoice')+' (continued)',left,y);y+=12;
  }
  function footer(){
   doc.setFontSize(8);doc.setFont('helvetica','normal');doc.setTextColor(125,125,125);
   doc.text('Page '+page,190,288,{align:'right'});
  }
  function write(label,value,options={}){
   const size=options.size||10;
   const maxWidth=options.width||170;
   const lines=doc.splitTextToSize(safe(value||'-'),maxWidth);
   pageBreak(15);
   doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(135,103,48);
   doc.text(label.toUpperCase(),left,y);y+=5;
   doc.setFont('helvetica','normal');doc.setFontSize(size);doc.setTextColor(28,26,24);
   const advance=size*0.44+1;
   for(const row of lines){
    pageBreak(advance+2);
    doc.text(row,left,y);y+=advance;
   }
   y+=5;
  }
  doc.setFillColor(124,29,43);doc.rect(0,0,210,5,'F');
  doc.setFillColor(168,132,47);doc.rect(0,5,210,1.5,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(27);doc.setTextColor(124,29,43);
  doc.text('INVOICE',left,y);y+=13;
  doc.setFontSize(10);doc.setTextColor(75,68,62);
  doc.text('Invoice number: '+(inv.no?safe(inv.no):'Assigned when issued'),left,y);
  doc.text('Date: '+safe(utils.dateLabel(inv.date)),right,y,{align:'right'});y+=8;
  const status=utils.invoiceStatus(inv);
  if(status==='draft'||status==='void'){
   doc.setTextColor(160,40,50);doc.setFontSize(9);
   doc.text(status==='draft'?'DRAFT — NOT ISSUED':'VOID — NOT PAYABLE',left,y);y+=7;
  }
  line(left,y,right);y+=11;
  const from=inv.from||{},client=inv.client||{};
  write('From',[from.name,from.addr,from.pan?'PAN: '+from.pan:''].filter(Boolean).join('\n'));
  write('Bill to',[client.name,client.addr,client.pan?'PAN: '+client.pan:'',client.gstin?'GSTIN: '+client.gstin:''].filter(Boolean).join('\n'));
  line(left,y,right);y+=10;
  write('Description of services',inv.reg,{size:11});
  pageBreak(40);
  const amount=utils.money(inv.amountPaise||0).replace('₹','INR ');
  const gst=utils.money(inv.taxPaise||0).replace('₹','INR ');
  const total=utils.money(inv.totalPaise??inv.amountPaise).replace('₹','INR ');
  doc.setFontSize(10);doc.setFont('helvetica','normal');doc.setTextColor(60,60,60);
  doc.text('Subtotal',left,y);doc.text(amount,right,y,{align:'right'});y+=8;
  doc.text('GST ('+Number(inv.taxRate||0)+'%)',left,y);doc.text(gst,right,y,{align:'right'});y+=6;
  line(left,y,right);y+=9;
  doc.setFont('helvetica','bold');doc.setFontSize(14);doc.setTextColor(124,29,43);
  doc.text('Total',left,y);doc.text(total,right,y,{align:'right'});y+=12;
  write('Amount in words',utils.amountWords(inv.totalPaise??inv.amountPaise));
  write('Payment details',[from.bank,from.branch,from.acc?'Account number: '+from.acc:'',from.type?'Account type: '+from.type:'',from.ifsc?'IFSC: '+from.ifsc:''].filter(Boolean).join('\n'));
  footer();
  doc.save(safe(inv.no).replace(/[^A-Za-z0-9_-]/g,'_')+'.pdf');
 }
 window.InvoicePDF={download};
})();
