// Run with GRADEFLIP_TEST_PASSWORD configured privately. Never logs tokens/passwords.
const crypto=require('node:crypto');
const fs=require('node:fs');
const origin='https://pokemon-grade-flips-production.up.railway.app';
async function request(path,options={}){const r=await fetch(origin+path,{...options,signal:AbortSignal.timeout(30000)});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}return {status:r.status,data,headers:r.headers};}
(async()=>{
 const password=process.env.GRADEFLIP_TEST_PASSWORD;if(!password)throw Error('Test password required');
 const health=await request('/api/research-health');if(!health.data.ready)throw Error('Deployment not ready');console.log('health',health.data);
 const callback='https://chatgpt.com/connector_platform_oauth_redirect';
 const reg=await request('/plugin/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:[callback]})});if(reg.status!==201)throw Error('OAuth registration failed');
 const verifier=crypto.randomBytes(32).toString('base64url');const params=new URLSearchParams({client_id:reg.data.client_id,redirect_uri:callback,response_type:'code',scope:'research:read research:write',resource:origin+'/mcp',code_challenge_method:'S256',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),state:'gradeflip-proof'});
 const form=await request('/plugin/authorize?'+params);if(form.status!==200||typeof form.data!=='string')throw Error('Authorization form unavailable');
 const hidden={};for(const m of form.data.matchAll(/name="(request|expires|signature)" value="([^"]*)"/g))hidden[m[1]]=m[2].replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
 const auth=await request('/plugin/authorize',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...hidden,password})});if(auth.status!==302)throw Error('Owner sign-in failed');const redirect=new URL(auth.headers.get('location'));if(redirect.searchParams.get('state')!=='gradeflip-proof'||redirect.searchParams.get('iss')!==origin)throw Error('OAuth callback mismatch');
 const tokenArgs={grant_type:'authorization_code',client_id:reg.data.client_id,redirect_uri:callback,resource:origin+'/mcp',code:redirect.searchParams.get('code'),code_verifier:verifier};
 const grant=await request('/plugin/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(tokenArgs)});if(grant.status!==200||!grant.data.access_token)throw Error('Token exchange failed');const headers={Authorization:'Bearer '+grant.data.access_token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
 const replay=await request('/plugin/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(tokenArgs)});if(replay.status!==400)throw Error('Authorization code replay accepted');console.log('OAuth sign-in, PKCE, state, issuer and replay protection passed');
 const call=async(method,params={})=>{const r=await request('/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});if(r.status!==200||r.data.error||r.data.result?.isError)throw Error('MCP call failed '+method+': '+JSON.stringify(r.data));return r.data.result;};
 const unauth=await request('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});if(unauth.status!==401)throw Error('Anonymous access not denied');
 await call('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'GradeFlip proof',version:'1'}});console.log('MCP tools',(await call('tools/list')).tools.map(t=>t.name));
 const payload=JSON.parse(fs.readFileSync('proof-batch.json','utf8'));
 const saved=(await call('tools/call',{name:'save_research_batch',arguments:payload})).structuredContent;console.log('saved',saved.saved,'idempotent',saved.idempotent);
 const again=(await call('tools/call',{name:'save_research_batch',arguments:payload})).structuredContent;if(!again.idempotent)throw Error('Repeated batch not idempotent');
 for(const key of saved.keys){const read=(await call('tools/call',{name:'get_researched_card',arguments:{card_key:key}})).structuredContent;const submitted=payload.cards.find(c=>require('./research-model').key(c.card)===key);if(JSON.stringify(read.card)!==JSON.stringify(submitted)){// PostgreSQL JSONB key order is not stable; compare normalized objects.
 const normalize=x=>Array.isArray(x)?x.map(normalize):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,normalize(x[k])])):x;
 if(JSON.stringify(normalize(read.card))!==JSON.stringify(normalize(submitted)))throw Error('Saved evidence mismatch');}
 console.log('read-back',read.card.card.player,read.card.card.number,read.analysis.status);}
 const dashboard=await request('/api/research?limit=5&offset=0',{headers});if(dashboard.status!==200||dashboard.data.cards.length!==5)throw Error('Dashboard API failed');
 const login=await request('/plugin/login',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({password})});if(login.status!==303||!login.headers.get('set-cookie'))throw Error('Dashboard login failed');const cookie=login.headers.get('set-cookie').split(';')[0];if((await request('/api/research?limit=5',{headers:{Cookie:cookie}})).status!==200)throw Error('Dashboard cookie rejected');
 console.log('Dashboard sign-in, five saved cards and exact evidence read-back passed');
 for(const p of ['/api/prices','/api/sports-prices']){const r=await request(p);console.log('legacy',p,Object.keys(r.data).length,crypto.createHash('sha256').update(JSON.stringify(r.data)).digest('hex'));}
 console.log('LIVE PROOF PASSED');
})().catch(e=>{console.error(e.message);process.exitCode=1});
