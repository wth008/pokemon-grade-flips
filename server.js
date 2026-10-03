const http=require('http');
const fs=require('fs');
const path=require('path');
const {Pool}=require('pg');

const root=path.join(__dirname,'public');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
const pool=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL}):null;

async function initDb(){
  if(!pool)return;
  await pool.query(`CREATE TABLE IF NOT EXISTS card_prices (
    card_key TEXT PRIMARY KEY,
    psa9 NUMERIC(12,2) NOT NULL DEFAULT 0,
    cgc10 NUMERIC(12,2) NOT NULL DEFAULT 0,
    updated_at DATE NOT NULL DEFAULT CURRENT_DATE
  )`);
  const col=await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='card_prices' AND column_name='research_status'");
  await pool.query("ALTER TABLE card_prices ADD COLUMN IF NOT EXISTS pristine_warning BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN IF NOT EXISTS research_status TEXT NOT NULL DEFAULT 'not_checked', ADD COLUMN IF NOT EXISTS research_note TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS price_period TEXT NOT NULL DEFAULT ''");
  if(!col.rowCount){
    const research=JSON.parse(fs.readFileSync(path.join(__dirname,'research.json'),'utf8'));
    for(const [key,r] of Object.entries(research)){
      await pool.query('UPDATE card_prices SET pristine_warning=$2, research_status=$3, research_note=$4, price_period=$5 WHERE card_key=$1',[key,r.pristineWarning,r.status,r.note,r.period]);
    }
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS sports_card_prices (
    card_key TEXT PRIMARY KEY,
    raw NUMERIC(12,2) NOT NULL DEFAULT 0,
    cgc9 NUMERIC(12,2) NOT NULL DEFAULT 0,
    cgc10 NUMERIC(12,2) NOT NULL DEFAULT 0,
    warning BOOLEAN NOT NULL DEFAULT FALSE,
    note TEXT NOT NULL DEFAULT '',
    updated_at DATE NOT NULL DEFAULT CURRENT_DATE
  )`);
  console.log('Database ready');
}
function json(res,status,data){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}
function readBody(req){
  return new Promise((resolve,reject)=>{
    let data='';
    req.on('data',c=>{data+=c;if(data.length>1e6){reject(new Error('too large'));req.destroy()}});
    req.on('end',()=>{try{resolve(data?JSON.parse(data):{})}catch(e){reject(e)}});
    req.on('error',reject);
  });
}

const server=http.createServer(async(req,res)=>{
  try{
    const pathname=req.url.split('?')[0];

    if(pathname==='/api/sports-prices' && req.method==='GET'){
      if(!pool)return json(res,200,{});
      const r=await pool.query("SELECT card_key,raw,cgc9,cgc10,warning,note,to_char(updated_at,'YYYY-MM-DD') AS updated FROM sports_card_prices");
      const out={};
      for(const row of r.rows)out[row.card_key]={raw:Number(row.raw),cgc9:Number(row.cgc9),cgc10:Number(row.cgc10),warning:row.warning,note:row.note,updated:row.updated};
      return json(res,200,out);
    }
    if(pathname==='/api/sports-prices' && req.method==='POST'){
      if(!pool)return json(res,503,{error:'Database unavailable'});
      const b=await readBody(req);
      if(typeof b.card_key!=='string'||!b.card_key.startsWith('sports|')||b.card_key.length>300)return json(res,400,{error:'Sports card key required'});
      const prices=['raw','cgc9','cgc10'].map(f=>Number(b[f]??0));
      if(prices.some(v=>!Number.isFinite(v)||v<0||v>=1e10))return json(res,400,{error:'Invalid prices'});
      const note=typeof b.note==='string'?b.note.slice(0,1000):'';
      const r=await pool.query(`INSERT INTO sports_card_prices(card_key,raw,cgc9,cgc10,warning,note,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,CURRENT_DATE)
        ON CONFLICT(card_key) DO UPDATE SET raw=EXCLUDED.raw,cgc9=EXCLUDED.cgc9,cgc10=EXCLUDED.cgc10,warning=EXCLUDED.warning,note=EXCLUDED.note,updated_at=CURRENT_DATE
        RETURNING raw,cgc9,cgc10,warning,note,to_char(updated_at,'YYYY-MM-DD') AS updated`,
        [b.card_key,...prices,b.warning===true,note]);
      const row=r.rows[0];
      return json(res,200,{ok:true,price:{...row,raw:Number(row.raw),cgc9:Number(row.cgc9),cgc10:Number(row.cgc10)}});
    }
    if(pathname==='/api/prices' && req.method==='GET'){
      if(!pool)return json(res,200,{});
      const r=await pool.query("SELECT card_key, psa9, cgc10, pristine_warning, research_status, research_note, price_period, to_char(updated_at, 'YYYY-MM-DD') AS updated_at FROM card_prices");
      const out={};
      for(const row of r.rows){
        out[row.card_key]={psa9:Number(row.psa9),cgc10:Number(row.cgc10),updated:row.updated_at,pristineWarning:row.pristine_warning,researchStatus:row.research_status,researchNote:row.research_note,pricePeriod:row.price_period};
      }
      return json(res,200,out);
    }

    if(pathname==='/api/prices' && req.method==='POST'){
      if(!pool)return json(res,503,{error:'Database unavailable'});
      const b=await readBody(req);
      if(!b.card_key || typeof b.card_key!=='string')return json(res,400,{error:'card_key required'});
      const psa9=Number(b.psa9)||0,cgc10=Number(b.cgc10)||0;
      if(!Number.isFinite(psa9)||!Number.isFinite(cgc10)||psa9<0||cgc10<0)return json(res,400,{error:'Invalid prices'});
      const pristineWarning=typeof b.pristineWarning==='boolean'?b.pristineWarning:null;
      const researchStatus=psa9&&cgc10?'complete':['not_checked','insufficient'].includes(b.researchStatus)?b.researchStatus:'insufficient';
      const researchNote=typeof b.researchNote==='string'?b.researchNote.slice(0,1000):null;
      const pricePeriod=typeof b.pricePeriod==='string'?b.pricePeriod.slice(0,100):null;
      const r=await pool.query(
        `INSERT INTO card_prices(card_key,psa9,cgc10,pristine_warning,research_status,research_note,price_period,updated_at)
         VALUES($1,$2,$3,COALESCE($4,FALSE),$5,COALESCE($6,''),COALESCE($7,''),CURRENT_DATE)
         ON CONFLICT(card_key) DO UPDATE SET psa9=EXCLUDED.psa9,cgc10=EXCLUDED.cgc10,
         pristine_warning=COALESCE($4,card_prices.pristine_warning),research_status=EXCLUDED.research_status,
         research_note=COALESCE($6,card_prices.research_note),price_period=COALESCE($7,card_prices.price_period),updated_at=CURRENT_DATE
         RETURNING card_key,psa9,cgc10,updated_at`,
        [b.card_key,psa9,cgc10,pristineWarning,researchStatus,researchNote,pricePeriod]
      );
      return json(res,200,{ok:true,row:r.rows[0]});
    }

    if(pathname==='/api/health'){
      if(!pool)return json(res,200,{ok:true,database:false});
      await pool.query('SELECT 1');
      return json(res,200,{ok:true,database:true});
    }

    let p=pathname;
    const routes={'/':'/index.html','/sports':'/sports.html','/pokemon':'/pokemon.html','/one-piece':'/empty.html','/other':'/empty.html'};
    p=routes[p.replace(/\/$/,'')||'/']||p;
    if(!path.extname(p)){res.writeHead(404);return res.end('Not found');}
    const file=path.join(root,p);
    if(!file.startsWith(root)){res.writeHead(403);return res.end('Forbidden');}
    fs.readFile(file,(err,data)=>{
      if(err){res.writeHead(404);return res.end('Not found');}
      res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
      res.end(data);
    });
  }catch(err){
    console.error(err);
    json(res,500,{error:'Server error'});
  }
});

const port=process.env.PORT||3000;
initDb().catch(e=>console.error('DB init failed',e)).finally(()=>{
  server.listen(port,'0.0.0.0',()=>console.log('GradeFlip running on',port));
});