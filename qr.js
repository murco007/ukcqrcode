(()=>{// QR Code Model 2, version 6, error correction L, byte mode, mask 0.
// Fixed version keeps printable table cards consistent. Capacity: 134 UTF-8 bytes.
function qrMatrix(text){
 const bytes=[...new TextEncoder().encode(text)];if(bytes.length>134)throw new Error('QR URL exceeds version 6-L capacity');
 const bits=[];const put=(v,n)=>{for(let i=n-1;i>=0;i--)bits.push((v>>>i)&1)};
 put(4,4);put(bytes.length,8);bytes.forEach(v=>put(v,8));put(0,Math.min(4,1088-bits.length));while(bits.length%8)bits.push(0);
 const data=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,x)=>a*2+x,0));for(let p=0;data.length<136;p++)data.push(p%2?0x11:0xec);
 const mul=(a,b)=>{let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);z^=((b>>>i)&1)*a}return z};
 let generator=[1];let root=1;for(let i=0;i<18;i++){const next=Array(generator.length+1).fill(0);generator.forEach((v,j)=>{next[j]^=v;next[j+1]^=mul(v,root)});generator=next;root=mul(root,2)}
 const blocks=[data.slice(0,68),data.slice(68)];const ecc=blocks.map(b=>{const rem=Array(18).fill(0);for(const v of b){const factor=v^rem.shift();rem.push(0);for(let j=0;j<18;j++)rem[j]^=mul(generator[j+1],factor)}return rem});
 const code=[];for(let i=0;i<68;i++)for(const b of blocks)code.push(b[i]);for(let i=0;i<18;i++)for(const b of ecc)code.push(b[i]);
 const size=41,m=Array.from({length:size},()=>Array(size).fill(false)),f=Array.from({length:size},()=>Array(size).fill(false));
 const set=(x,y,d)=>{if(x<0||y<0||x>=size||y>=size)return;m[y][x]=!!d;f[y][x]=true};
 for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0)}
 for(const [cx,cy] of [[3,3],[size-4,3],[3,size-4]])for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy));set(cx+dx,cy+dy,d!==2&&d!==4)}
 for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(34+dx,34+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
 // BCH(15,5): L=01, mask=000; XOR with the standard format mask.
 const formatData=8;let rem=formatData;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537);const format=((formatData<<10)|rem)^0x5412;const bit=i=>(format>>>i)&1;
 for(let i=0;i<=5;i++)set(8,i,bit(i));set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));for(let i=9;i<15;i++)set(14-i,8,bit(i));
 for(let i=0;i<8;i++)set(size-1-i,8,bit(i));for(let i=8;i<15;i++)set(8,size-15+i,bit(i));set(8,size-8,true);
 let idx=0;for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vert=0;vert<size;vert++){const y=((right+1)&2)===0?size-1-vert:vert;for(let j=0;j<2;j++){const x=right-j;if(f[y][x])continue;const v=idx<code.length*8?(code[idx>>>3]>>>(7-(idx&7)))&1:0;m[y][x]=!!(v^((x+y)%2===0?1:0));idx++}}}
 if(idx!==1383)throw new Error('QR matrix data module count mismatch: '+idx);
 return m;
}
function qrSvg(text){const m=qrMatrix(text);const path=m.flatMap((row,y)=>row.map((v,x)=>v?'M'+(x+4)+','+(y+4)+'h1v1h-1z':'')).join('');return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 49 49" shape-rendering="crispEdges"><rect width="49" height="49" fill="white"/><path d="'+path+'" fill="#123c33"/></svg>'}

window.qrSvg=qrSvg;})();
