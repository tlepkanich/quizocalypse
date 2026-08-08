var $=function(id){return document.getElementById(id)};
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
var SOURCES=[
  {id:"meta", n:"Metafield",      hint:"Structured custom fields on the product"},
  {id:"tag",  n:"Product tag",    hint:"Free-text tags — whatever the store already writes"},
  {id:"opt",  n:"Variant option", hint:"Size, colour and other variant axes"},
  {id:"type", n:"Product type",   hint:"Shopify’s built-in product type"},
  {id:"coll", n:"Collection",     hint:"Manual or automated collection membership"},
  {id:"calc", n:"Computed",       hint:"Derived from price or inventory — always exact"}
];
function SRC(id){for(var i=0;i<SOURCES.length;i++)if(SOURCES[i].id===id)return SOURCES[i];return null}
var ATTRS=[
  {id:"gender",n:"Gender", src:"meta",key:"custom.gender",  vals:[["men","Men"],["women","Women"],["unisex","Unisex"]]},
  {id:"fit",   n:"Fit",    src:"tag", key:"fit:*",          vals:[["slim","Slim"],["regular","Regular"],["relaxed","Relaxed"]]},
  {id:"size",  n:"Size",   src:"opt", key:"Size",           vals:[["xs","XS"],["s","S"],["m","M"],["l","L"],["xl","XL"]]},
  {id:"style", n:"Style",  src:"tag", key:"style:*",        vals:[["casual","Casual"],["smart","Smart"],["athletic","Athletic"]]},
  {id:"fabric",n:"Fabric", src:"meta",key:"custom.fabric",  vals:[["cotton","Cotton"],["wool","Wool"],["tech","Technical"],["denim","Denim"]]},
  {id:"price", n:"Price",  src:"calc",key:"variant price",  vals:[["low","Under $60"],["mid","$60–120"],["high","$120 and up"]]},
  {id:"colour",n:"Colour", src:"opt", key:"Colour",         vals:[["black","Black"],["navy","Navy"],["stone","Stone"],["olive","Olive"]]},
  {id:"season",n:"Season", src:"meta",key:"custom.season",  vals:[["ss","Spring/Summer"],["aw","Autumn/Winter"],["core","Core"]]}
];
function ATTR(id){for(var i=0;i<ATTRS.length;i++)if(ATTRS[i].id===id)return ATTRS[i];return null}
function valName(dim,v){var a=ATTR(dim);if(!a)return v;
  for(var i=0;i<a.vals.length;i++)if(a.vals[i][0]===v)return a.vals[i][1];return v}

var CAT=[
  {id:"OXF",n:"Oxford Shirt",     set:"C_work",gender:["men","women"],fit:["slim","regular"],size:["s","m","l","xl"],style:["smart"],           fabric:["cotton"],price:["mid"],colour:["navy","stone"],season:["core"]},
  {id:"MER",n:"Merino Crew",      set:"C_work",gender:["men","women"],fit:["slim","regular"],size:["xs","s","m","l"], style:["smart","casual"], fabric:["wool"],  price:["high"],colour:["black","navy"],season:["aw"]},
  {id:"TRO",n:"Wool Trousers",    set:"C_work",gender:["men"],        fit:["slim"],          size:["s","m","l","xl"], style:["smart"],          fabric:["wool"],  price:["high"],colour:["navy"],season:["aw"]},
  {id:"BLZ",n:"Unstructured Blazer",set:"C_work",gender:["women"],    fit:["slim","regular"],size:["xs","s","m","l"], style:["smart"],          fabric:["wool"],  price:["high"],colour:["black"],season:["core"]},
  {id:"PLT",n:"Pleated Skirt",    set:"C_work",gender:["women"],      fit:["regular"],       size:["xs","s","m"],     style:["smart"],          fabric:["wool"],  price:["mid"],colour:["olive"],season:["aw"]},
  {id:"POP",n:"Poplin Shirt",     set:"C_work",gender:["men","women"],fit:["slim","regular"],size:["s","m","l","xl"],style:["smart"],fabric:["cotton"],price:["mid"],colour:["black"],season:["core"]},
  {id:"CHB",n:"Chelsea Boot",     set:"C_work",gender:["men","women"],fit:["regular"],       size:["s","m","l"],      style:["smart","casual"], fabric:["cotton"],price:["high"],colour:["black"],season:["core"]},

  {id:"TEE",n:"Cotton Tee",       set:"C_week",gender:["unisex"],     fit:["regular","relaxed"],size:["xs","s","m","l","xl"],style:["casual"],  fabric:["cotton"],price:["low"],colour:["black","stone"],season:["core"]},
  {id:"DNM",n:"Denim Jacket",     set:"C_week",gender:["men","women"],fit:["regular","relaxed"],size:["s","m","l","xl"],    style:["casual"],  fabric:["denim"], price:["mid"],colour:["navy"],season:["ss"]},
  {id:"CHN",n:"Chino Short",      set:"C_week",gender:["men"],        fit:["regular"],          size:["s","m","l","xl"],    style:["casual"],  fabric:["cotton"],price:["low"],colour:["stone","olive"],season:["ss"]},
  {id:"HOO",n:"Heavy Hoodie",     set:"C_week",gender:["unisex"],     fit:["relaxed"],          size:["s","m","l","xl"],    style:["casual"],  fabric:["cotton"],price:["mid"],colour:["black"],season:["aw"]},
  {id:"SNK",n:"Canvas Sneaker",   set:"C_week",gender:["unisex"],     fit:["regular"],          size:["s","m","l"],         style:["casual"],  fabric:["cotton"],price:["mid"],colour:["stone"],season:["ss"]},
  {id:"POP2",n:"End-on-End Shirt",set:"C_work",gender:["men","women"],fit:["slim","regular"],size:["s","m","l","xl"],style:["smart"],fabric:["cotton"],price:["mid"],colour:["navy"],season:["core"]},
  {id:"LIN",n:"Linen Shirt",      set:"C_week",gender:["men","women"],fit:["relaxed"],          size:["xs","s","m","l"],    style:["casual","smart"],fabric:["cotton"],price:["mid"],colour:["stone"],season:["ss"]},

  {id:"POL",n:"Tech Polo",        set:"C_perf",gender:["men"],        fit:["slim"],             size:["s","m","l","xl"],    style:["athletic","smart"],fabric:["tech"],price:["mid"],colour:["navy"],season:["ss"]},
  {id:"TSH",n:"Training Short",   set:"C_perf",gender:["men","women"],fit:["regular"],          size:["xs","s","m","l"],    style:["athletic"],fabric:["tech"],  price:["low"],colour:["black"],season:["ss"]},
  {id:"BAS",n:"Base Layer",       set:"C_perf",gender:["unisex"],     fit:["slim"],             size:["xs","s","m","l","xl"],style:["athletic"],fabric:["tech"], price:["low"],colour:["black"],season:["core"]},
  {id:"RUN",n:"Running Tee",      set:"C_perf",gender:["women"],      fit:["slim","regular"],   size:["xs","s","m"],        style:["athletic"],fabric:["tech"],  price:["low"],colour:["olive"],season:["ss"]},
  {id:"TRK",n:"Track Pant",       set:"C_perf",gender:["unisex"],     fit:["relaxed"],          size:["s","m","l","xl"],    style:["athletic","casual"],fabric:["tech"],price:["mid"],colour:["black"],season:["aw"]},
  {id:"WND",n:"Windbreaker",      set:"C_perf",gender:["men","women"],fit:["regular"],          size:["s","m","l","xl"],    style:["athletic"],fabric:["tech"],  price:["high"],colour:["olive","navy"],season:["ss"]}
];
var SETS=[{id:"C_work",n:"Workwear Capsule",c:"#3E5C9B"},{id:"C_week",n:"Weekend Capsule",c:"#3E9B7A"},{id:"C_perf",n:"Performance Capsule",c:"#A5417E"}];
/* curated groups the store already has — a ◆ answer can point at any of them */
var COLLS=[
  {id:"K_new", n:"New Arrivals", ids:["LIN","DNM","WND","POL","SNK","RUN"]},
  {id:"K_sale",n:"Sale",         ids:["CHN","TSH","BAS","TEE"]},
  {id:"K_best",n:"Best Sellers", ids:["OXF","MER","TEE","HOO","BAS","CHB","WND"]},
  {id:"K_gift",n:"Gifting",      ids:["MER","CHB","SNK"]}
];
function COL(id){for(var i=0;i<COLLS.length;i++)if(COLLS[i].id===id)return COLLS[i];return null}
CAT.forEach(function(p){p.incoll=COLLS.filter(function(c){return c.ids.indexOf(p.id)>=0}).map(function(c){return c.id})});
ATTRS.push({id:"incoll",n:"Collection",src:"coll",key:"collection membership",
  vals:COLLS.map(function(c){return [c.id,c.n]})});
/* when more products survive than the results page can show, this decides the order */
var SORTS=[
  {id:"best",  n:"Best sellers first",     h:"Shopify sales rank"},
  {id:"new",   n:"Newest first",           h:"Published date"},
  {id:"plow",  n:"Price: low to high",     h:"Cheapest option wins the slot"},
  {id:"phigh", n:"Price: high to low",     h:"Leads with the premium piece"},
  {id:"stock", n:"Most in stock first",    h:"Avoids showing near-sold-out items"},
  {id:"manual",n:"My curated order",       h:"The order set on the result set"},
  {id:"random",n:"Shuffle every time",     h:"Spreads impressions across ties"}
];
function SORTN(id){for(var i=0;i<SORTS.length;i++)if(SORTS[i].id===id)return SORTS[i];return SORTS[0]}
var FALLBACKS=[{id:"best",n:"Best sellers"},{id:"col",n:"A collection…"},{id:"feat",n:"Featured picks…"}];
var doc={
  fallback:"best",
  showCount:4, sort:"best",                       /* how many products the results page actually displays */
  questions:[
    {id:"q1",label:"What are you shopping for?",short:"shopping for",role:"decides",answers:[
      {id:"a1",t:"Work clothes",  target:"C_work",go:"next"},
      {id:"a2",t:"Weekend basics",target:"C_week",go:"next"},
      {id:"a3",t:"Training kit",  target:"C_perf",go:"next"}]},
    {id:"q2",label:"Who are you shopping for?",short:"gender",role:"filter",dim:"gender",answers:[
      {id:"b1",t:"Men",tags:["men","unisex"],go:"next"},{id:"b2",t:"Women",tags:["women","unisex"],go:"next"},
      {id:"b3",t:"Doesn’t matter",nopref:true,go:"next"}]},
    {id:"q3",label:"How do you like things to fit?",role:"filter",dim:"fit",answers:[
      {id:"c1",t:"Slim",tags:["slim"],go:"next"},{id:"c2",t:"Regular",tags:["regular"],go:"next"},
      {id:"c3",t:"Relaxed",tags:["relaxed"],go:"next"},{id:"c4",t:"No preference",nopref:true,go:"next"}]},
    {id:"q4",label:"What size are you?",short:"size",role:"filter",dim:"size",answers:[
      {id:"d1",t:"XS–S",tags:["xs","s"],go:"next"},{id:"d2",t:"M",tags:["m"],go:"next"},
      {id:"d3",t:"L–XL",tags:["l","xl"],go:"next"}]},
    {id:"q5",label:"What’s your style?",short:"style",role:"filter",dim:"style",answers:[
      {id:"e1",t:"Casual",tags:["casual"],go:"next"},{id:"e2",t:"Smart",tags:["smart"],go:"next"},
      {id:"e3",t:"Athletic",tags:["athletic"],go:"next"},{id:"e4",t:"A bit of everything",nopref:true,go:"next"}]},
    {id:"q6",label:"Any fabric you prefer?",short:"fabric",role:"filter",dim:"fabric",answers:[
      {id:"f1",t:"Natural fibres",tags:["cotton","wool","denim"],go:"next"},
      {id:"f2",t:"Technical",tags:["tech"],go:"next"},
      {id:"f3",t:"No preference",nopref:true,go:"next"}]},
    {id:"q7",label:"What’s your budget per piece?",short:"budget",role:"filter",dim:"price",answers:[
      {id:"g1",t:"Under $60",tags:["low"],go:"next"},{id:"g2",t:"$60–120",tags:["mid"],go:"next"},
      {id:"g3",t:"$120 and up",tags:["high"],go:"next"},{id:"g4",t:"No preference",nopref:true,go:"next"}]},
    {id:"q8",label:"How did you hear about us?",short:"referral",role:"info",answers:[
      {id:"h1",t:"Instagram",go:"next"},{id:"h2",t:"A friend",go:"next"}]}
  ],
  rules:[
    {id:1,cells:{q2:{inc:["b2"],exc:[]},q5:{inc:["e2"],exc:[]}},show:["C_work"],hide:[]},
    {id:2,cells:{q3:{inc:["c3"],exc:[]}},show:[],hide:["TRO","BLZ"]},
    {id:3,cells:{q1:{inc:["a3"],exc:[]},q7:{inc:["g1"],exc:[]}},show:["BAS","TSH","RUN"],hide:[]}
  ],
  seq:4
};

var colw={};          /* merchant-dragged column widths, per sheet */
function Q(id){for(var i=0;i<doc.questions.length;i++)if(doc.questions[i].id===id)return doc.questions[i];return null}
function A(q,a){var x=Q(q);if(!x)return null;for(var i=0;i<x.answers.length;i++)if(x.answers[i].id===a)return x.answers[i];return null}
function S(id){for(var i=0;i<SETS.length;i++)if(SETS[i].id===id)return SETS[i];return null}
function P(id){for(var i=0;i<CAT.length;i++)if(CAT[i].id===id)return CAT[i];return null}
function qIndex(id){for(var i=0;i<doc.questions.length;i++)if(doc.questions[i].id===id)return i;return -1}
function decider(){for(var i=0;i<doc.questions.length;i++)if(doc.questions[i].role==="decides")return doc.questions[i];return null}
function tName(id){var s=S(id);if(s)return s.n;var c=COL(id);if(c)return c.n;var p=P(id);if(p)return p.n;return "—"}
function isProd(id){return !!P(id)}
function setProducts(id){
  var c=COL(id);
  if(c)return c.ids.map(P).filter(Boolean);
  var o=[];CAT.forEach(function(p){if(p.set===id)o.push(p)});return o;
}
function groupKind(id){return S(id)?"result set":(COL(id)?"collection":(P(id)?"product":null))}
function ruleNo(r){return "Row "+(doc.rules.indexOf(r)+1)}
function tNames(ids){return ids.map(tName)}
function targetLabel(ids){
  if(!ids.length)return "";
  var n=tName(ids[0]);
  return ids.length>1?n+" +"+(ids.length-1):n;
}
/* the column label IS the question — clipped where it has to be, never reworded.
   A merchant can set a shorter nickname per question; nothing is ever guessed. */
function qLabel(q){return q.short||String(q.label||"").replace(/\s*\?\s*$/,"")}
function hasNick(q){return !!q.short}
function condQs(){return doc.questions.filter(function(q){return q.role!=="info"})}

/* ---------- engine ---------- */
function matches(p,dim,tag){var v=p[dim];return !!v&&v.indexOf(tag)>=0}
/* does this answer keep this product? tags or a hand-picked list — same question either way */
function keeps(q,a,p){
  if(a.nopref)return true;
  if(byHand(q))return !!a.keep&&a.keep.indexOf(p.id)>=0;
  if(!q.dim||!a.tags||!a.tags.length)return false;
  for(var i=0;i<a.tags.length;i++)if(matches(p,q.dim,a.tags[i]))return true;
  return false;
}
function valLabels(q,a){return (a.tags||[]).map(function(v){return valName(q.dim,v)})}
function answerSet(q,a){return CAT.filter(function(p){return keeps(q,a,p)})}
function dimTags(q){
  var a=ATTR(q.dim);
  return a?a.vals.map(function(v){return v[0]}):[];
}
function attrCoverage(dim){
  var n=0;CAT.forEach(function(p){if(p[dim]&&p[dim].length)n++});return n;
}
function questionsUsing(dim){
  return doc.questions.filter(function(q){return q.dim===dim&&isFilter(q)});
}
var _c={};
function bust(){_c={}}
function paths(){
  if(_c.p)return _c.p;
  var out=[];
  (function step(i,picks){
    if(i<0||i>=doc.questions.length){out.push(picks);return}
    var q=doc.questions[i];
    q.answers.forEach(function(a){
      var np={};for(var k in picks)np[k]=picks[k];np[q.id]=a.id;
      var go=a.go||"next";
      if(go==="end"){out.push(np);return}
      step(go==="next"?i+1:qIndex(go),np);
    });
  })(0,{});
  _c.p=out;return out;
}
/* a cell matches: "is any of" needs the answer present and listed;
   "is none of" also passes when the question was never asked */
function cellUsed(c){return !!c&&((c.inc&&c.inc.length)||(c.exc&&c.exc.length))}
function cellMatches(qid,cell,picks){
  if(!cellUsed(cell))return true;
  var inc=cell.inc||[],exc=cell.exc||[],got=picks[qid];
  if(exc.length&&got&&exc.indexOf(got)>=0)return false;
  if(inc.length)return !!got&&inc.indexOf(got)>=0;
  return true;                       /* rule-outs alone still pass if never asked */
}
function fires(r,picks){
  var any=false;
  for(var qid in r.cells){if(cellUsed(r.cells[qid]))any=true}
  if(!any)return false;
  for(var q in r.cells)if(!cellMatches(q,r.cells[q],picks))return false;
  return true;
}
function resolve(picks){
  var t={rule:null,hides:[],baseIds:[],base:null,fromRule:false,products:[],fallback:false};
  for(var i=0;i<doc.rules.length;i++)
    if(doc.rules[i].show.length&&fires(doc.rules[i],picks)){t.rule=doc.rules[i];break}
  var d=decider(),mapped=null;
  if(d&&picks[d.id]){var da=A(d.id,picks[d.id]);mapped=da&&da.target?da.target:null}
  if(t.rule){t.baseIds=t.rule.show.slice();t.fromRule=true}
  else if(mapped)t.baseIds=[mapped];
  t.base=t.baseIds[0]||null;
  var pool=[];
  if(t.baseIds.length)t.baseIds.forEach(function(id){
    (isProd(id)?[P(id)]:setProducts(id)).forEach(function(p){if(pool.indexOf(p)<0)pool.push(p)});
  });
  else if(!d)pool=CAT.slice();
  doc.questions.forEach(function(q){
    if(!isFilter(q)||!(q.id in picks))return;
    var a=A(q.id,picks[q.id]);
    if(!a||a.nopref)return;
    if(byHand(q)?!a.keep:(!q.dim||!a.tags||!a.tags.length))return;
    pool=pool.filter(function(p){return keeps(q,a,p)});
  });
  doc.rules.forEach(function(r){
    if(!r.hide.length||!fires(r,picks))return;
    t.hides.push(r);
    pool=pool.filter(function(p){return r.hide.indexOf(p.id)<0&&r.hide.indexOf(p.set)<0});
  });
  if(!pool.length){t.fallback=true;return t}
  t.products=pool;return t;
}
function outcomeOf(p){var t=resolve(p);if(t.fallback)return "FB";return t.baseIds.length?t.baseIds.join("+"):"ALL"}
function setReached(sid){var t=tally(),n=0;for(var k in t.map)if(k.split("+").indexOf(sid)>=0)n+=t.map[k];return n}
function tally(){if(_c.t)return _c.t;var ps=paths(),m={},o=[];ps.forEach(function(p){var k=outcomeOf(p);if(!(k in m)){m[k]=0;o.push(k)}m[k]++});_c.t={paths:ps,map:m,order:o,total:ps.length};return _c.t}
function count(q,a){
  if(a.nopref)return null;
  if(byHand(q))return a.keep?a.keep.length:-1;
  if(!q.dim||!a.tags||!a.tags.length)return -1;
  var n=0;CAT.forEach(function(p){if(keeps(q,a,p))n++});return n;
}
function reach(r){var n=0;paths().forEach(function(p){if(fires(r,p))n++});return n}
function combos(r){var n=1;for(var q in r.cells){var c=r.cells[q];if(c&&c.inc&&c.inc.length)n*=c.inc.length}return n}
function isFilter(q){return q.role==="filter"||q.role==="pick"}
function byHand(q){return q.role==="pick"}
