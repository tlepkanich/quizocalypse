/* ===== explainers, ported ===== */
function SPARK(){return '<svg viewBox="0 0 24 24"><path d="M12 2l1.9 5.6L19.5 9.5 13.9 11.4 12 17'
  +'l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zM19 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9L19 15z'
  +'M5 14l.7 2 2 .7-2 .7L5 19.4l-.7-2-2-.7 2-.7L5 14z"/></svg>'}
/* one step at a time: xstep collects rather than concatenates, so the sheet
   can page through them and the progress bar knows their names */
var _steps=null;
function xstep(n,title,para,body){
  var html='<div class="step">'
    +(para?'<p class="stp">'+para+'</p>':'')+(body||'')+'</div>';
  if(_steps)_steps.push({n:n,title:title,html:html});
  return '';
}
function collect(fn){_steps=[];var lede=fn();var out=_steps;_steps=null;return {lede:lede,steps:out}}
function xfig(inner,cap){return '<div class="fig">'+inner+'</div>'
  +(cap?'<div class="figcap">'+cap+'</div>':'')}

/* ---- the three-part path, shared by both explainers ---- */
function chunk(c){ /* [class, type-prefix, value] */
  return '<span class="chunk'+(c[0]?' '+c[0]:'')+'">'
    +(c[1]?'<i class="ty'+(c[3]?' '+c[3]:'')+'">'+c[1]+'</i>':'')+c[2]+'</span>';
}
function path(cells){
  return '<div class="path">'+cells.map(chunk).join('<span class="sarw">→</span>')+'</div>';
}
function pathhd(a,b,c){
  return '<div class="pathhd"><span class="plab">'+a+'</span><span></span>'
    +'<span class="plab">'+b+'</span><span></span><span class="plab">'+c+'</span></div>';
}
var VERB={show:['v-show','Show these'],inc:['v-inc','Always include'],exc:['v-exc','Exclude'],
          nar:['v-nar','Narrowing'],ask:['v-ask','Asked only'],set:['v-set','Starting set']};
function ledger(rows,mode){ /* [n, when, verbKey, type, target, rowClass, right] */
  var hasM=rows.some(function(r){return r[6]});
  return '<div class="qlist'+(hasM?(mode==="status"?" s":" m"):"")+'">'+rows.map(function(r){var v=VERB[r[2]];
    return '<div class="qb'+(r[5]?' '+r[5]:'')+'"><span class="n">'+r[0]+'</span><span>'+r[1]+'</span>'
      +'<span class="vp '+v[0]+'">'+v[1]+'</span>'
      +'<span class="tg">'+(r[3]?'<i>'+r[3]+': </i>':'')+r[4]+'</span>'
      +(hasM?'<span class="mth">'+(r[6]||'')+'</span>':'')+'</div>'}).join('')+'</div>';
}
function drop(n,left){return '<em>&minus;'+n+'</em> · <b>'+left+'</b>'}

/* =====================================================================
   1 · HOW RULES WORK
   ===================================================================== */
function rulesX(){
  var h='<p class="lede">A rule is one sentence: '
    +'<b>when they answer this, do that to these products.</b></p>';

  h+=xstep(1,'One sentence, three parts','',
    xfig('<div class="paths">'
      +pathhd('When they answer','Do this','To these')
      +path([['','','Oily <span class="j">and</span> Sensitive'],
             ['v-show','','Show these'],['','tag','quiz-gentle']])
      +path([['','','Polos <span class="j">or</span> Beachwear <span class="j">and</span> Slim Fit'],
             ['v-exc','','Exclude'],['','collection','Plus Size Streetwear']])
      +path([['','','Lemon Flavor <span class="j">and</span> Hydration <span class="j">and</span> Powder'],
             ['v-inc','','Always include'],
             ['','','<i class="ty">product</i>IV Hydration'
              +'<i class="ty mt">collection</i>Tropical Variation Pack']])
      +'</div>'));

  /* a supplements quiz — one vertical per figure, so each stays coherent */
  h+=xstep(2,'Top rule wins',
    'Checked top down. The first <b>Show these</b> that matches decides — excludes and pins always apply.',
    '<div class="rulelist">'
    +'<div class="rl lit"><span class="n">1</span><span>Low energy <b>and</b> Vegan → show <b>supp-iron-vegan</b></span><span class="tag">wins</span></div>'
    +'<div class="rl dim"><span class="n">2</span><span>Low energy → show <b>supp-b12</b></span><span class="tag">skipped</span></div>'
    +'<div class="rl lit"><span class="n">3</span><span>Pregnant → exclude <b>supp-herbal</b></span><span class="tag">also applies</span></div>'
    +'<div class="rl dim"><span class="n">4</span><span>Athlete → show <b>supp-electrolyte</b></span><span class="tag">skipped</span></div>'
    +'<div class="rl dim"><span class="n">5</span><span>Sleep support → show <b>supp-magnesium</b></span><span class="tag">skipped</span></div>'
    +'</div>');

  /* …and a clothing quiz here */
  h+=xstep(3,'Rules can be the entire quiz',
    'A quiz can run on rules alone — no question has to touch your products. It suits a catalogue that is already grouped: curated capsules, tagged ranges, bundles, or a short list of hero products.',
    /* ranking belongs to step 2 — this step is only about coverage */
    ledger([['1','Petite <b>and</b> Slim fit','show','tag','fit-petite-slim'],
            ['2','Women&rsquo;s <b>and</b> Slim fit <b>and</b> Petite <b>and</b> Under $80',
             'show','products','Field Trouser · Weekend Jean · Easy Chino'],
            ['3','Wide leg <b>or</b> Relaxed <b>or</b> Straight <b>and</b> Tall',
             'show','tag','fit-roomy'],
            ['4','Sensitive skin','exc','tag','fabric-wool'],
            ['5','Vegan','exc','products','Shearling Coat · Leather Belt'],
            ['6','First order','inc','product','Starter Tee']]));

  h+=xstep(4,'Rules vs. Questions','',
    '<div class="split">'
    +'<div class="sc r"><div class="k2">Rules</div>'+inOutSVG("in")
      +'<h5>Name products in</h5><p>You choose them, by name. Best for hero sets and exceptions.</p></div>'
    +'<div class="sc q"><div class="k2">Questions</div>'+inOutSVG("out")
      +'<h5>Rule products out</h5><p>Your data does the work. Start with a bigger set of products, '
      +'then narrow with tags, metafields and the rest.</p>'
      +'<button class="lnk" data-x="questions">How questions work →</button></div>'
    +'</div>');
  return h;
}

/* =====================================================================
   2 · HOW QUESTIONS WORK
   ===================================================================== */
function node(label,cls,value,sub,src){
  /* the stage label carries the same colour as the box it names, and the box
     names the product data doing the work — a tag, a metafield, a collection */
  return '<div class="fcol'+(cls?' '+cls:'')+'"><span class="plab">'+label+'</span>'
    +'<span class="node'+(cls?' '+cls:'')+'">'
    +(src?'<span class="nsrc">'+src+'</span>':'')+value
    +'<span class="sub">'+sub+'</span></span></div>';
}
function questionsX(){
  var h=xstep(1,'One question, three parts',
    'A question that narrows does one thing: it matches the answer against a piece of your product '
    +'data and keeps only what matches.',
    xfig('<div class="flow">'
      +node('The answer they pick','start','Women&rsquo;s','one answer on &ldquo;Who is it for?&rdquo;')
      +'<span class="sarw">→</span>'
      +node('Matched against','','custom.gender','a metafield your products already carry','metafield')
      +'<span class="sarw">→</span>'
      +node('What survives','end','18 of 32','the other 14 are gone for this shopper')
      +'</div>'));

  h+=xstep(2,'What each question narrows by',
    'One shopper answering down the list. Every switched-on question is wired to one piece of your product data, and the count on the right is what is left after it has had its turn.',
    ledger([['◆','Electrolyte Range','set','collection','18 products','start','<b>18</b>'],
            ['1','What are you using it for?','nar','metafield','custom.use_case',null,drop(6,12)],
            ['2','Any flavours to avoid?','nar','tag','flavor:*',null,drop(3,9)],
            ['3','Powder or ready-to-drink?','nar','variant option','Format',null,drop(3,6)],
            ['4','Caffeine or caffeine-free?','nar','metafield','custom.caffeine',null,drop(2,4)],
            ['5','How did you hear about us?','ask','','collects the answer, changes nothing',null,
             '<b>4</b>']])
    +'<div class="tot">This shopper reaches the results with <b>4 products</b> — and that is what your rules then work with.</div>');

  h+=xstep(3,'Questions vs. Rules','',
    '<div class="split">'
    +'<div class="sc q"><div class="k2">Questions</div>'+inOutSVG("out")
      +'<h5>Rule products out</h5><p>Your data does the work. Start with a bigger set of products, '
      +'then narrow with tags, metafields and the rest.</p></div>'
    +'<div class="sc r"><div class="k2">Rules</div>'+inOutSVG("in")
      +'<h5>Name products in</h5><p>You choose them, by name. Best for hero sets and exceptions.</p>'
      +'<button class="lnk" data-x="rules">How rules work →</button></div>'
    +'</div>');

  h+=xstep(4,'Both together',
    'Questions cut the catalogue down. Your rules then decide what to show out of what is left.',
    xfig('<div class="flow">'
      +node('Starting set','start','Summer Skincare','24 products','collection')
      +'<span class="sarw">→</span>'
      +node('Questions narrow','','Oily · Sensitive','<em>&minus;15</em> · 9 left',
            'metafield · custom.skin_type + tag · concern-*')
      +'<span class="sarw">→</span>'
      +node('Rules decide','','Show quiz-gentle','out of those 9','rule 1')
      +'<span class="sarw">→</span>'
      +node('Results','end','7 products','what this shopper sees')
      +'</div>'));
  return h;
}

/* ---- the little in/out diagram on both closing cards ---- */
function inOutSVG(dir){
  var ok=dir==="in", col=ok?"var(--ok)":"var(--bad)";
  var s='<svg viewBox="0 0 170 46" xmlns="http://www.w3.org/2000/svg">'
   +'<defs><marker id="m'+dir+'" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5.5" markerHeight="5.5" '
   +'orient="auto"><path d="M0 0 L8 4 L0 8 z" style="fill:'+col+'"/></marker></defs>'
   +'<rect x="1" y="4" width="106" height="38" rx="11" style="fill:none;stroke:var(--line);stroke-width:1.4"/>';
  [16,38,60].forEach(function(x){
    s+='<rect x="'+x+'" y="14" width="17" height="17" rx="5.5" style="fill:var(--bar)"/>'});
  s+= ok
    ? '<rect x="82" y="14" width="17" height="17" rx="5.5" style="fill:var(--ok)"/>'
      +'<line x1="166" y1="23" x2="112" y2="23" style="stroke:var(--ok);stroke-width:1.8" marker-end="url(#min)"/>'
    : '<rect x="82" y="14" width="17" height="17" rx="5.5" style="fill:none;stroke:var(--faint2);'
      +'stroke-width:1.5;stroke-dasharray:3 3"/>'
      +'<line x1="116" y1="23" x2="166" y2="23" style="stroke:var(--bad);stroke-width:1.8" marker-end="url(#mout)"/>';
  return s+'</svg>';
}

/* =====================================================================
   SHEET
   ===================================================================== */
var X={
  rules:{badge:'Explainer',title:'How rules work',body:rulesX,
    foot:'Rules alone can be the entire quiz.'},
  questions:{badge:'Explainer',title:'How questions work',body:questionsX,
    foot:'Switch one on and watch the coverage number.'}
};
var xKey=null,xI=0,xH=null,xHW=0;
/* Both explainers, every step, one height: measure the tallest body once per
   width and lock the pane to it, so nothing resizes as you page through and
   the biggest graphic still has air around it. */
function xMeasure(){
  var sb=$("xsheet").querySelector(".sb");if(!sb)return null;
  var keep=sb.innerHTML,keepH=sb.style.height,max=0;
  sb.style.height="auto";
  Object.keys(X).forEach(function(k){
    var d=collect(X[k].body);
    d.steps.forEach(function(st,i){
      sb.innerHTML=(i===0?d.lede:"")+st.html;
      if(sb.scrollHeight>max)max=sb.scrollHeight;
    });
  });
  sb.innerHTML=keep;sb.style.height=keepH;
  return max;
}
function xFit(){
  var sheet=$("xsheet"),sb=sheet.querySelector(".sb");if(!sb)return;
  if(xH===null||xHW!==window.innerWidth){xHW=window.innerWidth;xH=xMeasure()}
  if(!xH)return;
  var chrome=0;
  [".sh",".prog",".foot"].forEach(function(sel){
    var el=sheet.querySelector(sel);if(el)chrome+=el.offsetHeight;
  });
  var room=Math.round(window.innerHeight*0.92)-chrome;
  sb.style.height=Math.max(160,Math.min(xH+30,room))+"px";
}
function progBar(steps){
  var h='<div class="prog">';
  steps.forEach(function(st,i){
    if(i)h+='<span class="pline'+(i<=xI?" done":"")+'"></span>';
    h+='<button class="pstep'+(i===xI?" on":(i<xI?" done":""))+'" data-xgo="'+i+'">'
      +'<span class="pn">'+(i<xI?"✓":st.n)+'</span>'+esc(st.title)+'</button>';
  });
  return h+'</div>';
}
function paintX(){
  var x=X[xKey];if(!x)return;
  var d=collect(x.body),st=d.steps[xI]||{html:""};
  $("xsheet").innerHTML='<div class="sh"><span class="badge">'+SPARK()+esc(x.badge)+'</span>'
    +'<h3>'+esc(x.title)+'</h3><button class="sx" data-close>✕</button></div>'
    +progBar(d.steps)
    +'<div class="sb">'+(xI===0?d.lede:"")+st.html+'</div>'
    +'<div class="foot">'
    +'<span class="ft">'+(xI+1)+' of '+d.steps.length+'</span>'
    +'<button class="fbtn"'+(xI?'':' disabled')+' data-xprev>Back</button>'
    +(xI<d.steps.length-1
      ? '<button class="fbtn pri" data-xnext>Next</button>'
      : '<button class="fbtn pri" data-close>Done</button>')
    +'</div>';
  xFit();
  var sb=$("xsheet").querySelector(".sb");if(sb)sb.scrollTop=0;
}
function openX(k){
  if(!X[k])return;
  xKey=k;xI=0;
  $("xsheet").classList.add("on");$("xscrim").classList.add("on");
  paintX();                 /* visible first, or scrollHeight measures as zero */
}
function xNav(d){var n=collect(X[xKey].body).steps.length;
  xI=Math.max(0,Math.min(n-1,xI+d));paintX()}
function closeX(){$("xsheet").classList.remove("on");$("xscrim").classList.remove("on")}

