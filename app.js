/* Invert Sheets — offline field app. All data lives on the device (IndexedDB). */
(() => {
"use strict";
const APP_VERSION="1.0.0";
const STRUCTS=[["Catch Basin","306"],["Standard Inlet","339"],["Storm Sewer MH","338"],["Sanitary Sewer MH","337"],["Valve Vault","346"],["Outlet Control Struct","351"],["Manhole","351"],["Cleanout","383"],["Handhole","274"],["Vault (gas/elec/tele)","345"],["Other",""]];
const LIDS=["Closed","Open","Beehive","Bolted"];
const SHAPES=["Round","Rectangle","Square"];
const CONDS=["Excellent","Good","Poor","Collapsed"];
const CONSTR=["Precast Sections","Cast in Place","Concrete Block","Brick","Other"];
const MATS=["RCP","PVC","DIP","CMP","VCP","HDPE","CIP","Brick","Other"];
const SLOTS=[["NW",315],["N",0],["NE",45],["W",270],["E",90],["SW",225],["S",180],["SE",135]];
const PHOTO_TAGS=["Structure","Lid / frame","Interior","Condition / defect","Debris",...SLOTS.map(([k])=>k+" pipe"),"Other"];
const STATUS_LABEL={draft:"Draft",done:"Complete",checked:"Checked"};

const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num=v=>{const n=parseFloat(String(v??"").replace(/[^0-9.\-]/g,""));return isFinite(n)?n:null};
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const rid=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const clean=s=>String(s||"").replace(/[^\w.-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");

/* ---------- storage (IndexedDB) ---------- */
let idbConn=null;
function idb(){return new Promise((res,rej)=>{if(idbConn)return res(idbConn);const r=indexedDB.open("invertSheetsApp",1);
  r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains("sheets"))d.createObjectStore("sheets",{keyPath:"id"});if(!d.objectStoreNames.contains("photos"))d.createObjectStore("photos")};
  r.onsuccess=()=>{idbConn=r.result;res(idbConn)};r.onerror=()=>rej(r.error)})}
function tx(store,mode,fn){return idb().then(d=>new Promise((res,rej)=>{const t=d.transaction(store,mode);const out=fn(t.objectStore(store));t.oncomplete=()=>res(out instanceof IDBRequest?(out.result??null):undefined);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)}))}
const dbAllSheets=()=>tx("sheets","readonly",s=>s.getAll());
const dbPutSheet=sh=>tx("sheets","readwrite",s=>{s.put(JSON.parse(JSON.stringify(sh)))});
const dbDelSheet=id=>tx("sheets","readwrite",s=>{s.delete(id)});
const dbPutPhoto=(k,b)=>tx("photos","readwrite",s=>{s.put(b,k)});
const dbGetPhoto=k=>tx("photos","readonly",s=>s.get(k));
const dbDelPhoto=k=>tx("photos","readwrite",s=>{s.delete(k)});

/* ---------- state ---------- */
let sheets={};
let view={name:"list",id:null,slot:null};
let filter={q:"",job:""};
let nextTag="Structure";
let deferredInstall=null;
const saveTimers=new Map();
const urlCache=new Map();

function blankSheet(from){
  const h=from||{};const now=new Date().toISOString();
  return {id:rid("s_"),project:h.project||"",location:h.location||"",jobNo:h.jobNo||"",clientJobNo:h.clientJobNo||"",
    initials:h.initials||"",date:today(),sheetNo:"",sheetOf:h.sheetOf||"",pointNo:"",rim:"",checkedBy:"",checkedDate:"",
    structure:"",structureOther:"",lid:"",lidText:"",shape:"",shapeDims:"",condition:"",construction:"",constructionOther:"",insideDim:"",
    rimToBottom:"",rimToBottomNote:"",comments:"",pipes:{},photos:[],status:"draft",createdAt:now,updatedAt:now};
}
const statusOf=s=>(s.checkedBy&&s.checkedBy.trim())?"checked":s.status==="done"?"done":"draft";

function update(id,patch,{now=false}={}){
  const s=sheets[id];if(!s)return;
  Object.assign(s,patch,{updatedAt:new Date().toISOString()});
  setSaved("Saving…");
  clearTimeout(saveTimers.get(id));
  const go=()=>dbPutSheet(sheets[id]).then(()=>setSaved("Saved on device")).catch(()=>{setSaved("Not saved");toast("Couldn't save. Device storage may be full.")});
  if(now)go();else saveTimers.set(id,setTimeout(go,350));
}
function flushSaves(){for(const [id,t] of saveTimers){clearTimeout(t);if(sheets[id])dbPutSheet(sheets[id]).catch(()=>{})}saveTimers.clear()}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")flushSaves()});
window.addEventListener("pagehide",flushSaves);
function setSaved(t){const el=$("#saved");if(el)el.textContent=t;const sy=$("#sync span");if(sy)sy.textContent=t==="Saving…"?"Saving…":"Saved on device"}

/* ---------- helpers ---------- */
function toast(msg,ms=2600){const t=$("#toast");t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,ms)}
function fmtDate(iso){if(!iso)return "";const [y,m,d]=iso.split("-");return y&&m&&d?`${+m}-${+d}-${y}`:iso}
const hasData=p=>p&&Object.values(p).some(v=>String(v||"").trim());
const pipeCount=s=>Object.values(s.pipes||{}).filter(hasData).length;
function elev(rim,depth){const r=num(rim),d=num(depth);return r!==null&&d!==null?(r-d).toFixed(2):null}
const visibleSheets=()=>Object.values(sheets).sort((a,b)=>(b.updatedAt||"").localeCompare(a.updatedAt||""));
function photoName(s,p,i){return `J${clean(s.jobNo)||"none"}_Pt${clean(s.pointNo)||"none"}_${String(i+1).padStart(2,"0")}_${clean(p.tag)||"photo"}.jpg`}

async function deliver(blob,filename,{share=true}={}){
  const type=blob.type||(filename.endsWith(".zip")?"application/zip":filename.endsWith(".csv")?"text/csv":"application/octet-stream");
  if(share){
    try{
      const file=new File([blob],filename,{type});
      if(navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:filename});return true}
    }catch(e){if(e&&e.name==="AbortError")return false}
  }
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},5000);
  toast(`Saved ${filename}`);return true;
}

/* ---------- photos ---------- */
async function shrink(file){
  const MAX=2560;let src=null,w=0,h=0,url=null;
  try{src=await createImageBitmap(file,{imageOrientation:"from-image"});w=src.width;h=src.height}
  catch(e){try{url=URL.createObjectURL(file);src=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url});w=src.naturalWidth;h=src.naturalHeight}catch(e2){src=null}}
  if(!src||!w)return /^image\/(jpeg|png|webp)$/.test(file.type)?file:null;
  const k=Math.min(1,MAX/Math.max(w,h));
  const c=document.createElement("canvas");c.width=Math.round(w*k);c.height=Math.round(h*k);
  c.getContext("2d").drawImage(src,0,0,c.width,c.height);
  if(url)URL.revokeObjectURL(url);
  const out=await new Promise(r=>c.toBlob(r,"image/jpeg",0.88));
  return out||(/^image\/(jpeg|png|webp)$/.test(file.type)?file:null);
}
async function addPhotos(sheetId,files,tag){
  if(!files.length)return;let added=0,failed=0;
  for(const f of files){
    toast(`Saving photo ${added+failed+1} of ${files.length}…`,10000);
    const blob=await shrink(f);
    if(!blob){failed++;continue}
    const key=rid("p_");
    try{await dbPutPhoto(key,blob)}catch(e){failed++;toast("Couldn't save photo. Device storage may be full.");continue}
    urlCache.set(key,URL.createObjectURL(blob));
    update(sheetId,{photos:[...(sheets[sheetId].photos||[]),{key,tag:tag||"Structure",note:"",takenAt:new Date().toISOString()}]},{now:true});
    added++;refreshPhotos(sheetId);
  }
  toast(failed?`${added} saved, ${failed} couldn't be read`:`${added} photo${added===1?"":"s"} saved`);
}
async function photoURL(key){
  if(urlCache.has(key))return urlCache.get(key);
  const b=await dbGetPhoto(key).catch(()=>null);if(!b)return "";
  const u=URL.createObjectURL(b);urlCache.set(key,u);return u;
}
async function hydrateImgs(root){
  for(const img of root.querySelectorAll("img[data-key]")){
    if(img.getAttribute("src"))continue;
    const u=await photoURL(img.dataset.key);
    if(u)img.src=u;else img.replaceWith(Object.assign(document.createElement("div"),{className:"noimg",textContent:"Photo file missing"}));
  }
}
function refreshPhotos(id){
  if(view.name==="edit"&&view.id===id){const box=$("#photos");if(box){box.innerHTML=photoBodyHTML(sheets[id]);wirePhotos(sheets[id])}const c=$("#photoCount");if(c)c.textContent=`${(sheets[id].photos||[]).length} on this sheet`}
}

/* ---------- plan diagram ---------- */
function planSVG(s,{size=300,interactive=false,sel=null}={}){
  const C=150,R=58,OUT=118;
  let g=`<svg viewBox="0 0 300 300" width="${size}" height="${size}" role="${interactive?"group":"img"}" aria-label="Structure plan with pipe directions">`;
  g+=`<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="var(--pipe)" stroke-width="3"/>`;
  g+=`<g aria-hidden="true"><line x1="${C}" y1="${C-R+10}" x2="${C}" y2="${C-R+30}" stroke="var(--muted)" stroke-width="1.5"/><path d="M${C-5} ${C-R+17} L${C} ${C-R+8} L${C+5} ${C-R+17}" fill="none" stroke="var(--muted)" stroke-width="1.5"/></g>`;
  for(const [k,deg] of SLOTS){
    const p=(s.pipes||{})[k];const has=hasData(p);
    const a=(deg-90)*Math.PI/180,cx=Math.cos(a),cy=Math.sin(a);
    if(has){const w=Math.max(6,Math.min(18,(num(p.size)||12)/1.2));
      g+=`<line x1="${C+cx*(R-6)}" y1="${C+cy*(R-6)}" x2="${C+cx*(OUT-22)}" y2="${C+cy*(OUT-22)}" stroke="var(--pipe)" stroke-width="${w}" opacity=".85"/>`;}
    else if(interactive)g+=`<line x1="${C+cx*(R+4)}" y1="${C+cy*(R+4)}" x2="${C+cx*(OUT-22)}" y2="${C+cy*(OUT-22)}" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="3 4"/>`;
    if(interactive){const x=C+cx*OUT,y=C+cy*OUT;
      g+=`<g class="slot${has?" has":""}${sel===k?" sel":""}" data-slot="${k}" tabindex="0" role="button" aria-label="${k} pipe${has?" (entered)":""}"><circle class="hit" cx="${x}" cy="${y}" r="22"/><text x="${x}" y="${y}">${k}</text></g>`;}
  }
  return g+"</svg>";
}

/* ---------- views ---------- */
function render(){
  const app=$("#app");
  if(view.name==="edit"&&sheets[view.id])renderEdit(app);
  else if(view.name==="export")renderExport(app);
  else if(view.name==="menu")renderMenu(app);
  else{view={name:"list"};renderList(app)}
}
function setActions(items){
  const a=$("#actions"),i=$("#actionsIn");i.innerHTML="";
  items.filter(Boolean).forEach(it=>{const b=document.createElement("button");b.className="btn "+(it.cls||"");b.textContent=it.label;b.onclick=it.fn;i.appendChild(b)});
  a.hidden=!items.filter(Boolean).length;
}
const isStandalone=()=>matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
const isIOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);

function installCardHTML(){
  if(isStandalone())return "";
  if(deferredInstall)return `<div class="installcard"><p><b>Install on this device</b>Adds Invert Sheets to the home screen. It then opens full screen and works with no signal.</p><button class="btn primary" id="installBtn">Install app</button></div>`;
  if(isIOS())return `<div class="installcard"><p><b>Install on this iPad</b>Tap the Share button <span aria-hidden="true">(square with arrow)</span> in Safari, then <strong>Add to Home Screen</strong>. Open it from the home screen icon after that.</p></div>`;
  return "";
}

function renderList(app){
  const all=visibleSheets();
  const jobs=[...new Set(all.map(s=>s.jobNo||""))].sort();
  const q=filter.q.trim().toLowerCase();
  const list=all.filter(s=>(!filter.job||s.jobNo===filter.job)&&(!q||[s.pointNo,s.location,s.project,s.jobNo,s.initials,s.comments].join(" ").toLowerCase().includes(q)));
  const groups={};for(const s of list)(groups[s.jobNo||"—"]??=[]).push(s);
  let h=installCardHTML();
  h+=`<div class="listhead"><h1>Structures logged</h1></div>`;
  if(all.length)h+=`<div class="tools"><input id="q" type="search" placeholder="Search point, location, initials…" value="${esc(filter.q)}" aria-label="Search sheets">
      <select id="jobf" aria-label="Filter by job"><option value="">All jobs</option>${jobs.map(j=>`<option value="${esc(j)}"${j===filter.job?" selected":""}>Job ${esc(j||"(none)")}</option>`).join("")}</select></div>`;
  if(!all.length){
    h+=`<div class="empty"><b>No sheets yet</b>Tap <strong>New sheet</strong> to log your first structure. Everything saves on this device and works with no signal.<div style="margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn" id="loadEx">Load example sheet (Pt 2853)</button><label class="btn filebtn">Import from office ZIP<input type="file" id="impEmpty" accept=".zip,application/zip"></label></div></div>`;
  }else if(!list.length){
    h+=`<div class="empty"><b>No matches</b>Try a different point number or clear the job filter.</div>`;
  }else{
    for(const [job,arr] of Object.entries(groups)){
      const loc=arr.find(s=>s.location)?.location||"";
      h+=`<div class="jobgroup"><h2><b>Job ${esc(job)}</b>${esc(loc)} · ${arr.length} structure${arr.length>1?"s":""}</h2><div class="rows">`;
      for(const s of arr){
        const st=statusOf(s);const code=(STRUCTS.find(x=>x[0]===s.structure)||[])[1];const np=(s.photos||[]).length;
        h+=`<button class="row" data-open="${esc(s.id)}"><span class="pt">${esc(s.pointNo||"—")}</span>
          <span class="meta"><div>${esc(s.structure||"Structure type not set")}${code?` <span class="calc">${code}</span>`:""}</div>
          <div class="sub">${esc(fmtDate(s.date))}${s.initials?" · "+esc(s.initials):""} · ${pipeCount(s)} pipe${pipeCount(s)===1?"":"s"}${np?` · ${np} photo${np===1?"":"s"}`:""}${s.rimToBottom?" · Rim–btm "+esc(s.rimToBottom)+"′":""}</div>
          <div style="margin-top:4px"><span class="chip ${st}">${STATUS_LABEL[st]}</span></div></span>
          <span class="mini" aria-hidden="true">${planSVG(s,{size:44})}</span></button>`;
      }
      h+=`</div></div>`;
    }
  }
  app.innerHTML=h;
  const qi=$("#q");if(qi)qi.oninput=()=>{filter.q=qi.value;const pos=qi.selectionStart;renderList(app);const n=$("#q");n.focus();try{n.setSelectionRange(pos,pos)}catch(e){}};
  const jf=$("#jobf");if(jf)jf.onchange=e=>{filter.job=e.target.value;renderList(app)};
  app.querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>{view={name:"edit",id:b.dataset.open,slot:null};render();scrollTo(0,0)});
  const ib=$("#installBtn");if(ib)ib.onclick=async()=>{deferredInstall.prompt();await deferredInstall.userChoice.catch(()=>{});deferredInstall=null;render()};
  const le=$("#loadEx");if(le)le.onclick=loadExample;
  const ie=$("#impEmpty");if(ie)ie.onchange=()=>{const f=ie.files[0];ie.value="";if(f)importZip(f)};
  setActions([all.length?{label:"Export",cls:"ghost",fn:()=>{view={name:"export"};render();scrollTo(0,0)}}:null,{label:"New sheet",cls:"primary",fn:newSheet}]);
}

function newSheet(){
  const all=visibleSheets();
  const base=(filter.job&&all.find(s=>s.jobNo===filter.job))||all[0];
  const s=blankSheet(base);sheets[s.id]=s;update(s.id,{},{now:true});
  view={name:"edit",id:s.id,slot:null};render();scrollTo(0,0);
  if(base)toast(`Header copied from job ${base.jobNo||"last sheet"}`);
}
function loadExample(){
  const s=Object.assign(blankSheet(),{location:"IL 53 + Boughton Rd",jobNo:"3083",initials:"SS+KC+OM",date:"2026-09-28",pointNo:"2853",checkedBy:"SS CM CC",checkedDate:"2026-09-28",
    structure:"Storm Sewer MH",lid:"Closed",lidText:"STORM",shape:"Round",shapeDims:"2′",condition:"Good",construction:"Precast Sections",rimToBottom:"3.15",rimToBottomNote:"top of debris",status:"done",
    pipes:{NE:{size:"10",mat:"RCP",inv:"2.5"},W:{size:"12",mat:"RCP",inv:"3.1",tpipe:"1.9"},E:{size:"12",mat:"RCP",inv:"3.1"},S:{size:"12",mat:"RCP",inv:"2.8",invNote:"debris"}}});
  sheets[s.id]=s;update(s.id,{},{now:true});render();toast("Example sheet loaded");
}

function radios(name,opts,val){
  return `<div class="opts" role="radiogroup">${opts.map(o=>{const label=Array.isArray(o)?o[0]:o,code=Array.isArray(o)?o[1]:"";
    return `<label class="opt"><input type="radio" name="${name}" value="${esc(label)}"${label===val?" checked":""}><span>${esc(label)}${code?` <em>${code}</em>`:""}</span></label>`}).join("")}</div>`;
}
function field(key,label,val,{num:isNum=false,type="text",ph="",hint=""}={}){
  return `<label class="f"><span>${label}</span><input id="f_${key}" data-k="${key}" type="${type}"${isNum?' inputmode="decimal" class="num"':""} value="${esc(val)}" placeholder="${esc(ph)}" autocomplete="off">${hint?`<span class="hint">${hint}</span>`:""}</label>`;
}

function photoBodyHTML(s){
  const ps=s.photos||[];
  let h=`<div class="photobar">
    <label class="f"><span>Tag next photo as</span><select id="ptag">${PHOTO_TAGS.map(t=>`<option${t===nextTag?" selected":""}>${t}</option>`).join("")}</select></label>
    <label class="btn primary" for="camIn">Take photo</label><input id="camIn" type="file" accept="image/*" capture="environment">
    <label class="btn" for="galIn">From gallery</label><input id="galIn" type="file" accept="image/*" multiple>
  </div>`;
  if(!ps.length)h+=`<div class="empty" style="padding:18px">No photos yet. <strong>Take photo</strong> opens the camera.</div>`;
  else h+=`<div class="photogrid">${ps.map(p=>`<button class="ph" data-photo="${esc(p.key)}"><img alt="${esc(p.tag)} photo" data-key="${esc(p.key)}"${urlCache.has(p.key)?` src="${urlCache.get(p.key)}"`:""}><div class="cap">${esc(p.tag)}<small>${esc(p.note||new Date(p.takenAt).toLocaleString([],{month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit"}))}</small></div></button>`).join("")}</div>
    <div><button class="btn ghost" id="dlSheetPhotos">Share this sheet's photos (ZIP)</button></div>`;
  return h;
}
function wirePhotos(s){
  const box=$("#photos");if(!box)return;
  const tg=$("#ptag");if(tg)tg.onchange=()=>{nextTag=tg.value};
  for(const id of ["camIn","galIn"]){const inp=document.getElementById(id);if(inp)inp.onchange=async()=>{const files=[...inp.files];inp.value="";await addPhotos(s.id,files,nextTag)}}
  box.querySelectorAll("[data-photo]").forEach(b=>b.onclick=()=>{view.photo=b.dataset.photo;view.photoConfirm=false;renderLightbox()});
  const dz=$("#dlSheetPhotos");if(dz)dz.onclick=()=>buildZip([s],`J${clean(s.jobNo)}_Pt${clean(s.pointNo)}_photos.zip`,{csv:false});
  hydrateImgs(box);
}

function renderLightbox(){
  const lb=$("#lb");const s=sheets[view.id];const p=s&&(s.photos||[]).find(x=>x.key===view.photo);
  if(!p){lb.innerHTML="";view.photo=null;document.body.style.overflow="";return}
  const i=s.photos.indexOf(p);
  lb.innerHTML=`<div class="lightbox" role="dialog" aria-label="Photo">
    <div class="imgwrap"><img alt="${esc(p.tag)}" data-key="${esc(p.key)}"${urlCache.has(p.key)?` src="${urlCache.get(p.key)}"`:""}></div>
    <div class="lbpanel">
      <div class="lbrow">
        <label class="f"><span>Tag</span><select id="lbTag">${PHOTO_TAGS.map(t=>`<option${t===p.tag?" selected":""}>${t}</option>`).join("")}</select></label>
        <label class="f"><span>Note</span><input id="lbNote" value="${esc(p.note||"")}" placeholder="e.g. crack at 2nd riser joint"></label>
      </div>
      <div class="progress">${esc(photoName(s,p,i))}</div>
      ${view.photoConfirm?`<div class="confirm" style="margin:0"><p>Delete this photo from the device?</p><button class="btn ghost" id="lbKeep">Keep</button><button class="btn danger" id="lbYes">Delete photo</button></div>`:""}
      <div class="lbrow" style="justify-content:space-between">
        <button class="btn danger" id="lbDel">Delete</button>
        <span style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="lbDl">Share / save</button><button class="btn primary" id="lbClose">Done</button></span>
      </div>
    </div></div>`;
  document.body.style.overflow="hidden";hydrateImgs(lb);
  const setP=patch=>update(s.id,{photos:(sheets[s.id].photos||[]).map(x=>x.key===p.key?{...x,...patch}:x)});
  $("#lbTag").onchange=e=>setP({tag:e.target.value});
  $("#lbNote").oninput=e=>setP({note:e.target.value});
  const close=()=>{view.photo=null;lb.innerHTML="";document.body.style.overflow="";refreshPhotos(s.id)};
  $("#lbClose").onclick=close;
  lb.querySelector(".imgwrap").onclick=e=>{if(e.target.tagName!=="IMG")close()};
  $("#lbDl").onclick=async()=>{const b=await dbGetPhoto(p.key).catch(()=>null);if(!b){toast("Photo file missing.");return}const cur=(sheets[s.id].photos||[]).find(x=>x.key===p.key)||p;deliver(b,photoName(sheets[s.id],cur,i))};
  $("#lbDel").onclick=()=>{view.photoConfirm=true;renderLightbox()};
  const k=$("#lbKeep");if(k)k.onclick=()=>{view.photoConfirm=false;renderLightbox()};
  const y=$("#lbYes");if(y)y.onclick=()=>{update(s.id,{photos:(sheets[s.id].photos||[]).filter(x=>x.key!==p.key)},{now:true});dbDelPhoto(p.key).catch(()=>{});if(urlCache.has(p.key)){URL.revokeObjectURL(urlCache.get(p.key));urlCache.delete(p.key)}view.photoConfirm=false;close();toast("Photo deleted")};
}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&view.photo){const b=$("#lbClose");if(b)b.click()}});

function renderEdit(app){
  const s=sheets[view.id];const st=statusOf(s);
  let h=`<div class="edhead"><button class="iconbtn" id="back" style="color:var(--ink)">← All sheets</button>
    <h1>Point <span>${esc(s.pointNo||"—")}</span></h1><span class="chip ${st}">${STATUS_LABEL[st]}</span></div>
    <div class="saved" id="saved">Saved on device</div><div class="edgrid">`;
  h+=`<section class="card"><h2>Job <small>Copied to each new sheet</small></h2><div class="body">
    <div class="grid2">${field("project","Project name",s.project)}${field("location","Location",s.location,{ph:"e.g. IL 53 + Boughton Rd"})}</div>
    <div class="grid2">${field("jobNo","AEG job no.",s.jobNo,{num:true})}${field("clientJobNo","Client job no.",s.clientJobNo)}</div>
    <div class="grid2">${field("initials","Field initials",s.initials,{ph:"SS+KC+OM"})}${field("date","Date",s.date,{type:"date"})}</div>
    <div class="grid2">${field("sheetNo","Sheet",s.sheetNo,{num:true})}${field("sheetOf","Of",s.sheetOf,{num:true})}</div></div></section>`;
  h+=`<section class="card"><h2>Point &amp; rim</h2><div class="body">
    <div class="grid2">${field("pointNo","Point no.",s.pointNo,{num:true})}${field("rim","Rim elevation",s.rim,{num:true,ph:"optional, ft",hint:"Enter to get invert elevations"})}</div>
    <div class="grid2">${field("rimToBottom","Rim to bottom of structure (ft)",s.rimToBottom,{num:true})}${field("rimToBottomNote","Bottom note",s.rimToBottomNote,{ph:"e.g. top of debris"})}</div>
    ${elev(s.rim,s.rimToBottom)?`<div class="calc">Bottom elev ${elev(s.rim,s.rimToBottom)}</div>`:""}</div></section>`;
  h+=`<section class="card"><h2>Structure type <small>with code</small></h2><div class="body">${radios("structure",STRUCTS,s.structure)}
    ${s.structure==="Other"?field("structureOther","Describe",s.structureOther):""}${field("insideDim","Structure inside dimension",s.insideDim,{ph:"e.g. 4′ dia"})}</div></section>`;
  h+=`<section class="card"><h2>Lid</h2><div class="body"><div class="group"><div class="gl">Lid type</div>${radios("lid",LIDS,s.lid)}</div>
    ${field("lidText","Text on lid",s.lidText,{ph:"STORM, SANITARY…"})}<div class="group"><div class="gl">Shape / size</div>${radios("shape",SHAPES,s.shape)}</div>
    ${s.shape?field("shapeDims",s.shape==="Round"?"Diameter":"Dimensions",s.shapeDims,{ph:s.shape==="Round"?"2′":"2′ × 3′"}):""}</div></section>`;
  h+=`<section class="card"><h2>Condition &amp; construction</h2><div class="body"><div class="group"><div class="gl">Condition</div>${radios("condition",CONDS,s.condition)}</div>
    <div class="group"><div class="gl">Construction</div>${radios("construction",CONSTR,s.construction)}</div>
    ${s.construction==="Other"?field("constructionOther","Describe",s.constructionOther):""}</div></section>`;
  h+=`<section class="card"><h2>Check</h2><div class="body"><div class="grid2">${field("checkedBy","Checked by",s.checkedBy,{ph:"initials"})}${field("checkedDate","Check date",s.checkedDate,{type:"date"})}</div></div></section>`;

  const sel=view.slot;const p=sel?((s.pipes||{})[sel]||{}):null;
  h+=`<section class="card full"><h2>Pipes <small>Depths in feet below rim</small></h2><div class="body"><div class="plan">
    <div>${planSVG(s,{interactive:true,sel})}<div class="pipelist">${SLOTS.filter(([k])=>hasData((s.pipes||{})[k])).map(([k])=>{const x=s.pipes[k];return `<button data-slot="${k}">${k} · ${esc(x.size||"?")}″ ${esc(x.mat||"")} @ ${esc(x.inv||"?")}</button>`}).join("")}</div></div><div class="pipeform">`;
  if(!sel)h+=`<h3>Tap a direction</h3><p class="calc" style="margin:0;font-family:var(--f-body);font-size:14px">The ring matches the circle on the paper sheet, north up. Tap NE, S, W and so on to enter that pipe's size, material, invert and depths.</p>`;
  else{
    const inv=num(p.inv),tp=num(p.tpipe),sz=num(p.size),rb=num(s.rimToBottom);const warns=[];
    if(inv!==null&&tp!==null&&tp>=inv)warns.push("T/Pipe should be less than Inv (both measured down from rim).");
    if(inv!==null&&rb!==null&&inv>rb+0.05)warns.push(`Invert ${inv} is deeper than rim-to-bottom ${rb}.`);
    if(inv!==null&&tp!==null&&sz!==null&&tp<inv){const od=(inv-tp)*12;if(Math.abs(od-sz)>6)warns.push(`Inv − T/Pipe = ${od.toFixed(1)}″, far from the ${sz}″ size. Check readings.`)}
    h+=`<h3>${sel} pipe <small>${SLOTS.find(x=>x[0]===sel)[1]}° from north</small></h3><div class="body">
      <div class="grid2"><label class="f"><span>Size (in)</span><input id="p_size" data-p="size" inputmode="decimal" class="num" value="${esc(p.size||"")}" placeholder="12"></label>
      <label class="f"><span>Material</span><select id="p_mat" data-p="mat"><option value=""></option>${MATS.map(m=>`<option${m===p.mat?" selected":""}>${m}</option>`).join("")}</select></label></div>
      ${["inv","tpipe","twater","tdebris"].map(k=>{const lab={inv:"Inv",tpipe:"T/Pipe",twater:"T/Water",tdebris:"T/Debris"}[k];const e=elev(s.rim,p[k]);
        return `<div class="grid2"><label class="f"><span>${lab} (ft)</span><input id="p_${k}" data-p="${k}" inputmode="decimal" class="num" value="${esc(p[k]||"")}">${e?`<span class="calc">Elev ${e}</span>`:""}</label>
        <label class="f"><span>${lab} note</span><input id="p_${k}Note" data-p="${k}Note" value="${esc(p[k+"Note"]||"")}" placeholder="${k==="inv"?"e.g. debris":""}"></label></div>`}).join("")}
      ${warns.map(w=>`<div class="warnline">${esc(w)}</div>`).join("")}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="clearPipe">Clear ${sel} pipe</button><button class="btn ghost" id="donePipe">Done</button></div></div>`;
  }
  h+=`</div></div></div></section>`;
  h+=`<section class="card full"><h2>Photos <small id="photoCount">${(s.photos||[]).length} on this sheet</small></h2><div class="body" id="photos">${photoBodyHTML(s)}</div></section>`;
  h+=`<section class="card full"><h2>Comments</h2><div class="body"><label class="f"><span>Notes</span><textarea id="f_comments" data-k="comments" placeholder="e.g. Unable to obtain info for S pipe due to debris">${esc(s.comments)}</textarea></label></div></section></div>`;
  const np=(s.photos||[]).length;
  h+=view.confirmDelete?`<div class="confirm"><p>Delete point ${esc(s.pointNo||"(no number)")}${np?` and its ${np} photo${np===1?"":"s"}`:""} from this device? This can't be undone.</p><button class="btn ghost" id="noDel">Keep it</button><button class="btn danger" id="yesDel">Delete sheet</button></div>`
    :`<div style="margin-top:18px"><button class="btn danger" id="del">Delete sheet</button></div>`;
  app.innerHTML=h;

  wirePhotos(s);if(view.photo)renderLightbox();
  $("#back").onclick=()=>{view={name:"list"};render();scrollTo(0,0)};
  app.querySelectorAll("[data-k]").forEach(el=>{
    el.addEventListener("input",()=>update(s.id,{[el.dataset.k]:el.value}));
    el.addEventListener("change",()=>{if(["pointNo","rim","rimToBottom","checkedBy"].includes(el.dataset.k))rerender()});
  });
  app.querySelectorAll("input[type=radio]").forEach(el=>el.addEventListener("change",()=>{update(s.id,{[el.name]:el.value});rerender()}));
  app.querySelectorAll("[data-p]").forEach(el=>{
    const ev=el.tagName==="SELECT"?"change":"input";
    el.addEventListener(ev,()=>{const pipes={...(s.pipes||{})};pipes[sel]={...(pipes[sel]||{}),[el.dataset.p]:el.value};update(s.id,{pipes});if(el.tagName==="SELECT")rerender()});
    if(el.tagName!=="SELECT")el.addEventListener("change",rerender);
  });
  app.querySelectorAll("[data-slot]").forEach(el=>{
    const go=()=>{view.slot=el.dataset.slot;rerender();const f=$("#p_size");if(f)f.focus({preventScroll:true});const pf=$(".pipeform");if(pf&&innerWidth<620)pf.scrollIntoView({behavior:"smooth",block:"start"})};
    el.addEventListener("click",go);el.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();go()}});
  });
  const cp=$("#clearPipe");if(cp)cp.onclick=()=>{const pipes={...(s.pipes||{})};delete pipes[sel];update(s.id,{pipes});view.slot=null;rerender()};
  const dp=$("#donePipe");if(dp)dp.onclick=()=>{view.slot=null;rerender()};
  const del=$("#del");if(del)del.onclick=()=>{view.confirmDelete=true;rerender()};
  const nd=$("#noDel");if(nd)nd.onclick=()=>{view.confirmDelete=false;rerender()};
  const yd=$("#yesDel");if(yd)yd.onclick=async()=>{for(const p of (s.photos||[]))dbDelPhoto(p.key).catch(()=>{});clearTimeout(saveTimers.get(s.id));saveTimers.delete(s.id);delete sheets[s.id];await dbDelSheet(s.id).catch(()=>{});view={name:"list"};render();toast("Sheet deleted")};
  setActions([{label:"Next structure",cls:"ghost",fn:newSheet},
    st==="draft"?{label:"Mark complete",cls:"primary",fn:()=>{update(s.id,{status:"done"},{now:true});rerender();toast("Marked complete")}}
               :{label:"Back to list",cls:"primary",fn:()=>{view={name:"list"};render();scrollTo(0,0)}}]);
}
function rerender(){const y=scrollY;const id=document.activeElement&&document.activeElement.id;render();scrollTo(0,y);if(id){const el=document.getElementById(id);if(el&&el.tagName!=="BUTTON"&&el.type!=="file")try{el.focus({preventScroll:true})}catch(e){}}}

/* ---------- export / import ---------- */
function toCSV(list){
  const cols=["Job No","Client Job No","Project","Location","Field Initials","Date","Sheet","Of","Point No","Rim Elev","Structure","Structure Code","Lid Type","Text on Lid","Lid Shape","Lid Size","Condition","Construction","Inside Dim","Rim to Bottom (ft)","Bottom Note","Pipe Dir","Size (in)","Material","Inv (ft)","Inv Elev","Inv Note","T/Pipe (ft)","T/Water (ft)","T/Debris (ft)","Photos","Comments","Checked By","Check Date","Status"];
  const q=v=>{v=String(v??"");return /[",\n]/.test(v)?`"${v.replace(/"/g,'""')}"`:v};
  const rows=[cols];
  for(const s of list){
    const code=(STRUCTS.find(x=>x[0]===s.structure)||[])[1]||"";
    const base=[s.jobNo,s.clientJobNo,s.project,s.location,s.initials,s.date,s.sheetNo,s.sheetOf,s.pointNo,s.rim,s.structure==="Other"?s.structureOther:s.structure,code,s.lid,s.lidText,s.shape,s.shapeDims,s.condition,s.construction==="Other"?s.constructionOther:s.construction,s.insideDim,s.rimToBottom,s.rimToBottomNote];
    const tail=[(s.photos||[]).length,s.comments,s.checkedBy,s.checkedDate,STATUS_LABEL[statusOf(s)]];
    const ps=SLOTS.map(([k])=>[k,(s.pipes||{})[k]]).filter(([,p])=>hasData(p));
    if(!ps.length)rows.push([...base,"","","","","","","","","",...tail]);
    for(const [k,p] of ps)rows.push([...base,k,p.size,p.mat,p.inv,elev(s.rim,p.inv)||"",p.invNote,p.tpipe,p.twater,p.tdebris,...tail]);
  }
  return "﻿"+rows.map(r=>r.map(q).join(",")).join("\r\n");
}
async function buildZip(list,filename,{csv=true,backup=true}={}){
  if(!window.JSZip){toast("ZIP tool didn't load.");return}
  flushSaves();
  const zip=new JSZip();const total=list.reduce((a,s)=>a+(s.photos||[]).length,0);let n=0,miss=0;const paths={};
  for(const s of list){
    const dir=`photos/Pt${clean(s.pointNo)||"none"}${s.structure?"_"+clean(s.structure):""}`;
    for(const [i,p] of (s.photos||[]).entries()){
      toast(`Packing photo ${n+miss+1} of ${total}…`,10000);
      const b=await dbGetPhoto(p.key).catch(()=>null);
      if(b){const path=`${dir}/${photoName(s,p,i)}`;zip.file(path,b);paths[p.key]=path;n++}else miss++;
    }
  }
  if(csv)zip.file("invert-sheets.csv",toCSV(list));
  if(backup)zip.file("sheets.json",JSON.stringify({app:"invert-sheets",version:1,exportedAt:new Date().toISOString(),sheets:list,photoPaths:paths},null,1));
  toast("Building ZIP…",10000);
  const blob=await zip.generateAsync({type:"blob",compression:"STORE"});
  toast(miss?`${n} photos packed, ${miss} missing`:"ZIP ready");
  await deliver(blob,filename);
}
async function importZip(file){
  if(!window.JSZip){toast("ZIP tool didn't load.");return}
  try{
    toast("Reading ZIP…",10000);
    const zip=await JSZip.loadAsync(file);
    const meta=zip.file("sheets.json");
    if(!meta){toast("That ZIP has no sheets.json. Use a ZIP exported from Invert Sheets.",5000);return}
    const data=JSON.parse(await meta.async("string"));
    let added=0,updated=0,skipped=0,photos=0;
    for(const s of (data.sheets||[])){
      if(!s||!s.id)continue;
      const cur=sheets[s.id];
      if(cur&&(cur.updatedAt||"")>=(s.updatedAt||"")){skipped++;continue}
      for(const p of (s.photos||[])){
        const path=(data.photoPaths||{})[p.key];const f=path&&zip.file(path);
        if(f){const exists=await dbGetPhoto(p.key).catch(()=>null);if(!exists){await dbPutPhoto(p.key,new Blob([await f.async("arraybuffer")],{type:"image/jpeg"}));photos++}}
      }
      sheets[s.id]=s;await dbPutSheet(s);cur?updated++:added++;
    }
    render();
    toast(`Imported: ${added} new, ${updated} updated, ${skipped} already current · ${photos} photos`,5000);
  }catch(e){toast("Couldn't read that file. Pick a ZIP exported from Invert Sheets.",5000)}
}

function renderExport(app){
  const all=visibleSheets();const jobs=[...new Set(all.map(s=>s.jobNo||""))].sort();const job=filter.job;
  const list=all.filter(s=>!job||s.jobNo===job).sort((a,b)=>String(a.pointNo).localeCompare(String(b.pointNo),undefined,{numeric:true}));
  const nPhotos=list.reduce((a,s)=>a+(s.photos||[]).length,0);
  const stem=`invert-sheets${job?"-job-"+clean(job):""}-${today()}`;
  app.innerHTML=`<div class="edhead"><button class="iconbtn" id="back" style="color:var(--ink)">← All sheets</button><h1>Export</h1></div>
   <section class="card" style="margin-top:14px"><h2>Send to the office</h2><div class="body">
   <label class="f"><span>Job</span><select id="exjob"><option value="">All jobs (${all.length} sheets)</option>${jobs.map(j=>`<option value="${esc(j)}"${j===job?" selected":""}>Job ${esc(j||"(none)")}</option>`).join("")}</select></label>
   <div class="calc">${list.length} sheet${list.length===1?"":"s"} · ${nPhotos} photo${nPhotos===1?"":"s"}</div>
   <div class="menu">
     <button class="btn primary" id="exZip">Share job package (ZIP: photos + CSV + backup)</button>
     <button class="btn" id="exCsv">Share CSV only</button>
   </div>
   <p class="hint" style="margin:0;color:var(--muted);font-size:14px">Share opens your device's share sheet: email, Google Drive, OneDrive, Teams, Files. The office can open the same ZIP in this app (Backup → Import) to see every sheet with its photos.</p>
   </div></section>`;
  $("#back").onclick=()=>{view={name:"list"};render()};
  $("#exjob").onchange=e=>{filter.job=e.target.value;renderExport(app)};
  $("#exZip").onclick=()=>buildZip(list,stem+".zip");
  $("#exCsv").onclick=()=>deliver(new Blob([toCSV(list)],{type:"text/csv"}),stem+".csv");
  setActions([]);
}

async function renderMenu(app){
  const all=visibleSheets();const nPhotos=all.reduce((a,s)=>a+(s.photos||[]).length,0);
  app.innerHTML=`<div class="edhead"><button class="iconbtn" id="back" style="color:var(--ink)">← All sheets</button><h1>Backup &amp; settings</h1></div>
   ${installCardHTML()}
   <section class="card" style="margin-top:14px"><h2>Backup</h2><div class="body"><div class="menu">
     <button class="btn primary" id="bkAll">Back up everything (${all.length} sheets, ${nPhotos} photos)</button>
     <label class="btn filebtn">Import a ZIP from another device<input type="file" id="imp" accept=".zip,application/zip"></label>
   </div><p style="margin:0;color:var(--muted);font-size:14px">Sheets and photos live only on this device until you export them. Back up at the end of each day. Importing keeps whichever copy of a sheet was edited last.</p></div></section>
   <section class="card" style="margin-top:14px"><h2>This device</h2><div class="body"><div class="storage" id="stor" style="margin:0">Checking storage…</div>
   <div class="calc">App version ${APP_VERSION} · ${isStandalone()?"installed":"running in browser"}</div></div></section>`;
  $("#back").onclick=()=>{view={name:"list"};render()};
  $("#bkAll").onclick=()=>buildZip(all,`invert-sheets-backup-${today()}.zip`);
  const imp=$("#imp");imp.onchange=()=>{const f=imp.files[0];imp.value="";if(f)importZip(f)};
  const ib=$("#installBtn");if(ib)ib.onclick=async()=>{deferredInstall.prompt();await deferredInstall.userChoice.catch(()=>{});deferredInstall=null;render()};
  setActions([]);
  try{
    const est=navigator.storage&&navigator.storage.estimate?await navigator.storage.estimate():null;
    const persisted=navigator.storage&&navigator.storage.persisted?await navigator.storage.persisted():false;
    const mb=b=>(b/1048576).toFixed(b>1e8?0:1)+" MB";
    $("#stor").textContent=est?`Using ${mb(est.usage||0)} of about ${mb(est.quota||0)} available.${persisted?" Storage is protected from automatic cleanup.":" Install the app to protect storage from automatic cleanup."}`:"Storage details aren't available on this device.";
  }catch(e){}
}

/* ---------- install + updates ---------- */
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;if(view.name==="list"||view.name==="menu")render()});
window.addEventListener("appinstalled",()=>{deferredInstall=null;toast("Installed. Open Invert Sheets from your home screen.");render()});
$("#menuBtn").onclick=()=>{view={name:"menu"};render();scrollTo(0,0)};

if("serviceWorker" in navigator){
  addEventListener("load",()=>{
    navigator.serviceWorker.register("sw.js").then(reg=>{
      const offer=w=>{const u=$("#upd");u.innerHTML=`<div class="update"><p>A new version is ready.</p><button class="btn" id="updBtn">Update</button></div>`;
        $("#updBtn").onclick=()=>{flushSaves();w.postMessage("skipWaiting")}};
      if(reg.waiting&&navigator.serviceWorker.controller)offer(reg.waiting);
      reg.addEventListener("updatefound",()=>{const w=reg.installing;w&&w.addEventListener("statechange",()=>{if(w.state==="installed"&&navigator.serviceWorker.controller)offer(w)})});
    }).catch(()=>{});
    let reloaded=false;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{if(!reloaded){reloaded=true;location.reload()}});
  });
}

/* ---------- boot ---------- */
(async()=>{
  try{for(const s of await dbAllSheets())sheets[s.id]=s}
  catch(e){toast("This browser blocked on-device storage. Use Chrome on Android or Safari on iPad, not a private window.",8000)}
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  render();
})();
})();
