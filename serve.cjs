const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const html=path.join(__dirname,'configurator-mobilier.html');
const server=http.createServer((request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname!=='/' && pathname!=='/configurator-mobilier.html'){
    response.writeHead(404);response.end();return;
  }
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  fs.createReadStream(html).pipe(response);
});
server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port+'/configurator-mobilier.html'));
