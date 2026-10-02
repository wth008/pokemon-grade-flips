const http=require('http');
const fs=require('fs');
const path=require('path');
const root=path.join(__dirname,'public');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  let p=req.url.split('?')[0];
  if(p==='/'||!path.extname(p)) p='/index.html';
  const file=path.join(root,p);
  if(!file.startsWith(root)){res.writeHead(403);return res.end('Forbidden');}
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(data);
  });
});
const port=process.env.PORT||3000;
server.listen(port,'0.0.0.0',()=>console.log('GradeFlip running on',port));