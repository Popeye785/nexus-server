const express=require('express');
const crypto=require('crypto');
const https=require('https');
const app=express();
app.use(express.json());
app.use((req,res,next)=>{
res.header('Access-Control-Allow-Origin','*');
res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS');
res.header('Access-Control-Allow-Headers','Content-Type');
if(req.method==='OPTIONS')return res.sendStatus(200);
next();
});
function sign(ts,method,path,body,secret){
const msg=ts+method.toUpperCase()+path+(body||'');
return crypto.createHmac('sha256',secret).update(msg).digest('base64');
}
async function bg(method,path,body,key,secret,pass){
const ts=Date.now().toString();
const bs=body?JSON.stringify(body):'';
const sig=sign(ts,method,path,bs,secret);
return new Promise((resolve,reject)=>{
const opts={hostname:'api.bitget.com',path,method,headers:{'Content-Type':'application/json','ACCESS-KEY':key,'ACCESS-SIGN':sig,'ACCESS-TIMESTAMP':ts,'ACCESS-PASSPHRASE':pass}};
const req=https.request(opts,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({error:'parse error'})}})});
req.on('error',reject);
if(bs)req.write(bs);
req.end();
});
}
app.get('/',(req,res)=>res.json({status:'NEXUS Server OK',time:new Date().toISOString()}));
app.post('/api/balance',async(req,res)=>{
const{apiKey,secretKey,passphrase}=req.body;
if(!apiKey)return res.json({error:'Keys fehlen'});
try{const r=await bg('GET','/api/v2/spot/account/assets',null,apiKey,secretKey,passphrase);res.json(r);}
catch(e){res.json({error:e.message});}
});
app.post('/api/order/buy',async(req,res)=>{
const{apiKey,secretKey,passphrase,symbol,amount}=req.body;
try{const r=await bg('POST','/api/v2/spot/trade/place-order',{symbol:symbol||'BTCUSDT',side:'buy',orderType:'market',force:'gtc',size:amount.toString()},apiKey,secretKey,passphrase);res.json(r);}
catch(e){res.json({error:e.message});}
});
app.post('/api/order/sell',async(req,res)=>{
const{apiKey,secretKey,passphrase,symbol,amount}=req.body;
try{const r=await bg('POST','/api/v2/spot/trade/place-order',{symbol:symbol||'BTCUSDT',side:'sell',orderType:'market',force:'gtc',size:amount.toString()},apiKey,secretKey,passphrase);res.json(r);}
catch(e){res.json({error:e.message});}
});
app.post('/api/orders/history',async(req,res)=>{
const{apiKey,secretKey,passphrase,symbol}=req.body;
try{const r=await bg('GET',`/api/v2/spot/trade/history-orders?symbol=${symbol||'BTCUSDT'}&limit=20`,null,apiKey,secretKey,passphrase);res.json(r);}
catch(e){res.json({error:e.message});}
});
const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log(`NEXUS Server läuft auf Port ${PORT}`));
