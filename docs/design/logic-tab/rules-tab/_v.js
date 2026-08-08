/* =====================================================================
   RULES & MAP — three variations of "make the map optional"
   Shared: the rules card on top, and one Create-a-rule window.
   Different: what the lower half of the page is.
   ===================================================================== */

/* ---------- catalogue extras the creator needs ---------- */
CAT.push(
  {id:"OVC",n:"Wool Overcoat",set:null,gender:["men","women"],fit:["regular"],size:["m","l"],
   style:["smart"],fabric:["wool"],price:["high"],colour:["navy"],season:["aw"]},
  {id:"SCK",n:"Merino Socks", set:null,gender:["unisex"],fit:["regular"],size:["m"],
   style:["casual"],fabric:["wool"],price:["low"],colour:["stone"],season:["core"]},
  {id:"CAP",n:"Field Cap",    set:null,gender:["unisex"],fit:["regular"],size:["m"],
   style:["casual"],fabric:["cotton"],price:["low"],colour:["olive"],season:["ss"]}
);
CAT.forEach(function(p){p.incoll=COLLS.filter(function(c){return c.ids.indexOf(p.id)>=0})
  .map(function(c){return c.id})});
var VSIZES=[["reg","Regular"],["xl","XL"]];
CAT.forEach(function(p){
  p.variants=[];
  (p.colour||["black"]).slice(0,2).forEach(function(c){
    VSIZES.forEach(function(v){p.variants.push({id:p.id+"~"+c+"~"+v[0],n:p.n+" / "+c+" / "+v[1],pid:p.id})});
  });
});
function allVariants(){var o=[];CAT.forEach(function(p){(p.variants||[]).forEach(function(v){o.push(v)})});return o}
function metaValues(){
  var o=[];
  ATTRS.forEach(function(at){
    if(!SRC(at.src)||SRC(at.src).id!=="meta")return;
    at.vals.forEach(function(v){
      o.push({id:"meta:"+at.id+":"+v[0],key:at.key,dim:at.id,val:v[0],label:at.n+" = "+v[1],
        n:CAT.filter(function(p){return (p[at.id]||[]).indexOf(v[0])>=0}).length});
    });
  });
  return o;
}


/* =====================================================================
   TAG GROUPS — a tag namespace IS a family of product groups. Narrowing
   "by quiz tag" means each answer picks one of those groups, and the
   group already holds its products. No abstract attribute in between.
   ===================================================================== */
var TGNAME={quiz:"Quiz tag",color:"Colour tag",style:"Style tag",length:"Length tag",
  occasion:"Occasion tag",opacity:"Opacity tag",care:"Care tag",print:"Print tag",
  season:"Season tag",other:"Merchandising tag"};
(function buildTagGroups(){
  var byG={};
  TAGS.forEach(function(t){(byG[t.g]||(byG[t.g]=[])).push(t.t)});
  Object.keys(byG).forEach(function(g){
    var list=byG[g],dim="tagg:"+g,live=list.slice(0,Math.min(8,list.length));
    /* spread the catalogue over the first few tags so the counts on screen are
       real; the rest stay at zero, which is what a real tag list looks like */
    CAT.forEach(function(p,i){
      p[dim]=live.length?[live[(i*2)%live.length],live[(i*2+1)%live.length]]
        .filter(function(v,ix,a){return a.indexOf(v)===ix}):[];
    });
    var vals=list.map(function(t){
      return [t,t,CAT.filter(function(p){return (p[dim]||[]).indexOf(t)>=0}).length];
    }).sort(function(a,b){return b[2]-a[2]});
    ATTRS.push({id:dim,n:TGNAME[g]||(g+" tag"),src:"tag",key:g+"-*",
      vals:vals.map(function(v){return [v[0],v[1]]}),isTag:true});
  });
})();
function isTagGroup(dim){var a=ATTR(dim);return !!(a&&a.isTag)}


/* =====================================================================
   TWO SHAPES, NOT ONE. A question can narrow in two genuinely different
   ways, and forcing them into one control is what made this confusing:

     BY A FIELD  — the product data really is key/value. Metafield
                   custom.fabric = wool. Variant option Size = M. The
                   question picks the field once; each answer picks values.

     BY GROUPS   — a tag or a collection has no "value". It is just a bag
                   of products. There is nothing to pick at the question
                   level, so each answer points straight at its own groups
                   — one tag, several tags, a collection, even one product.

   "Fabric" reads like a field with values only because someone named
   their tags fabric-*. Most stores have not. So groups is its own mode.
   ===================================================================== */
function qMode(q){return q.mode==="groups"?"groups":"field"}
var _keeps=keeps, _count=count;
keeps=function(q,a,p){
  if(qMode(q)!=="groups")return _keeps(q,a,p);
  if(a.nopref)return true;
  var ids=a.tsel||[];
  for(var i=0;i<ids.length;i++)
    if(targetProducts(ids[i]).some(function(x){return x.id===p.id}))return true;
  return false;
};
count=function(q,a){
  if(qMode(q)!=="groups")return _count(q,a);
  if(a.nopref)return null;
  if(!(a.tsel||[]).length)return -1;
  return CAT.filter(function(p){return keeps(q,a,p)}).length;
};
/* the tag families stay — as a way to BROWSE 162 tags, not as fake fields */
function tagFamilies(){
  var seen={},out=[];
  TAGS.forEach(function(t){if(seen[t.g])return;seen[t.g]=1;
    out.push({k:t.g,n:TGNAME[t.g]||t.g,n2:TAGS.filter(function(x){return x.g===t.g}).length})});
  return out;
}

/* ---------- state ---------- */
(function(){var pa=ATTR('price');if(pa){pa.src='meta';pa.key='custom.price_band'}})();
var VIEW=1, draft=null, tq="", typeF="all", fresh=null;
var expQ=null;              /* B: which question row is open */
var segC="cov";             /* C: coverage | map */

var menuCtx=null,mCat="all",mQ="",mVQ="",mAnchor=null,mNarrow=null,mFam="";
var SAVED={};               /* every question's original role, so a switch never deletes work */
doc.questions.forEach(function(q){SAVED[q.id]=q.role});

var VERBS=[
  {k:"show",n:"Show",      hint:"replaces whatever the quiz picked"},
  {k:"add", n:"Highlight", hint:"adds these in, even if a filter would drop them"},
  {k:"hide",n:"Exclude",   hint:"takes these away for those shoppers"}
];
var TYPES=[{k:"all",n:"All"},{k:"tag",n:"Tags"},{k:"coll",n:"Collections"},
           {k:"meta",n:"Metafields"},{k:"product",n:"Products"},{k:"variant",n:"Variants"}];
var USED_TAGS=["quiz-bamboo jersey","quiz-chiffon lite","quiz-crinkle","quiz-modal"];

function dimVar(d){return "var(--t-"+(d||"any")+")"}
function dimBg(d){return "var(--t-"+(d||"any")+"-s)"}
function tChip(dim,label){return '<span class="t" style="--tc:'+dimVar(dim)+';--tbg:'+dimBg(dim)+'">'+esc(label)+'</span>'}
function narrowQs(){return doc.questions.filter(function(q){return q.role==="filter"})}
function anyNarrow(){return narrowQs().length>0}
function askedQs(){return doc.questions.filter(function(q){return q.role!=="decides"})}

/* flipping a question between "narrows" and "asked only" never deletes the
   mapping — it is kept on the question and restored on the way back */
function setNarrow(qid,on){
  var q=Q(qid);if(!q)return;
  q.role = on ? (SAVED[qid]==="decides"?"decides":"filter") : "info";
  bust();render();
}
function setAllNarrow(on){
  doc.questions.forEach(function(q){
    if(SAVED[q.id]==="filter"||SAVED[q.id]==="decides")q.role=on?SAVED[q.id]:"info";
  });
  bust();render();
}
function mapQs(){return doc.questions.filter(function(q){return q.role!=="info"})}

/* =====================================================================
   ONE RESOURCE INDEX — a tag, a collection, a metafield value, a product
   and a variant are all the same shape: a named thing that resolves to
   products. So there is nothing to choose between; you search and click.
   ===================================================================== */
function resources(){
  if(window.__res)return window.__res;
  var out=[];
  SETS.forEach(function(s){out.push({id:"set:"+s.id,kind:"coll",name:s.n,sub:"curated collection",
    n:setProducts(s.id).length,colour:s.c,curated:true})});
  TAGS.forEach(function(t){out.push({id:"tag:"+t.t,kind:"tag",name:t.t,sub:t.g+" tag",n:t.n})});
  COLLS.forEach(function(c){out.push({id:"coll:"+c.id,kind:"coll",name:c.n,sub:"Shopify collection",
    n:CAT.filter(function(p){return (p.incoll||[]).indexOf(c.id)>=0}).length})});
  metaValues().forEach(function(m){out.push({id:m.id,kind:"meta",name:m.label,sub:m.key,n:m.n})});
  CAT.forEach(function(p){out.push({id:p.id,kind:"product",name:p.n,
    sub:(p.set?tName(p.set):"uncollected")+" · "+(p.variants||[]).length+" variants",n:1,
    colour:p.set?(S(p.set)||{}).c:null})});
  allVariants().forEach(function(v){var p=P(v.pid);
    out.push({id:"var:"+v.id,kind:"variant",name:v.n,sub:p?p.n:"",n:1,
      colour:p&&p.set?(S(p.set)||{}).c:null})});
  window.__res=out;return out;
}
function RES(id){var r=resources();for(var i=0;i<r.length;i++)if(r[i].id===id)return r[i];return null}
/* rules created before this index existed store bare set / product ids */
function resName(id){var r=RES(id);if(r)return r.name;var n=tName(id);return n==="—"?id:n}
function resKind(id){var r=RES(id);return r?r.kind:(P(id)?"product":"coll")}
function resolveN(id){var r=RES(id);if(r)return r.n;
  if(P(id))return 1;var s=setProducts(id);return s?s.length:0}
function isLive(id){var r=RES(id);return !!r&&(r.kind==="tag"||r.kind==="coll"||r.kind==="meta")}
function kindLabel(k){return {tag:"Tag",coll:"Collection",meta:"Metafield",product:"Product",variant:"Variant"}[k]||k}

/* =====================================================================
   THE DRAFT
   ===================================================================== */
function dOpen(seed){
  draft={when:{},join:{},qmode:{},verb:"hide",targets:[]};
  if(seed){draft.when[seed.q]={inc:[seed.a],exc:[]};draft.verb="show"}
  tq="";typeF="all";render();
}
function dClose(){draft=null;render()}
function dWhen(qid,aid){
  var m=draft.when[qid]||(draft.when[qid]={inc:[],exc:[]});
  var i=m.inc.indexOf(aid);
  if(i>=0)m.inc.splice(i,1);else m.inc.push(aid);
  if(!m.inc.length)delete draft.when[qid];
  render();
}
function stateOf(qid,aid){var m=draft.when[qid];return m&&m.inc.indexOf(aid)>=0?"on":""}
function dTarget(id){var i=draft.targets.indexOf(id);
  if(i>=0)draft.targets.splice(i,1);else draft.targets.push(id);render()}
function whenCount(){var n=0;for(var q in draft.when)n+=draft.when[q].inc.length;return n}
/* every question can carry a condition — including the ones that narrow nothing,
   because on a rules-only quiz those are the only conditions there are */
function condQs(){return doc.questions}
function usedQs(){return condQs().filter(function(q){return !!draft.when[q.id]}).map(function(q){return q.id})}
function joinBefore(qid){return draft.join[qid]||"and"}
function affected(){var n=0,live=false;
  draft.targets.forEach(function(id){n+=resolveN(id);if(isLive(id))live=true});return {n:n,live:live}}
function ready(){return whenCount()>0&&draft.targets.length>0}

/* ---------- impact ---------- */
function qSatisfied(qid,p){
  var m=draft.when[qid],q=Q(qid),got=p[qid];
  if(q&&q.multi&&draft.qmode[qid]==="all")return m.inc.length===1&&m.inc[0]===got;
  return m.inc.indexOf(got)>=0;
}
function andGroups(){
  var qs=usedQs(),groups=[],cur=[];
  qs.forEach(function(qid,i){if(i>0&&joinBefore(qid)==="or"){groups.push(cur);cur=[]}cur.push(qid)});
  if(cur.length)groups.push(cur);
  return groups;
}
function matchesPath(p){
  var gs=andGroups();if(!gs.length)return false;
  for(var i=0;i<gs.length;i++){var all=true;
    for(var j=0;j<gs[i].length;j++)if(!qSatisfied(gs[i][j],p)){all=false;break}
    if(all)return true}
  return false;
}
function unestimable(){return usedQs().some(function(qid){var q=Q(qid);
  return q&&q.multi&&draft.qmode[qid]==="all"&&draft.when[qid].inc.length>1})}
function impact(){
  if(!usedQs().length)return null;
  if(unestimable())return {na:true};
  var total=1;doc.questions.forEach(function(q){total*=q.answers.length});
  if(total<=200000){var n=0;paths().forEach(function(p){if(matchesPath(p))n++});
    return {n:n,total:paths().length,exact:true}}
  var N=4000,hit=0;
  for(var i=0;i<N;i++){var p={};
    doc.questions.forEach(function(q){p[q.id]=q.answers[Math.floor(Math.random()*q.answers.length)].id});
    if(matchesPath(p))hit++}
  return {pct:hit/N,exact:false};
}

/* ---------- the sentence ---------- */
function joinN(a,w){return a.length===1?a[0]:a.slice(0,-1).join(", ")+" "+(w||"and")+" "+a[a.length-1]}
function clauseFor(qid){
  var m=draft.when[qid],q=Q(qid);
  var w=(q&&q.multi&&draft.qmode[qid]==="all")?"and":"or";
  return joinN(m.inc.map(function(id){var a=A(qid,id);return '<b>'+esc(a?a.t:"?")+'</b>'}),w);
}
function sentence(){
  var ph=function(t){return '<span class="ph">'+t+'</span>'};
  var gs=andGroups();
  var whenTxt=!gs.length?ph("pick answers")
    :gs.map(function(g){var inner=g.map(clauseFor).join('<span class="join">and</span>');
       return gs.length>1?'<span class="grp">'+inner+'</span>':inner}).join('<span class="join">or</span>');
  var tgt=draft.targets.length
    ?joinN(draft.targets.map(function(id){return '<b>'+esc(resName(id))+'</b>'}))
    :ph("pick what it acts on");
  var vt=draft.verb==="show"?"show":(draft.verb==="add"?"highlight":"exclude");
  return 'When a shopper picks '+whenTxt+', '+vt+' '+tgt+'.';
}
function commit(){
  var cells={};
  for(var q in draft.when)cells[q]={inc:draft.when[q].inc.slice(),exc:[]};
  var r={id:doc.seq++,cells:cells,show:[],pin:[],hide:[],_t:draft.targets.slice(),
    _v:draft.verb,_j:JSON.parse(JSON.stringify(draft.join)),_qm:JSON.parse(JSON.stringify(draft.qmode))};
  if(draft.verb==="hide")r.hide=draft.targets.slice();
  else if(draft.verb==="add")r.pin=draft.targets.slice();
  else r.show=draft.targets.slice();
  doc.rules.push(r);fresh=r.id;draft=null;bust();render();
  toast("Rule "+doc.rules.length+" added");
  setTimeout(function(){fresh=null;render()},1800);
}

/* =====================================================================
   MODAL — left: who it applies to · spine: what it does · right: what it acts on
   ===================================================================== */
function whenBank(){
  var h='',used=usedQs(),seen=0;
  condQs().forEach(function(q){
    var on=!!draft.when[q.id];
    if(on&&seen>0){var jv=joinBefore(q.id);
      h+='<div class="joinrow"><span class="jline"></span>'
        +'<button class="jbtn'+(jv==="and"?" on":"")+'" data-join="'+q.id+':and">and</button>'
        +'<button class="jbtn'+(jv==="or"?" on":"")+'" data-join="'+q.id+':or">or</button>'
        +'<span class="jline"></span></div>'}
    if(on)seen++;
    /* the number is what a merchant scans by; the label is the reminder */
    var lb=qLabel(q); if(lb.length>20)lb=lb.slice(0,19).replace(/\s+\S*$/,"")+"\u2026";
    h+='<div class="qblock'+(on?" used":"")+'"><div class="qhead">'
      +'<span class="qnum">Q'+(qIndex(q.id)+1)+'</span>'
      +'<span class="qlab">'+esc(lb)+'</span>';
    if(q.multi){
      var n=on?draft.when[q.id].inc.length:0;
      h+='<span class="qmulti">multi-select</span>';
      if(n>1){var md=draft.qmode[q.id]==="all"?"all":"any";
        h+='<span class="qmode">shopper picked'
          +'<button class="mini'+(md==="any"?" on":"")+'" data-qmode="'+q.id+':any">any of</button>'
          +'<button class="mini'+(md==="all"?" on":"")+'" data-qmode="'+q.id+':all">all of</button></span>'}
    }
    h+='</div><div class="chips">'
      +q.answers.map(function(a){
        return '<button class="chip '+stateOf(q.id,a.id)+'" '
          +'data-when="'+q.id+':'+a.id+'">'+esc(a.t)+'</button>'}).join("")+'</div></div>';
  });
  return h;
}
/* the chip already says what kind of thing this is, so the sub-line only earns
   its place when it carries something else — where a product lives, say */
function subFor(r){
  if(r.kind==="coll"||r.kind==="tag")return "";
  return r.sub||"";
}
function chipFor(r){return r.curated?"Set":kindLabel(r.kind)}
function resRow(r){
  var on=draft.targets.indexOf(r.id)>=0,n=targetProducts(r.id).length;
  return '<div class="rrow2'+(on?" on":"")+'" data-target="'+esc(r.id)+'" role="button" tabindex="0">'
    +'<span class="rk k-'+(r.curated?"set":r.kind)+'">'+chipFor(r)+'</span>'
    +(r.colour?'<span class="rdot" style="background:'+r.colour+'"></span>':'')
    +'<span class="rn">'+esc(r.name)+'</span>'
    +'<span class="rs">'+esc(subFor(r))+'</span>'
    +'<button class="rc'+(n?"":" none")+'" data-resprods="'+esc(r.id)+'">'
      +n+' product'+(n===1?"":"s")+'</button>'
    +'<span class="rtick">'+(on?"✓":"")+'</span></div>';
}
function targetBank(){
  var all=resources(),q=tq.toLowerCase().trim(),counts={};
  all.forEach(function(r){counts[r.kind]=(counts[r.kind]||0)+1});
  var h='<div class="scopebar"><input id="tq" type="search" '
    +'placeholder="Search…" value="'+esc(tq)+'"></div>';
  h+='<div class="tfilters">'+TYPES.map(function(t){
    var n=t.k==="all"?all.length:(counts[t.k]||0);
    return '<button class="tf'+(typeF===t.k?" on":"")+'" data-tfilter="'+t.k+'">'
      +esc(t.n)+'<s>'+n+'</s></button>'}).join("")+'</div>';
  var hits=[];
  all.forEach(function(r){
    if(typeF!=="all"&&r.kind!==typeF)return;
    if(!q)return;
    var inName=r.name.toLowerCase().indexOf(q)>=0,inSub=(r.sub||"").toLowerCase().indexOf(q)>=0;
    if(inName||inSub)hits.push({r:r,rank:inName?0:1});
  });
  hits.sort(function(a,b){return a.rank-b.rank});
  var weak=hits.filter(function(x){return x.rank===1}).length;
  hits=hits.map(function(x){return x.r});
  /* with nothing typed the filter chips ARE the browse control — pick a type and
     you get that type, not a fixed list that ignores what you just clicked */
  if(!q){
    if(typeF!=="all"){
      var list=all.filter(function(r){return r.kind===typeF});
      h+='<div class="rgrp"><div class="rgh">'+kindLabel(typeF)+'s<s>'+list.length+'</s></div>'
        +list.slice(0,40).map(resRow).join("")
        +(list.length>40?'<div class="more">+'+(list.length-40)+' more — type to narrow</div>':"")
        +'</div>';
      return h;
    }
    var used=all.filter(function(r){return r.curated})
      .concat(USED_TAGS.map(function(t){return RES("tag:"+t)}).filter(Boolean));
    h+='<div class="rgrp"><div class="rgh">This quiz already recommends<s>'+used.length+'</s></div>'
      +used.map(resRow).join("")+'</div>';
    return h;
  }
  if(!hits.length)return h+'<div class="nores">Nothing matches “'+esc(tq)+'”. '
    +'<button class="linkbtn" data-addone>Add it as a one-off product</button></div>';
  var byK={};hits.forEach(function(r){(byK[r.kind]||(byK[r.kind]=[])).push(r)});
  h+='<div class="scopenote">Found <b>'+hits.length+'</b> across '+Object.keys(byK).length+' type'
    +(Object.keys(byK).length>1?"s":"")+(weak?' · '+weak+' matched by what they belong to':'')+'</div>';
  ["coll","tag","meta","product","variant"].forEach(function(k){
    var list=byK[k];if(!list)return;
    h+='<div class="rgrp"><div class="rgh">'+kindLabel(k)+'s<s>'+list.length+'</s></div>'
      +list.slice(0,12).map(resRow).join("")
      +(list.length>12?'<div class="more">+'+(list.length-12)+' more — keep typing to narrow</div>':"")
      +'</div>';
  });
  return h;
}
function modalHTML(){
  var aff=affected(),im=impact(),rd=ready();
  var h='<div class="mhd"><h2>Create a rule</h2>'
    +'<span class="hint">Who it applies to on the left, what it acts on on the right.</span>'
    +'<button class="mbtn pri"'+(rd?"":" disabled")+' data-commit>Create rule</button>'
    +'</div><div class="mbody">';
  h+='<div class="bank"><div class="bankh"><span class="eyebrow">When they answer</span>'
    +'<span class="count'+(whenCount()?"":" none")+'">'+whenCount()+' picked</span></div>'
    +'<div class="bankb">'+whenBank()+'</div></div>';
  h+='<div class="spine"><div class="bankh"><span class="eyebrow">Then</span></div>'
    +'<div class="verbs">'
    +VERBS.map(function(x){return '<button class="verb'+(draft.verb===x.k?" on":"")+'" data-verb="'+x.k+'">'
      +'<b>'+esc(x.n)+'</b><i>'+esc(x.hint)+'</i></button>'}).join("")+'</div></div>';
  h+='<div class="bank"><div class="bankh"><span class="eyebrow">What it acts on</span>'
    +'<span class="count'+(draft.targets.length?"":" none")+'">'
    +(aff.n?aff.n+(aff.live?"+":"")+' product'+(aff.n===1?"":"s"):"0 picked")+'</span></div>'
    +'<div class="bankb">'+targetBank()+'</div></div></div>';
  if(draft.targets.length){
    h+='<div class="tray"><span class="trayl">Acts on</span>'
      +draft.targets.map(function(id){var r=RES(id)||{name:resName(id),kind:"product",n:1};
        return '<span class="tchip k-'+r.kind+'">'+esc(r.name)
          +(r.kind==="product"||r.kind==="variant"?"":'<s>'+r.n+'</s>')
          +'<button class="tx" data-target="'+esc(id)+'">✕</button></span>'}).join("")
      +'<span class="traysum">'+aff.n+' product'+(aff.n===1?"":"s")
      +(aff.live?" · updates as the catalogue changes":"")+'</span></div>';
  }
  h+='<div class="mfoot"><span class="sentence">'+sentence()+'</span>'
    +'<span class="impact'+(rd?" ok":"")+'">'
    +(!im?"":(im.na?'<i>Needs multi-answer shoppers — not estimable yet</i>'
      :(im.exact?'Fires on <b>'+im.n.toLocaleString()+'</b> of '+im.total.toLocaleString()+' paths'
                :'≈<b>'+Math.round(im.pct*100)+'%</b> of shoppers <i>(sampled)</i>')))+'</span>'
    +'<button class="mbtn" data-cancel>Cancel</button></div>';
  return h;
}

/* =====================================================================
   THE RULES CARD — identical in all three variations
   ===================================================================== */
function ruleText(r){
  var qs=Object.keys(r.cells||{}).filter(function(q){
    var c=r.cells[q];return c&&c.inc&&c.inc.length});
  var parts=qs.map(function(qid){
    var c=r.cells[qid],qq=Q(qid);
    var w=(qq&&qq.multi&&r._qm&&r._qm[qid]==="all")?" and ":" or ";
    return (c.inc||[]).map(function(id){var a=A(qid,id);return '<b>'+esc(a?a.t:"?")+'</b>'}).join(w);
  });
  var ids=(r._t&&r._t.length)?r._t:(r.show.length?r.show:(r.pin&&r.pin.length?r.pin:r.hide));
  var what=ids.map(function(id){
    var k=resKind(id);
    return '<b>'+esc(resName(id))+'</b>'+(k!=="product"&&k!=="variant"?' <i>('+kindLabel(k).toLowerCase()+')</i>':'')
  }).join(", ");
  var glued="";
  parts.forEach(function(txt,ix){
    if(ix)glued+=' <span class="join">'+((r._j&&r._j[qs[ix]])||"and")+'</span> ';
    glued+=txt;
  });
  var verb=r.hide.length?"exclude ":((r.pin&&r.pin.length)?"highlight ":"show ");
  return (parts.length?"When they pick "+glued+", ":"Always ")+verb+what+".";
}
function rulesCard(extra){
  var h='<div class="rcard"><div class="rch"><h2>Rules</h2>'
    +'<button class="spark" data-x="rules">'+SPARK()+'How it works</button>'
    +'<button class="mkbtn" data-open><span class="p">+</span> Create rule</button></div>';
  if(!doc.rules.length){
    /* in the one-list shape there is no "map below" — the questions are in this
       same card, so the empty state has to say which of them is doing the work */
    var nq=mapQs().length;
    h+='<div class="rrow none"><span class="no">—</span><span class="txt">No rules yet. '
      +(nq?'Your <b>'+nq+'</b> switched-on question'+(nq===1?" is":"s are")+' below deciding everything.'
          :'And no question is switched on — so every shopper sees the same products.')
      +'</span></div>';
  }
  doc.rules.forEach(function(r,i){
    h+='<div class="rrow'+(fresh===r.id?" fresh":"")+'"><span class="no">'+(i+1)+'</span>'
      +'<span class="txt">'+ruleText(r)+'</span>'
      +'<button class="kill" data-del="'+r.id+'" title="Delete this rule">✕</button></div>';
  });
  h+=(extra||"")+'</div>';
  return h;
}


/* =====================================================================
   THE PICKER — one popover for every association a question needs:
   which job the question does, which set an answer opens, and which
   values of an attribute an answer keeps.
   ===================================================================== */
function placeMenu(anchor,wide){
  var m=$("menu"),b=anchor.getBoundingClientRect(),D=document.documentElement;
  mAnchor=anchor;
  m.classList.add("on");m.classList.toggle("wide",!!wide);
  m.style.maxHeight="none";
  var w=m.offsetWidth||284,pad=12;
  m.style.left=Math.max(8,Math.min(b.left+window.scrollX,window.scrollX+D.clientWidth-w-8))+"px";
  /* open downwards when there is room, upwards when there is not, and cap the
     height to whichever side won — a menu that runs off the screen is unusable */
  var below=D.clientHeight-b.bottom-pad, above=b.top-pad, h=m.scrollHeight;
  if(h<=below||below>=above){
    m.style.maxHeight=Math.max(180,Math.min(h,below))+"px";
    m.style.top=(b.bottom+window.scrollY+6)+"px";
  }else{
    var cap=Math.max(180,Math.min(h,above));
    m.style.maxHeight=cap+"px";
    m.style.top=(b.top+window.scrollY-cap-6)+"px";
  }
}
function shutMenu(){$("menu").classList.remove("on");menuCtx=null;mQ="";mVQ="";mCat="all";mNarrow=null;mFam=""}
function mItem(on,name,sub,count,attrs,swatch,pre){
  return '<button class="mitem'+(on?" on":"")+'" '+(attrs||"")+'>'
    +(swatch?'<span class="sw" style="background:'+swatch+'"></span>':'')
    +'<span class="mn">'+(pre||"")+esc(name)+(sub?'<i>'+esc(sub)+'</i>':'')+'</span>'
    +(count!=null?'<span class="mc">'+count+'</span>':'')
    +'<span class="tk">'+(on?"✓":"")+'</span></button>';
}
function attrCoverage(dim){return CAT.filter(function(p){return (p[dim]||[]).length>0}).length}
function qFull(q){return String(q.label||qLabel(q)).replace(/\s*\?\s*$/,"")}
function decidesQ(){for(var i=0;i<doc.questions.length;i++)
  if(doc.questions[i].role==="decides")return doc.questions[i];return null}

/* which product data a question can be matched against, grouped the way a
   merchant thinks about it: metafields, tags, variant options, collections */
var CATN={meta:"Metafields",tag:"Tags",opt:"Variant options",coll:"Collections",
  calc:"Computed",type:"Product type",tagg:"Tag groups"};
function catOf(at){return at.isTag?"tagg":at.src}
function srcCats(){
  var seen={},out=[{k:"all",n:"All"}];
  ATTRS.forEach(function(at){if(at.isTag)return;var k=catOf(at);if(seen[k])return;
    seen[k]=1;out.push({k:k,n:CATN[k]||(SRC(at.src)||{}).n||k})});
  return out;
}
function attrList(){
  var q=mQ.toLowerCase().trim();
  return ATTRS.filter(function(at){
    if(at.isTag)return false;            /* a tag family is not a field */
    if(mCat!=="all"&&catOf(at)!==mCat)return false;
    if(!q)return true;
    var sc=SRC(at.src);
    return (at.n+" "+at.key+" "+(sc?sc.n:"")).toLowerCase().indexOf(q)>=0;
  });
}

/* --- 1. what job does this question do? --- */
function roleMenu(q,anchor){
  if(!menuCtx||menuCtx.kind!=="role"||menuCtx.q!==q.id)mNarrow=null;
  menuCtx={kind:"role",q:q.id};
  var dq=decidesQ(),cats=srcCats(),list=attrList(),at=ATTR(q.dim);
  var openNarrow=mNarrow===null?(q.role==="filter"):mNarrow;
  var h='<div class="mtitle">'+esc(qFull(q))+'</div>';
  /* three jobs, named the same way the row that opened this menu names them */
  h+=mItem(q.role==="decides","Starting set",dq&&dq!==q?"now on Q"+(qIndex(dq.id)+1):null,
    null,'data-setrole="'+q.id+':decides"',null,'<span class="mdia">◆</span>');
  h+=mItem(q.role==="info","Info only",null,null,'data-setrole="'+q.id+':info"');
  h+=mItem(false,"Narrows",
    (openNarrow||q.role!=="filter")?null:(qMode(q)==="groups"?"Anything":(at?at.n:null)),
    null,'data-narrowopen="'+q.id+'"',null,null,false,openNarrow?"▾":"▸");
  if(openNarrow){
    h+='<div class="msep"></div>';
    /* ONE list, not a branch. "Anything" is the absence of a field, not a rival
       mode — picking a field just keeps every answer drawing from one list. */
    h+=mItem(q.role==="filter"&&qMode(q)==="groups","Anything",
      "each answer picks its own",null,'data-setrole="'+q.id+':groups"');
    h+='<div class="mcats">'+cats.map(function(c){
      return '<button class="mcat'+(mCat===c.k?" on":"")+'" data-mcat="'+c.k+'">'+esc(c.n)+'</button>'}).join("")+'</div>';
    h+='<div class="msearch"><input id="mq" type="search" placeholder="Search your fields…" '
      +'value="'+esc(mQ)+'"></div>';
    if(!list.length)h+='<div class="mempty">Nothing matches “'+esc(mQ)+'”.</div>';
    list.forEach(function(a2){
      h+=mItem(q.role==="filter"&&qMode(q)==="field"&&q.dim===a2.id,a2.n,a2.key,
        attrCoverage(a2.id)+"/"+CAT.length,'data-setrole="'+q.id+':filter:'+a2.id+'"');
    });
  }
  $("menu").innerHTML=h;placeMenu(anchor,true);
  var el=$("mq");if(el&&mQ){el.focus();el.setSelectionRange(mQ.length,mQ.length)}
}
/* --- 3. which values of the attribute does this answer keep? --- */
function valMenu(q,a,anchor){
  menuCtx={kind:"val",q:q.id,a:a.id};
  var at=ATTR(q.dim),sc=at?SRC(at.src):null,tagish=isTagGroup(q.dim);
  var vals=(at?at.vals:[]).map(function(v){
    return {v:v[0],lab:v[1],
      n:CAT.filter(function(p){return (p[q.dim]||[]).indexOf(v[0])>=0}).length};
  });
  var qy=mVQ.toLowerCase().trim();
  var shown=vals.filter(function(x){return !qy||x.lab.toLowerCase().indexOf(qy)>=0});
  var h='<div class="mtitle">'+esc(a.t)+(at?' · '+esc(at.n):'')+'</div>';
  if(vals.length>8)
    h+='<div class="msearch"><input id="mvq" type="search" placeholder="Search '+vals.length
      +' '+esc(tagish?"tags":"values")+'…" value="'+esc(mVQ)+'"></div>';
  if(!shown.length)h+='<div class="mempty">Nothing matches “'+esc(mVQ)+'”.</div>';
  shown.slice(0,60).forEach(function(x){
    var on=!a.nopref&&(a.tags||[]).indexOf(x.v)>=0;
    h+=mItem(on,x.lab,null,x.n+(x.n===1?" product":" products"),
      'data-valmap="'+q.id+':'+a.id+':'+x.v+'"');
  });
  if(shown.length>60)h+='<div class="mempty">+'+(shown.length-60)+' more — keep typing.</div>';
  h+='<div class="msep"></div>'
    +mItem(!!a.nopref,"Keeps everything",null,null,'data-valnopref="'+q.id+':'+a.id+'"');
  $("menu").innerHTML=h;placeMenu(anchor,vals.length>8);
  var el=$("mvq");if(el&&mVQ){el.focus();el.setSelectionRange(mVQ.length,mVQ.length)}
}
/* --- 4. every count opens the products behind it --- */
function keepersFor(q,a){
  if(!q)return CAT.slice();
  if(q.role==="decides")return a.target?setProducts(a.target):[];
  if(q.role==="info"||a.nopref)return CAT.slice();
  return CAT.filter(function(p){return keeps(q,a,p)});
}
function prodMenu(title,list,anchor){
  menuCtx={kind:"prod"};
  var h='<div class="mtitle">'+title+' — '+list.length+' product'+(list.length===1?"":"s")+'</div>';
  if(!list.length)h+='<div class="mempty">Nothing carries this yet. Everyone who lands here '
    +'reaches your safety net instead.</div>';
  h+='<div class="plist">'+list.map(function(p){
    return '<div class="pl">'
      +'<span class="sw" style="background:'+(p.set?((S(p.set)||{}).c||"var(--faint2)"):"var(--faint2)")+'"></span>'
      +'<span class="pn">'+esc(p.n)+'</span>'
      +'<span class="ps">'+esc(p.set?tName(p.set):"uncollected")+'</span></div>'}).join("")+'</div>';
  $("menu").innerHTML=h;placeMenu(anchor);
}


/* =====================================================================
   WHAT AN ANSWER OPENS — a curated set, a Shopify collection, a tag, a
   metafield value, or products hand-picked one at a time. One selection,
   any mix. The engine only knows how to resolve an id, so it gets one.
   ===================================================================== */
var MULTI={};                       /* synthetic id -> the product ids behind it */
/* keep the engine's own resolver for plain set / collection ids. NOTE: this has
   to be an assignment, not a function declaration — a declaration would hoist
   over the original and make the fallback call itself forever. */
var _setProducts=setProducts;
function targetProducts(id){
  if(!id)return [];
  if(MULTI[id])return MULTI[id].map(P).filter(Boolean);
  if(id.indexOf("sel:")===0)return [];
  if(id.indexOf("tag:")===0){var t=id.slice(4);
    return CAT.filter(function(p){
      for(var k in p)if(k.indexOf("tagg:")===0&&(p[k]||[]).indexOf(t)>=0)return true;
      return false})}
  if(id.indexOf("meta:")===0){var b=id.split(":");
    return CAT.filter(function(p){return (p[b[1]]||[]).indexOf(b[2])>=0})}
  if(id.indexOf("coll:")===0)return _setProducts(id.slice(5));
  if(id.indexOf("set:")===0)return _setProducts(id.slice(4));
  if(id.indexOf("var:")===0){var v=id.slice(4).split("~")[0],pp=P(v);return pp?[pp]:[]}
  if(P(id))return [P(id)];
  return _setProducts(id);
}
setProducts=targetProducts;   /* every caller in the engine now resolves all five kinds */

/* the merchant's own selection lives on the answer; the engine gets one id for it */
/* the demo doc stores bare ids ("C_work"); the resource index is prefixed
   ("set:C_work"). Normalise on read or the same thing shows up twice. */
function normId(id){
  if(!id||RES(id))return id;
  var p=["set:","coll:","tag:","var:"];
  for(var i=0;i<p.length;i++)if(RES(p[i]+id))return p[i]+id;
  return id;
}
function selOf(a){return (a.tsel||(a.target?[a.target]:[])).map(normId)}
function syncSel(q,a,ids){
  a.tsel=ids.slice();
  if(!ids.length){a.target=null;return}
  if(ids.length===1){a.target=ids[0];return}
  var key="sel:"+q.id+":"+a.id,seen={},out=[];
  ids.forEach(function(id){targetProducts(id).forEach(function(p){
    if(!seen[p.id]){seen[p.id]=1;out.push(p.id)}})});
  MULTI[key]=out;a.target=key;
}
function selLabel(a){
  var ids=selOf(a);
  if(!ids.length)return null;
  if(ids.length===1){var r=RES(ids[0]);return r?r.name:resName(ids[0])}
  return ids.length+" things";
}
function setMenu(q,a,anchor){
  menuCtx={kind:"set",q:q.id,a:a.id};
  var all=resources(),qy=mVQ.toLowerCase().trim(),sel=selOf(a);
  var cats=[{k:"all",n:"All"},{k:"coll",n:"Collections"},{k:"tag",n:"Tags"},
            {k:"meta",n:"Metafields"},{k:"product",n:"Products"},{k:"variant",n:"Variants"}];
  var list=all.filter(function(r){
    if(mCat!=="all"&&r.kind!==mCat)return false;
    if(mCat==="tag"&&mFam&&(r.sub||"").indexOf(mFam+" ")!==0)return false;
    if(!qy)return r.curated||mCat!=="all";
    return (r.name+" "+(r.sub||"")).toLowerCase().indexOf(qy)>=0;
  });
  var h='<div class="mtitle">'+esc(a.t)+'</div>';
  h+='<div class="mcats">'+cats.map(function(c){
    return '<button class="mcat'+(mCat===c.k?" on":"")+'" data-mcat2="'+c.k+'">'+esc(c.n)+'</button>'}).join("")+'</div>';
  if(mCat==="tag")h+='<div class="mcats">'
    +'<button class="mcat'+(mFam===""?" on":"")+'" data-mfam="">All tags</button>'
    +tagFamilies().map(function(f){
      return '<button class="mcat'+(mFam===f.k?" on":"")+'" data-mfam="'+f.k+'">'
        +esc(f.n)+' <s style="opacity:.6">'+f.n2+'</s></button>'}).join("")+'</div>';
  h+='<div class="msearch"><input id="mvq" type="search" placeholder="Search all '+all.length
    +' collections, tags, metafields, products…" value="'+esc(mVQ)+'"></div>';
  if(sel.length){
    h+='<div class="mtitle">Selected</div>';
    sel.forEach(function(id){var r=RES(id)||{name:resName(id),kind:resKind(id)};
      h+=mItem(true,r.name,r.curated?"curated set":kindLabel(r.kind).toLowerCase(),targetProducts(id).length,
        'data-setmap="'+q.id+':'+a.id+':'+esc(id)+'"',r.colour)});
    h+='<div class="msep"></div>';
  }
  if(!list.length)h+='<div class="mempty">'+(qy?'Nothing matches “'+esc(mVQ)+'”.'
    :'Pick a type above, or search.')+'</div>';
  list.slice(0,40).forEach(function(r){
    if(sel.indexOf(r.id)>=0)return;
    h+=mItem(false,r.name,r.curated?"curated set":kindLabel(r.kind).toLowerCase(),
      targetProducts(r.id).length,'data-setmap="'+q.id+':'+a.id+':'+esc(r.id)+'"',r.colour);
  });
  if(list.length>40)h+='<div class="mempty">+'+(list.length-40)+' more — keep typing.</div>';
  h+='<div class="msep"></div>';
  if(q.role==="filter")
    h+=mItem(!!a.nopref,"Keeps everything",null,null,'data-valnopref="'+q.id+':'+a.id+'"');
  if(sel.length)h+=mItem(false,"Clear this answer",null,null,'data-setmap="'+q.id+':'+a.id+':"');
  $("menu").innerHTML=h;placeMenu(anchor,true);
  var el=$("mvq");if(el&&mVQ){el.focus();el.setSelectionRange(mVQ.length,mVQ.length)}
}

/* =====================================================================
   SKIP LOGIC — where an answer sends the shopper next. Forward only, so
   a quiz can never loop, and a skipped question never narrows anything.
   ===================================================================== */
function routeLabel(q,a){
  var go=a.go||"next";
  if(go==="next")return "next question";
  if(go==="end")return "→ results";
  var i=qIndex(go);return i<0?"next question":"→ Q"+(i+1);
}
function routeBtn(q,a){
  var go=a.go||"next";
  return '<button class="mapbtn'+(go==="next"?"":" set")+'" data-route="'+q.id+':'+a.id+'"'
    +(go==="next"?' style="border-style:solid;border-color:var(--line2);color:var(--faint2)"':'')
    +'>'+esc(routeLabel(q,a))+'</button>';
}
function routeMenu(q,a,anchor){
  menuCtx={kind:"route",q:q.id,a:a.id};
  var qi=qIndex(q.id),go=a.go||"next";
  var h='<div class="mtitle">'+esc(a.t)+' · goes to</div>';
  h+=mItem(go==="next","The next question",
    doc.questions[qi+1]?qFull(doc.questions[qi+1]):"straight to the results",null,
    'data-setgo="'+q.id+':'+a.id+':next"',null,null,true);
  doc.questions.forEach(function(nq,ni){
    if(ni<=qi+1)return;
    h+=mItem(go===nq.id,"Q"+(ni+1)+" — "+qFull(nq),
      "skips "+(ni-qi-1)+" question"+(ni-qi-1===1?"":"s"),null,
      'data-setgo="'+q.id+':'+a.id+':'+nq.id+'"',null,null,true);
  });
  h+='<div class="msep"></div>'
    +mItem(go==="end","Straight to the results",null,null,
      'data-setgo="'+q.id+':'+a.id+':end"');
  $("menu").innerHTML=h;placeMenu(anchor,true);
}

/* ---------- what an answer currently maps to, as a button ---------- */
function mapBtn(q,a){
  if(q.role==="info")
    return '<span class="mapbtn" style="border-style:solid;opacity:.5">not used for products</span>';
  if(q.role==="decides"){
    var lab=selLabel(a),one=selOf(a).length===1?RES(selOf(a)[0]):null;
    return '<button class="mapbtn '+(lab?"set":"unset")+'" data-amap="'+q.id+':'+a.id+'">'
      +(lab?((one&&one.colour)?'<span class="sdot" style="background:'+one.colour+'"></span>':'')
            +esc(lab):'pick what it opens')+'</button>';
  }
  if(qMode(q)==="groups"){
    if(a.nopref)return '<button class="mapbtn set" data-amap="'+q.id+':'+a.id+'">keeps everything</button>';
    var gl=selLabel(a);
    return '<button class="mapbtn '+(gl?"set":"unset")+'" data-amap="'+q.id+':'+a.id+'">'
      +(gl?esc(gl):'pick anything')+'</button>';
  }
  if(a.nopref)return '<button class="mapbtn set" data-atag="'+q.id+':'+a.id+'">keeps everything</button>';
  var vl=valLabels(q,a);
  return '<button class="mapbtn '+(vl.length?"set":"unset")+'" data-atag="'+q.id+':'+a.id+'">'
    +(vl.length?vl.map(function(v){return tChip(q.dim,v)}).join(""):'not mapped yet')+'</button>';
}
function ansCount(q,a){
  if(q.role==="info")return null;
  if(q.role==="decides"){var dn=a.target?setProducts(a.target).length:0;
    return dn+" product"+(dn===1?"":"s")}
  if(a.nopref)return "all "+CAT.length;
  var n=count(q,a);return n<0?"not set":n+" / "+CAT.length;
}
function cntBtn(q,a){
  var c=ansCount(q,a);if(c==null)return "";
  var bad=/^0|not set/.test(c);
  return '<button class="cntbtn'+(bad?" bad":"")+'" data-prods="'+q.id+':'+a.id+'">'+esc(c)+'</button>';
}

/* =====================================================================
   THE MAP — as it is today
   ===================================================================== */
function rulesNaming(qid,aid){
  return doc.rules.map(function(r,i){return {r:r,i:i}}).filter(function(x){
    var c=x.r.cells[qid];return c&&c.inc&&c.inc.indexOf(aid)>=0});
}
function valLabels(q,a){return (a.tags||[]).map(function(v){return valName(q.dim,v)})}
function mapRows(){
  var h='';
  doc.questions.forEach(function(q,qi){
    q.answers.forEach(function(a,ai){
      h+='<tr'+(ai===0?' class="qs"':'')+'>';
      if(ai===0)h+='<td class="q" rowspan="'+q.answers.length+'">'+esc(qLabel(q))
        +'<span class="qr"><button class="mapbtn set" data-role="'+q.id+'" '
        +'style="padding:2px 7px;min-height:0;font-size:10px;letter-spacing:.05em;text-transform:uppercase">'
        +(q.role==="decides"?'<span class="mdia">◆</span>starting set'
          :(q.role==="filter"?(qMode(q)==="groups"?"narrows · anything"
                                :"narrows · "+(ATTR(q.dim)?ATTR(q.dim).n:q.dim))
                             :"info only"))+' ▾</button></span></td>';
      h+='<td class="ak">'+String.fromCharCode(65+ai)+'</td><td class="at">'+esc(a.t)+'</td>';
      h+='<td class="nar">'+mapBtn(q,a)+'</td><td class="cn">'+(cntBtn(q,a)||"·")+'</td>';
      h+='<td class="go">'+routeBtn(q,a)+'</td></tr>';
    });
  });
  return h;
}
function mapTable(){
  return '<table class="mtbl"><tr><th>Question</th><th></th><th>Answer</th>'
    +'<th>Shows / narrows</th><th>Products</th><th>Then go to</th></tr>'
    +mapRows()+'</table>';
}

/* =====================================================================
   COVERAGE — who no rule speaks for
   ===================================================================== */
function coverage(){
  var ps=paths(),miss=0,byA={};
  /* a shopper is UNCLAIMED when nothing named a set for them — either they fell
     to the safety net, or nothing matched at all and they got the raw catalogue */
  ps.forEach(function(p){
    var t=resolve(p),bad=t.fallback||!t.baseIds.length;
    if(bad)miss++;
    doc.questions.forEach(function(q){
      var k=q.id+":"+p[q.id],o=byA[k]||(byA[k]={n:0,bad:0,q:q.id,a:p[q.id]});
      o.n++;if(bad)o.bad++;
    });
  });
  /* an answer is only a GAP if it is meaningfully worse than the quiz's own
     baseline — otherwise every answer on an irrelevant question looks broken */
  var base=miss/ps.length;
  var gaps=Object.keys(byA).map(function(k){return byA[k]})
    .filter(function(o){return o.bad>0&&(o.bad/o.n)>base+0.05})
    .sort(function(a,b){return ((b.bad/b.n)-base)*b.bad-((a.bad/a.n)-base)*a.bad});
  return {total:ps.length,miss:miss,pct:base,gaps:gaps.slice(0,5)};
}
function coverageHTML(){
  var c=coverage(),cls=c.pct>=.4?"bad":(c.pct<=.1?"ok":"");
  var h='<div class="covwrap"><div class="covhero">'
    +'<span class="big '+cls+'">'+Math.round(c.pct*100)+'%</span>'
    +'<span class="lb">of shoppers finish without a single rule or answer naming products for them. '
    +'They get <b>'+esc((FALLBACKS.filter(function(f){return f.id===doc.fallback})[0]||{n:"Best sellers"}).n)
    +'</b> or the raw catalogue. That is the number this page exists to bring down.</span></div>';
  if(!c.gaps.length)h+='<p style="font-size:13px;color:var(--faint)">Every answer is claimed by something. Nothing to fix.</p>';
  c.gaps.forEach(function(g){
    var q=Q(g.q),a=A(g.q,g.a);if(!q||!a)return;
    var full=String(q.label||qLabel(q)).replace(/\s*\?\s*$/,"");
    h+='<div class="gap"><span class="gt">Shoppers who answer <b>'+esc(a.t)+'</b> to '
      +'“'+esc(full)+'” end with nothing '
      +'<b>'+Math.round(100*g.bad/g.n)+'%</b> of the time.</span>'
      +'<span class="gp">'+g.bad.toLocaleString()+' / '+g.n.toLocaleString()+'</span>'
      +'<button class="gbtn pri" data-seed="'+g.q+':'+g.a+'">Write a rule for this</button>'
      +(q.role!=="info"
        ? '<button class="gbtn" data-narrow="'+g.q+':0">Take this out of the map</button>'
        : (SAVED[g.q]!=="info"
            ? '<button class="gbtn" data-narrow="'+g.q+':1">Put it back in the map</button>':""))
      +'</div>';
  });
  return h+'</div>';
}

/* =====================================================================
   THE THREE VARIATIONS
   ===================================================================== */
function paneA(){
  var on=mapQs().length>0,n=mapQs().length;
  var h=rulesCard();
  h+='<div class="swbar"><span class="t1">Question map</span>'
    +'<span class="t2">'+(on
      ? '<b>'+n+'</b> question'+(n===1?"":"s")+' pick or narrow products before your rules run. '
        +'Switch off and they are all still asked — they just stop deciding anything.'
      : 'Off. Every question is asked, none of them touches the products, so your rules decide '
        +'everything. Nothing you mapped was deleted.')+'</span>'
    +'<button class="swbtn'+(on?" on":"")+'" data-allnarrow="'+(on?0:1)+'">'
      +'<span class="knob"></span>'+(on?"On":"Off")+'</button></div>';
  if(on)h+='<div class="mapcard"><div class="mh2"><h2>Map</h2>'
    +'<span class="sub">Every question, every answer, and what it does</span></div>'+mapTable()+'</div>';
  return h;
}
function paneB(){
  var extra='<div class="rch divrow"><h2>Questions</h2>'
    +'<button class="spark" data-x="questions">'+SPARK()+'How it works</button></div>'
    +'<tr-placeholder>';
  return rulesCard(extra).replace('<tr-placeholder>','<div class="scrollx">'+mapTable()+'</div>');
}
function paneC(){
  var h=rulesCard();
  h+='<div class="mapcard"><div class="mh2">'
    +'<h2>'+(segC==="cov"?"Who no rule speaks for":"Map")+'</h2>'
    +'<span class="sub">'+(segC==="cov"
      ?"The shoppers your rules and map both miss"
      :"Every question, every answer, and what it does")+'</span>'
    +'<span class="segh"><button class="'+(segC==="cov"?"on":"")+'" data-seg="cov">Coverage</button>'
    +'<button class="'+(segC==="map"?"on":"")+'" data-seg="map">Map</button></span></div>';
  h+=(segC==="cov"?coverageHTML():mapTable())+'</div>';
  return h;
}

var NOTE='Each question below says what it does right now. Switch one on and it starts ruling '
 +'products out; switch it off and it is still asked, it just stops deciding. '
 +'<b>Nothing is ever deleted</b> — flip it back and the mapping is where you left it.';

/* =====================================================================
   RENDER
   ===================================================================== */
function render(){
  if(!menuCtx)shutMenu();
  $("vnote").innerHTML=NOTE;
  $("p1").innerHTML=paneB();
  var m=$("modal"),sc=$("scrim");
  if(!draft){m.classList.remove("on");sc.classList.remove("on");m.innerHTML="";return}
  m.innerHTML=modalHTML();m.classList.add("on");sc.classList.add("on");
  var el=$("tq");
  if(el&&tq){el.focus();el.setSelectionRange(tq.length,tq.length)}
}

document.addEventListener("input",function(e){
  if(e.target.id==="tq"){tq=e.target.value;render();return}
  if(e.target.id==="mq"&&menuCtx&&menuCtx.kind==="role"){mQ=e.target.value;roleMenu(Q(menuCtx.q),mAnchor);return}
  if(e.target.id==="mvq"&&menuCtx&&menuCtx.kind==="val"){mVQ=e.target.value;
    valMenu(Q(menuCtx.q),A(menuCtx.q,menuCtx.a),mAnchor);return}
  if(e.target.id==="mvq"&&menuCtx&&menuCtx.kind==="set"){mVQ=e.target.value;
    setMenu(Q(menuCtx.q),A(menuCtx.q,menuCtx.a),mAnchor)}
});
document.addEventListener("click",function(e){
  var t=e.target.closest("[data-x]");
  if(t){openX(t.dataset.x);return}
  t=e.target.closest("[data-xgo]");  if(t){xI=+t.dataset.xgo;paintX();return}
  if(e.target.closest("[data-xprev]")){xNav(-1);return}
  if(e.target.closest("[data-xnext]")){xNav(1);return}
  if(e.target.closest("[data-close]")||e.target===$("xscrim")){closeX();return}
  t=e.target.closest("[data-open]");
  if(t){dOpen();return}
  if(e.target.closest("[data-cancel]")){dClose();return}
  if(e.target===$("scrim"))return;   /* clicking out must not discard a draft */
  t=e.target.closest("[data-seed]");
  if(t){var sp=t.dataset.seed.split(":");dOpen({q:sp[0],a:sp[1]});return}
  t=e.target.closest("[data-when]");   if(t){var p=t.dataset.when.split(":");dWhen(p[0],p[1]);return}
  t=e.target.closest("[data-join]");   if(t){var j=t.dataset.join.split(":");draft.join[j[0]]=j[1];render();return}
  t=e.target.closest("[data-qmode]");  if(t){var qm=t.dataset.qmode.split(":");draft.qmode[qm[0]]=qm[1];render();return}
  t=e.target.closest("[data-verb]");   if(t){draft.verb=t.dataset.verb;render();return}
  t=e.target.closest("[data-tfilter]");if(t){typeF=t.dataset.tfilter;render();return}
  t=e.target.closest("[data-resprods]");
  if(t){var rid=t.dataset.resprods,rr=RES(rid);
    prodMenu(esc(rr?rr.name:resName(rid)),targetProducts(rid),t);e.stopPropagation();return}
  t=e.target.closest("[data-target]"); if(t){dTarget(t.dataset.target);return}
  if(e.target.closest("[data-addone]")){
    var nm=(tq||"").trim();
    if(!nm){$("tq").focus();return}
    var id="X"+(CAT.length+1);
    CAT.push({id:id,n:nm,set:null,gender:["unisex"],fit:["regular"],size:["m"],style:["casual"],
      fabric:["cotton"],price:["mid"],colour:["black"],season:["core"],incoll:[],
      variants:[{id:id+"~one",n:nm+" / One size",pid:id}]});
    window.__res=null;draft.targets.push(id);tq="";bust();render();
    toast('“'+nm+'” added and selected');return}
  if(e.target.closest("[data-commit]")){if(ready())commit();return}
  t=e.target.closest("[data-del]");
  if(t){var d=+t.dataset.del;doc.rules=doc.rules.filter(function(r){return r.id!==d});bust();render();
    toast("Rule deleted");return}
  t=e.target.closest("[data-allnarrow]"); if(t){setAllNarrow(t.dataset.allnarrow==="1");return}
  t=e.target.closest("[data-qnarrow]");
  if(t){var qn=t.dataset.qnarrow.split(":");setNarrow(qn[0],qn[1]==="1");return}
  t=e.target.closest("[data-narrow]");
  if(t){var nn=t.dataset.narrow.split(":"),onn=nn[1]==="1";
    setNarrow(nn[0],onn);
    toast("“"+qLabel(Q(nn[0]))+"” "+(onn?"now narrows":"no longer narrows — it is still asked"));return}
  t=e.target.closest("[data-prods]");
  if(t){var pd=t.dataset.prods.split(":"),pq=Q(pd[0]),pa=A(pd[0],pd[1]);
    prodMenu('“'+esc(pa.t)+'”',keepersFor(pq,pa),t);e.stopPropagation();return}

  /* ---- the association pickers ---- */
  t=e.target.closest("[data-role]");
  if(t){var rq=Q(t.dataset.role);if(rq){menuCtx="role";roleMenu(rq,t)}e.stopPropagation();return}
  t=e.target.closest("[data-amap]");
  if(t){var am=t.dataset.amap.split(":");setMenu(Q(am[0]),A(am[0],am[1]),t);e.stopPropagation();return}
  t=e.target.closest("[data-atag]");
  if(t){var ag=t.dataset.atag.split(":");valMenu(Q(ag[0]),A(ag[0],ag[1]),t);e.stopPropagation();return}
  t=e.target.closest("[data-route]");
  if(t){var rt=t.dataset.route.split(":");routeMenu(Q(rt[0]),A(rt[0],rt[1]),t);e.stopPropagation();return}
  t=e.target.closest("[data-setgo]");
  if(t){var sg=t.dataset.setgo.split(":"),ga=A(sg[0],sg[1]);
    ga.go=sg[2];shutMenu();bust();render();return}
  t=e.target.closest("[data-narrowopen]");
  if(t){mNarrow=!(mNarrow===null?(Q(t.dataset.narrowopen).role==="filter"):mNarrow);
    roleMenu(Q(t.dataset.narrowopen),mAnchor);e.stopPropagation();return}
  t=e.target.closest("[data-mcat]"); if(t){mCat=t.dataset.mcat;
    roleMenu(Q(menuCtx.q),mAnchor);e.stopPropagation();return}
  t=e.target.closest("[data-setrole]");
  if(t){var sr=t.dataset.setrole.split(":"),qq=Q(sr[0]);
    if(sr[1]==="groups"){
      qq.role="filter";qq.mode="groups";
      shutMenu();bust();expQ=qq.id;render();
      toast("Answers on “"+qFull(qq)+"” can now pick anything");return}
    if(sr[1]==="filter")qq.mode="field";
    if(sr[1]==="decides"){
      /* only one question can open the starting set — moving it says so out loud */
      var prev=decidesQ();
      if(prev&&prev!==qq){prev.role=SAVED[prev.id]==="filter"?"filter":"info";
        window.__moved=qFull(prev)}
    }
    qq.role=sr[1];
    if(sr[1]==="filter"&&sr[2]&&qq.dim!==sr[2]){
      /* a new attribute means the old answer values mean nothing — clear them, say so */
      qq.dim=sr[2];
      qq.answers.forEach(function(a){if(!a.nopref)a.tags=[]});
      toast("“"+qFull(qq)+"” now narrows by "+ATTR(sr[2]).n+" — map its answers");
    } else if(sr[1]==="filter"&&sr[2]) qq.dim=sr[2];
    else if(sr[1]==="decides")
      toast(window.__moved
        ? "Starting set moved from “"+window.__moved+"” to “"+qFull(qq)+"” — map its answers"
        : "“"+qFull(qq)+"” now picks the starting set — map its answers");
    window.__moved=null;
    shutMenu();bust();expQ=qq.id;render();return}
  t=e.target.closest("[data-mfam]"); if(t){mFam=t.dataset.mfam;
    setMenu(Q(menuCtx.q),A(menuCtx.q,menuCtx.a),mAnchor);e.stopPropagation();return}
  t=e.target.closest("[data-mcat2]"); if(t){mCat=t.dataset.mcat2;mFam="";
    setMenu(Q(menuCtx.q),A(menuCtx.q,menuCtx.a),mAnchor);e.stopPropagation();return}
  t=e.target.closest("[data-setmap]");
  if(t){var sm=t.dataset.setmap.split(":"),sq=Q(sm[0]),sa=A(sm[0],sm[1]);
    var id=t.dataset.setmap.slice(sm[0].length+sm[1].length+2);
    var cur=selOf(sa).slice();
    if(!id)cur=[];
    else{var ix=cur.indexOf(id);if(ix>=0)cur.splice(ix,1);else cur.push(id)}
    syncSel(sq,sa,cur);bust();render();
    if(id)setMenu(sq,sa,document.querySelector('[data-amap="'+sm[0]+':'+sm[1]+'"]')||mAnchor);
    else shutMenu();
    return}
  t=e.target.closest("[data-valmap]");
  if(t){var vm=t.dataset.valmap.split(":"),va=A(vm[0],vm[1]);
    delete va.nopref;va.tags=va.tags||[];
    var vi=va.tags.indexOf(vm[2]);if(vi>=0)va.tags.splice(vi,1);else va.tags.push(vm[2]);
    bust();render();valMenu(Q(vm[0]),va,document.querySelector('[data-atag="'+vm[0]+':'+vm[1]+'"]'));
    return}
  t=e.target.closest("[data-valnopref]");
  if(t){var vn=t.dataset.valnopref.split(":"),na=A(vn[0],vn[1]);
    if(na.nopref)delete na.nopref;else{na.nopref=true;na.tags=[]}
    shutMenu();bust();render();return}
  /* the row itself opens and closes — checked LAST so every button inside it wins */
  if(!e.target.closest("#menu"))shutMenu();
  t=e.target.closest("[data-seg]");   if(t){segC=t.dataset.seg;render();return}
});
window.addEventListener("resize",function(){xH=null;if($("xsheet").classList.contains("on"))paintX()});
document.addEventListener("keydown",function(e){
  if(e.key!=="Escape")return;
  if($("xsheet").classList.contains("on")){closeX();return}
  if($("menu").classList.contains("on"))shutMenu();else if(draft)dClose();
});
function toast(m){var t=$("toast");t.textContent=m;t.classList.add("on");
  clearTimeout(t._t);t._t=setTimeout(function(){t.classList.remove("on")},2000)}

doc.rules.forEach(function(r){if(!r.pin)r.pin=[]});
render();
