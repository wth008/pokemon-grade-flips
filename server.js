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
  const col=await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='card_prices' AND column_name='pristine_warning'`);
  await pool.query(`ALTER TABLE card_prices ADD COLUMN IF NOT EXISTS pristine_warning BOOLEAN NOT NULL DEFAULT FALSE`);
  if(!col.rowCount){
    const keys=JSON.parse(fs.readFileSync(path.join(__dirname,'pristine-research.json'),'utf8'));
    await pool.query('UPDATE card_prices SET pristine_warning=TRUE WHERE card_key=ANY($1::text[])',[keys]);
  }
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

    if(pathname==='/api/prices' && req.method==='GET'){
      if(!pool)return json(res,200,{});
      const r=await pool.query("SELECT card_key, psa9, cgc10, pristine_warning, to_char(updated_at, 'YYYY-MM-DD') AS updated_at FROM card_prices");
      const out={};
      for(const row of r.rows){
        out[row.card_key]={psa9:Number(row.psa9),cgc10:Number(row.cgc10),updated:row.updated_at,pristineWarning:row.pristine_warning};
      }
      return json(res,200,out);
    }

    if(pathname==='/api/prices' && req.method==='POST'){
      if(!pool)return json(res,503,{error:'Database unavailable'});
      const b=await readBody(req);
      if(!b.card_key || typeof b.card_key!=='string')return json(res,400,{error:'card_key required'});
      const psa9=Number(b.psa9)||0,cgc10=Number(b.cgc10)||0;
      const pristineWarning=b.pristineWarning===true;
      const r=await pool.query(
        `INSERT INTO card_prices(card_key,psa9,cgc10,pristine_warning,updated_at)
         VALUES($1,$2,$3,$4,CURRENT_DATE)
         ON CONFLICT(card_key) DO UPDATE SET psa9=EXCLUDED.psa9,cgc10=EXCLUDED.cgc10,pristine_warning=EXCLUDED.pristine_warning,updated_at=CURRENT_DATE
         RETURNING card_key,psa9,cgc10,updated_at`,
        [b.card_key,psa9,cgc10,pristineWarning]
      );
      return json(res,200,{ok:true,row:r.rows[0]});
    }

    if(pathname==='/api/health'){
      if(!pool)return json(res,200,{ok:true,database:false});
      await pool.query('SELECT 1');
      return json(res,200,{ok:true,database:true});
    }

    let p=pathname;
    if(p==='/'||!path.extname(p)) p='/index.html';
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