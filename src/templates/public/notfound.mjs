// 404：GitHub Pages 專案頁會以 dist/404.html（= {basePath}/404.html）回應任何不存在的路徑，
// 所以本頁所有連結都必須是含 basePath 的絕對路徑（ctx.url），不能用相對路徑（scripts/lib/check-internal-links.mjs 會檢查）。
// 「你可能在找」：client 端讀 location.pathname，比對 v1/redirects.json（舊網址對照）與 v1/catalog.json（全站內容）的 slug。
import { html, raw, jsonScript } from '../../../scripts/lib/render.mjs';
import { config } from '../../../site.config.mjs';
import { askBox } from './_partials.mjs';

export function meta(ctx) { return { title: ctx.t('404.title'), description: ctx.t('404.title'), noindex: true }; }

export function render(ctx) {
  const { t, url } = ctx;
  const data = {
    base: config.basePath,
    langs: config.langs.map((l) => l.path).filter(Boolean),
    catalog: url('/v1/catalog.json', { noLang: true }),
    redirects: url('/v1/redirects.json', { noLang: true }),
  };
  return html`<section class="c-notfound">
  <p class="c-notfound__code" aria-hidden="true">404</p>
  <h1>${t('404.title')}</h1>
  <p class="lead">${t('404.lead')}</p>
  ${askBox(ctx, { id: 'nq', size: 'md' })}
  <section class="c-notfound__suggest" data-nf-suggest hidden aria-labelledby="nf-h">
    <h2 id="nf-h">你可能在找</h2>
    <ul class="c-linklist c-linklist--q" data-nf-list></ul>
  </section>
  <ul class="c-linklist c-notfound__links">
    <li><a href="${url('/')}">${t('404.home')}</a></li>
    <li><a href="${url('/diseases/')}">${t('nav.diseases')}</a> · <a href="${url('/news/')}">${t('nav.news')}</a> · <a href="${url('/sitemap-page/')}">${t('sitemap')}</a></li>
    <li><a href="${url('/v1/redirects.json', { noLang: true })}">${t('404.redirects')}</a></li>
    <li><a href="tel:1922">${t('404.call')}</a>（防疫專線，國外請撥 ${config.hotlineIntl}）</li>
  </ul>
</section>
<script type="application/json" id="nf-data">${raw(jsonScript(data))}</script>
<script>${raw(CLIENT)}</script>`;
}

// client：相似路徑建議（只用 textContent／href）
const CLIENT = `(function(){
  var el=document.getElementById('nf-data'); if(!el||!window.fetch) return;
  var D; try{D=JSON.parse(el.textContent)}catch(e){return}
  var p=location.pathname; try{p=decodeURIComponent(p)}catch(e){}
  if(D.base && p.indexOf(D.base)===0) p=p.slice(D.base.length)||'/';
  var lang=''; D.langs.forEach(function(l){ if(p===l||p.indexOf(l+'/')===0){ lang=l; p=p.slice(l.length)||'/'; } });
  p=p.replace(/index\\.html?$/,'').replace(/\\.(html?|md|aspx|php)$/i,'').toLowerCase();
  if(!/\\/$/.test(p)) p+='/';
  var segs=p.split('/').filter(Boolean); if(!segs.length) return;
  var last=segs[segs.length-1];
  function lev(a,b){ if(a===b) return 0; var m=a.length,n=b.length; if(!m||!n) return Math.max(m,n); var d=[],i,j; for(j=0;j<=n;j++) d[j]=j;
    for(i=1;i<=m;i++){ var prev=d[0]; d[0]=i; for(j=1;j<=n;j++){ var tmp=d[j]; d[j]=Math.min(d[j]+1,d[j-1]+1,prev+(a[i-1]===b[j-1]?0:1)); prev=tmp; } } return d[n]; }
  function score(path){
    var ps=path.toLowerCase().split('/').filter(Boolean); if(!ps.length) return 0;
    var pl=ps[ps.length-1]; if(path.toLowerCase()===p) return 95;
    var s=0; if(pl===last) s=80; else if(segs.indexOf(pl)>=0) s=70;
    else if(last.length>=3 && (pl.indexOf(last)>=0 || last.indexOf(pl)>=0)) s=60;
    else { var r=1-lev(pl,last)/Math.max(pl.length,last.length); if(r>=0.6) s=Math.round(55*r); }
    if(s && ps[0]===segs[0]) s+=5;
    return s;
  }
  function pathOf(u){ try{ var x=new URL(u,location.href).pathname; if(D.base&&x.indexOf(D.base)===0) x=x.slice(D.base.length); return x; }catch(e){ return null } }
  var get=function(u){ return fetch(u).then(function(r){return r.ok?r.json():null}).catch(function(){return null}) };
  Promise.all([get(D.redirects),get(D.catalog)]).then(function(res){
    var out=[], seen={};
    function add(path,title,s){ if(!path||seen[path]||s<30) return; seen[path]=1; out.push({path:path,title:title,s:s}); }
    var cat=(res[1]&&res[1].data)||[], titleOf={};
    cat.forEach(function(it){ var x=pathOf(it.page); if(x && !titleOf[x]) titleOf[x]=it.title; });
    ((res[0]&&res[0].data)||[]).forEach(function(r){ if(String(r.from).toLowerCase()===p){ var x=pathOf(r.toUrl||r.to); add(x,r.title||titleOf[x]||x,100); } });
    cat.forEach(function(it){ var x=pathOf(it.page); if(x) add(x,it.title,score(x)); });
    out.sort(function(a,b){return b.s-a.s}); out=out.slice(0,5);
    if(!out.length) return;
    var ul=document.querySelector('[data-nf-list]');
    out.forEach(function(o){ var li=document.createElement('li'), a=document.createElement('a'); a.href=(D.base||'')+o.path; a.textContent=o.title||o.path;
      var sm=document.createElement('span'); sm.className='muted'; sm.textContent=' '+o.path; li.appendChild(a); li.appendChild(sm); ul.appendChild(li); });
    document.querySelector('[data-nf-suggest]').hidden=false;
  });
})();`;

export function pages() { return [{ path: '/404.html', file: true, noindex: true, props: {} }]; }
