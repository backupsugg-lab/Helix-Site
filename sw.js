/* Scramjet v2 service worker. Built-in-engine code is not imported here. */
importScripts("controller/controller.sw.js");
importScripts("hz-cors.js");

const BODYLESS = /^(GET|HEAD)$/i;
const MAX_FALLBACK_BODY = 64 * 1024 * 1024;
const MAX_TAG_BUFFER = 64 * 1024;
const shimOf = (target, over) => new Proxy(target, {
  get(t,k) { if (Object.prototype.hasOwnProperty.call(over,k)) return over[k]; const v=t[k]; return typeof v==="function"?v.bind(t):v; }
});

function resourceName(request) {
  try { const u=new URL(request.url); return (u.origin+u.pathname).slice(0,500); }
  catch (_) { return "(request URL unavailable)"; }
}
function reportFailure(stage,error,request) {
  const message=String(error&&error.message||error||"Unknown error").slice(0,500);
  console.error("[vibecoded proxy Scramjet SW] "+stage+": "+message+" — "+resourceName(request));
}

/* Scan only actual attribute names. Text inside quoted values is left alone. */
function cleanTag(tag) {
  const start=/^<(link|script)(?=[\s/>])/i.exec(tag);
  if (!start) return tag;
  const attributes=[]; let i=start[0].length;
  while(i<tag.length) {
    const begin=i;
    while(i<tag.length&&/\s/.test(tag[i]))i++;
    if(i>=tag.length||tag[i]==='>'||tag[i]==='/'&&tag[i+1]==='>')break;
    const nameStart=i;
    while(i<tag.length&&!/[\s=/>]/.test(tag[i]))i++;
    if(i===nameStart){i++;continue;}
    const name=tag.slice(nameStart,i).toLowerCase();
    while(i<tag.length&&/\s/.test(tag[i]))i++;
    let value='';
    if(tag[i]==='=') {
      i++;while(i<tag.length&&/\s/.test(tag[i]))i++;
      if(tag[i]==='"'||tag[i]==="'") {
        const quote=tag[i++],valueStart=i;
        while(i<tag.length&&tag[i]!==quote)i++;
        value=tag.slice(valueStart,i);if(i<tag.length)i++;
      } else {
        const valueStart=i;while(i<tag.length&&!/[\s>]/.test(tag[i]))i++;
        value=tag.slice(valueStart,i);
      }
    }
    attributes.push({begin,end:i,name,value});
  }
  const stylesheet=start[1].toLowerCase()==='link'&&attributes.some(a=>a.name==='rel'&&a.value.toLowerCase().split(/\s+/).includes('stylesheet'));
  const edits=attributes.filter(a=>a.name==='integrity'||stylesheet&&a.name==='crossorigin');
  for(let n=edits.length-1;n>=0;n--)tag=tag.slice(0,edits[n].begin)+tag.slice(edits[n].end);
  return tag;
}

/* Incremental HTML scanner: raw text and comments are never searched for tags. */
class HtmlSanitizer {
  constructor(){this.buffer='';this.raw=null;this.comment=false;this.longTag=null;}
  feed(text,final=false) {
    this.buffer+=text;let output='';
    for(;;) {
      if(!this.buffer)break;
      if(this.longTag) {
        let i=0,quote=this.longTag.quote,done=false;
        for(;i<this.buffer.length;i++) {
          const ch=this.buffer[i];
          if(quote){if(ch===quote)quote=null;}
          else if(ch==='"'||ch==="'")quote=ch;
          else if(ch==='>'){i++;done=true;break;}
        }
        output+=this.buffer.slice(0,i);this.buffer=this.buffer.slice(i);
        if(done){this.raw=this.longTag.raw;this.longTag=null;continue;}
        this.longTag.quote=quote;break;
      }
      if(this.comment) {
        const end=this.buffer.indexOf('-->');
        if(end<0){const keep=final?0:2;const n=Math.max(0,this.buffer.length-keep);output+=this.buffer.slice(0,n);this.buffer=this.buffer.slice(n);break;}
        output+=this.buffer.slice(0,end+3);this.buffer=this.buffer.slice(end+3);this.comment=false;continue;
      }
      if(this.raw) {
        if(this.raw==='plaintext'){output+=this.buffer;this.buffer='';break;}
        const end=new RegExp('</'+this.raw+'(?=[\\s/>])','i').exec(this.buffer);
        if(!end){const keep=final?0:this.raw.length+4;const n=Math.max(0,this.buffer.length-keep);output+=this.buffer.slice(0,n);this.buffer=this.buffer.slice(n);break;}
        output+=this.buffer.slice(0,end.index);this.buffer=this.buffer.slice(end.index);this.raw=null;
      }
      const less=this.buffer.indexOf('<');
      if(less<0){output+=this.buffer;this.buffer='';break;}
      output+=this.buffer.slice(0,less);this.buffer=this.buffer.slice(less);
      if(this.buffer.startsWith('<!--')){output+='<!--';this.buffer=this.buffer.slice(4);this.comment=true;continue;}
      if(!final&&this.buffer.length<4&&'<!--'.startsWith(this.buffer))break;
      // Only tag-like constructs need quote-aware scanning; literal '<' passes through.
      if(this.buffer.length<2&&!final)break;
      if(!/^<[!/?a-zA-Z]/.test(this.buffer)){output+='<';this.buffer=this.buffer.slice(1);continue;}
      let quote=null,end=-1;
      for(let i=1;i<this.buffer.length;i++) {
        const ch=this.buffer[i];
        if(quote){if(ch===quote)quote=null;}
        else if(ch==='"'||ch==="'")quote=ch;
        else if(ch==='>'){end=i+1;break;}
      }
      if(end<0) {
        if(final){output+=this.buffer;this.buffer='';break;}
        if(this.buffer.length>MAX_TAG_BUFFER){
          const open=/^<(script|style|textarea|title|xmp|iframe|noembed|noframes|plaintext)(?=[\s/>])/i.exec(this.buffer);
          this.longTag={quote,raw:open?open[1].toLowerCase():null};output+=this.buffer;this.buffer='';
        }
        break;
      }
      const tag=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end);
      output+=cleanTag(tag);
      const open=/^<(script|style|textarea|title|xmp|iframe|noembed|noframes|plaintext)(?=[\s/>])/i.exec(tag);
      if(open)this.raw=open[1].toLowerCase();
    }
    if(final&&this.buffer){output+=this.buffer;this.buffer='';}
    return output;
  }
}

function stripIntegrity(res) {
  if(!res||res.status!==200||!res.body||res.bodyUsed||res.type==='opaque'||res.type==='opaqueredirect')return res;
  const type=res.headers.get('content-type')||'';
  if(!/^text\/html(?:\s*;|\s*$)/i.test(type))return res;
  const charset=/charset\s*=\s*["']?([^\s;"']+)/i.exec(type);
  // Re-encode only UTF-8; leave other encodings unchanged rather than corrupt text.
  if(charset&&!/^(utf-8|utf8|us-ascii)$/i.test(charset[1]))return res;
  if(typeof TransformStream==='undefined'||typeof TextDecoder==='undefined'||typeof TextEncoder==='undefined')return res;
  const reader=new HtmlSanitizer(),decoder=new TextDecoder('utf-8',{ignoreBOM:true}),encoder=new TextEncoder();
  const transform=new TransformStream({
    transform(chunk,controller){const text=reader.feed(decoder.decode(chunk,{stream:true}));if(text)controller.enqueue(encoder.encode(text));},
    flush(controller){const text=reader.feed(decoder.decode(),true);if(text)controller.enqueue(encoder.encode(text));}
  });
  const headers=new Headers(res.headers);
  for(const k of ['content-length','content-encoding','etag','content-md5','digest','content-digest'])headers.delete(k);
  headers.set('content-type','text/html; charset=utf-8');
  return new Response(res.body.pipeThrough(transform),{status:res.status,statusText:res.statusText,headers});
}

async function withBody(event) {
  const rq=event.request;
  if(BODYLESS.test(rq.method)||rq.body)return event;
  if(rq.bodyUsed)throw new Error('Request body was consumed before Scramjet routing');
  const declared=Number(rq.headers.get('content-length'))||0;
  if(declared>MAX_FALLBACK_BODY)throw new RangeError('Legacy request-body fallback exceeds 64 MiB');
  const buffer=await rq.clone().arrayBuffer();
  if(buffer.byteLength>MAX_FALLBACK_BODY)throw new RangeError('Legacy request-body fallback exceeds 64 MiB');
  if(!buffer.byteLength)return event;
  return shimOf(event,{request:shimOf(rq,{body:buffer})});
}

try {
  const channel=new BroadcastChannel('hz-sj');channel.postMessage({type:'sw-start'});channel.close();
}catch(_){}
addEventListener('message',()=>{});

async function handleRouted(event) {
  let stage='preflight';
  try {
    const preflight=HzCors.preflight(event.request);
    if(preflight)return preflight;
    stage='request-body fallback';const ev=await withBody(event);
    stage='Scramjet route';const response=await $scramjetController.route(ev);
    if(!response)throw new Error('Controller returned no response');
    stage='HTML response sanitizer';const sanitized=stripIntegrity(response);
    stage='CORS response wrapper';return await HzCors.wrap(sanitized,ev.request);
  }catch(error){
    reportFailure(stage,error,event.request);
    // Fail closed: never retry a routed request using a direct fetch.
    const response=new Response('vibecoded proxy Scramjet request failed during '+stage+'. See the service-worker console for details.',{
      status:error instanceof RangeError?413:502,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}
    });
    try{return await HzCors.wrap(response,event.request);}catch(_){return response;}
  }
}

addEventListener('fetch',event=>{
  let routed;
  try{routed=$scramjetController.shouldRoute(event);}catch(error){
    reportFailure('route classification',error,event.request);event.respondWith(Response.error());return;
  }
  if(routed)event.respondWith(handleRouted(event));
  else {try{HzCors.leak(event.request);}catch(error){reportFailure('unrouted-request diagnostic',error,event.request);}}
});
