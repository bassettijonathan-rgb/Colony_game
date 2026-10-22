// The Lumen look, as GPU programs. Two kinds:
//  - painters, run once per chunk: they paint the ground (albedo), its height and its materials into
//    a layer of a texture array, so the map is painted where you look and kept while it is useful;
//  - the frame passes, run every frame at screen size: height, light (sun, shadows, up to 24 lamps)
//    and the composite (water, mist, colour grading).
export const VS = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;

const NOISE = `
float hash(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec2 h22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float vn(vec2 x){vec2 i=floor(x),f=fract(x);vec2 u=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float s=0.0,a=0.5;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+vec2(17.1,9.3);a*=0.5;}return s/0.9375;}
vec3 noised(vec2 x){vec2 i=floor(x),f=fract(x);vec2 u=f*f*(3.0-2.0*f),du=6.0*f*(1.0-f);float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));return vec3(a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y,du*(vec2(b-a,c-a)+(a-b-c+d)*u.yx));}
`;

// ---------------------------------------------------------------- painters
const PAINT_COMMON = `#version 300 es
precision highp float;precision highp int;
uniform sampler2D uType,uField,uWear;uniform vec2 uOrigin,uLand;uniform float uSpan,uSize,uDetail,uSeed,uMap,uRock;
${NOISE}
vec3 C(float r,float g,float b){return vec3(r,g,b)/255.0;}
int typeAt(vec2 w){ivec2 c=clamp(ivec2(floor(w)),ivec2(0),ivec2(int(uMap)-1));return int(texelFetch(uType,c,0).r*255.0+0.5);}
vec2 warp(vec2 w){w+=(vec2(vn(w*.37+uSeed+9.1),vn(w*.37+vec2(2.7,8.4)+uSeed))-.5)*1.3;return w+(vec2(vn(w*.9+uSeed),vn(w*.9+vec2(5.2,1.3)+uSeed))-.5)*.9;}
float wearAt(vec2 w){return texture(uWear,w/uMap).r;}
// trodden ground, softened and frayed so paths do not follow the tile grid
float wearSoft(vec2 w){vec2 q=w+(vec2(vn(w*1.3+7.0),vn(w*1.3+3.0))-.5)*1.1;return (wearAt(q+vec2(.45,.2))+wearAt(q-vec2(.45,.2))+wearAt(q+vec2(-.2,.45))+wearAt(q-vec2(-.2,.45)))*.25;}
float sdSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);return length(pa-ba*h);}
`;

export const FS_PAINT_ALB = PAINT_COMMON + `
out vec4 o;
vec3 ground(int t,vec2 w){
 float g=fbm(w*.16+uSeed),g2=fbm(w*.55+vec2(5,-3)),g3=vn(w*1.6+vec2(11,0));
 if(t==0||t==8){
  vec3 c=mix(C(60.0,92.0,46.0),C(96.0,126.0,56.0),smoothstep(.3,.7,g));c=mix(c,C(74.0,106.0,48.0),smoothstep(.45,.62,g2)*.5);c=mix(c,C(128.0,134.0,64.0),smoothstep(.58,.78,g2)*.55);
  c=mix(c,C(62.0,102.0,90.0),smoothstep(.6,.8,fbm(w*.045+vec2(31,7)))*.5);   // patches of the local growth: bluer, waxier
  if(t==8)c=mix(c*vec3(.7,.79,.72),C(80.0,64.0,44.0),smoothstep(.52,.8,g2)*.4);
  return c*(.92+g3*.16);}
 if(t==1)return C(128.0,100.0,70.0)*(.86+g2*.24+g3*.08);
 if(t==2)return C(196.0,176.0,134.0)*(.9+g3*.18);
 if(t==3||t==4){float d=texture(uField,w/uMap).b;return mix(C(150.0,138.0,104.0),C(54.0,70.0,64.0),smoothstep(.2,.9,d+(g-.5)*.4));}
 if(t==5){vec3 c=C(82.0,79.0,76.0)*(.78+g*.32+g3*.12);return mix(c,C(128.0,118.0,100.0),smoothstep(.5,.8,g2)*.4);}
 if(t==6)return C(112.0,106.0,96.0)*(.85+g3*.3);
 if(t==7){vec3 c=mix(C(70.0,86.0,58.0),C(46.0,58.0,46.0),smoothstep(.4,.7,g2));return c*(.9+g3*.15);}
 return mix(C(78.0,70.0,60.0),C(112.0,104.0,94.0),smoothstep(.5,.8,g3))*(.9+g*.2);}
void main(){
 vec2 w=uOrigin+gl_FragCoord.xy/uSize*uSpan;
 int t=typeAt(warp(w)+(h22(gl_FragCoord.xy+uSeed)-.5)*.12);
 vec3 col=ground(t,w);
 // brush dabs that follow a flow field, coloured by the ground under each dab's centre
 {float cs=3.8;vec2 cb=floor(w*cs);
 for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
  vec2 c=cb+vec2(i,j);vec2 p=(c+h22(c+uSeed*1.7))/cs;vec2 r2=h22(c+vec2(19.1,7.7));
  float ang=(vn(p*.25)-.5)*3.0+.4,ca=cos(ang),sa=sin(ang);vec2 d=w-p;d=vec2(ca*d.x+sa*d.y,-sa*d.x+ca*d.y);
  float e=length(d/vec2(.08+r2.x*.14,.035+r2.y*.05));
  if(e<1.0){int tp=typeAt(warp(p));vec3 dc=ground(tp,p);float v=(h22(c+3.3).x-.5)*(tp==5?.3:.22);dc*=vec3(1.0+v,1.0+v*.9,1.0+v*.7);
   if(tp==0&&r2.x<.25)dc=mix(dc,C(140.0,150.0,70.0),.25);
   col=mix(col,dc,((tp==3||tp==4)?.25:.42)*smoothstep(1.0,.75,e));}}}
 // rock: faceted, cracked, with lichen
 if(t==5){float s=2.6;vec2 gq=floor(w*s);float f1=9.0,f2=9.0;vec2 id=gq;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 c=gq+vec2(i,j);float d=length(w*s-c-h22(c+41.0));if(d<f1){f2=f1;f1=d;id=c;}else if(d<f2)f2=d;}
  vec3 b=(h22(id).x<.5?C(92.0,88.0,84.0):C(74.0,72.0,70.0))*(.85+h22(id+2.0).y*.3);
  col=mix(col,b*(1.12-f1*.35),.72);col=mix(col,C(38.0,34.0,32.0),smoothstep(.07,.0,f2-f1)*.55);
  float cr=abs(vn(w*2.2+uSeed)-.5);col=mix(col,C(40.0,36.0,34.0),smoothstep(.025,.0,cr)*.5);
  vec2 lc=floor(w*9.0);vec2 lr=h22(lc+3.0);if(lr.x<.16){float ld=length(w*9.0-lc-h22(lc+6.0));col=mix(col,lr.y<.6?C(160.0,170.0,90.0):C(200.0,150.0,70.0),.42*smoothstep(.38,.18,ld));}}
 // sand ripples, wet marsh pools
 if(t==2)col*=.97+.06*(sin((w.y+vn(w*.8)*1.5)*14.0)*.5+.5);
 if(t==7)col=mix(col,C(38.0,50.0,48.0),smoothstep(.6,.7,fbm(w*1.1+3.0))*.6);
 // pebbles and gravel
 {float ps=5.0;vec2 pb=floor(w*ps);
 for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
  vec2 c=pb+vec2(i,j);vec2 p=(c+h22(c+77.7))/ps;int tp=typeAt(warp(p));
  float pr=tp==6?.8:tp==1?.35:tp==9?.3:tp==5?.12:tp==2?.05:0.0;if(h22(c+5.5).x>pr)continue;
  float s=.02+h22(c+9.1).y*(tp==6?.065:.035);vec3 pc=(tp==6||tp==5?C(150.0,142.0,128.0):tp==9?C(70.0,66.0,62.0):C(150.0,128.0,100.0))*(.8+h22(c+1.9).x*.4);
  vec2 d=w-p;float es=length((d-vec2(s*.3,s*.35))*vec2(1.0,1.25));col=mix(col,col*.55,.5*smoothstep(s,s*.7,es));
  float e=length(d*vec2(1.0,1.25));if(e<s){col=mix(col,pc,smoothstep(s,s*.75,e));if(length(d+vec2(s*.3))<s*.4)col=mix(col,vec3(1.0),.18);}}}
 // the landing: soot rays thrown out from the Seed
 {vec2 dl=w-uLand;float l=length(dl);if(l<16.0){float a=atan(dl.y,dl.x);float ray=vn(vec2(a*14.0,l*.35));
  col*=mix(1.0,.66,smoothstep(.5,.8,ray)*smoothstep(10.0,3.0,l));col*=mix(1.0,.84,smoothstep(12.0,5.0,l));}}
 // trodden ground: paths appear where people keep walking
 float wr=wearSoft(w);float pth=smoothstep(.16,.52,wr+(fbm(w*2.5)-.5)*.24);
 if(t!=3&&t!=4&&t!=5)col=mix(col,C(118.0,96.0,70.0)*(.82+fbm(w*4.0)*.32),pth*.85);
 if(uDetail>.5){
  // grass blades
  float bs=6.0;vec2 bb=floor(w*bs);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
   vec2 c=bb+vec2(i,j);vec2 p=(c+h22(c*1.31+uSeed))/bs;int tp=typeAt(warp(p));if(!(tp==0||tp==8||tp==7))continue;
   if(wearAt(p)>.22)continue;
   vec2 r2=h22(c+vec2(3.7,11.1));float lean=(vn(p*.3+9.0)-.5)*1.6,len=(.06+r2.x*.11)*(tp==7?1.6:1.0);
   vec2 tip=p+vec2(sin(lean)*len*.6,-cos(lean)*len);float dd=sdSeg(w,p,tip),wd=r2.y>.7?.016:.021;
   if(dd<wd){float b=clamp(r2.y*.7+fbm(p*.5)*.5,0.0,1.0);vec3 bc=mix(C(46.0,78.0,34.0),C(150.0,170.0,82.0),b);if(fract(r2.x*7.0)<.25)bc=mix(bc,C(170.0,160.0,90.0),.35);
    if(tp==8)bc*=vec3(.78,.84,.8);if(tp==7)bc=mix(bc,C(120.0,130.0,80.0),.35);col=mix(col,bc,.75*smoothstep(wd,wd*.4,dd));}}
  // flowers in drifts
  if(t==0&&fbm(w*.2+40.0)>.52){vec2 fc=floor(w*3.0);vec2 r=h22(fc+99.0);
   if(r.x<.14&&wr<.2){vec2 p=(fc+.2+.6*h22(fc+5.0))/3.0;float k=floor(r.y*5.0);
    vec3 pc=k<1.0?C(244.0,240.0,226.0):k<2.0?C(250.0,214.0,90.0):k<3.0?C(226.0,140.0,190.0):k<4.0?C(170.0,140.0,230.0):C(255.0,170.0,120.0);
    for(int q=0;q<4;q++){float a=float(q)*1.571+r.y*6.0;vec2 pp=p+vec2(cos(a),sin(a))*.035;float d=length(w-pp);
     col=mix(col,pc*.55,.5*smoothstep(.04,.025,length(w-pp-vec2(.01))));col=mix(col,pc,smoothstep(.03,.02,d));}
    col=mix(col,C(255.0,230.0,120.0),smoothstep(.016,.008,length(w-p)));}}
 }
 // big soft blotches of warm and cool, and a little grain
 col*=mix(vec3(1.04,1.02,.97),vec3(.95,.98,1.03),fbm(w*.07+vec2(13,2)));
 col*=1.0+(hash(gl_FragCoord.xy+uSeed)-.5)*.05;
 o=vec4(clamp(col,0.0,1.0),1.0);}`;

// height (r = top/4, g = 1 - base/4) and material (r water, g depth, b roof, a = 1 - shine)
export const FS_PAINT_HM = PAINT_COMMON + `
layout(location=0) out vec4 oH;layout(location=1) out vec4 oM;
void main(){
 vec2 w=uOrigin+gl_FragCoord.xy/uSize*uSpan;
 vec4 f=texture(uField,w/uMap);
 float rk=smoothstep(.42,.58,f.a+(fbm(w*1.7)-.5)*.35);
 float h=0.0;
 if(rk>0.0){float s=2.6;vec2 gq=floor(w*s);float f1=9.0;for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 c=gq+vec2(i,j);f1=min(f1,length(w*s-c-h22(c+41.0)));}
  h=rk*(.5+clamp((f.r-uRock)*10.0,0.0,1.7)+fbm(w*1.3)*.9+(.3-f1*.2));}
 int t=typeAt(warp(w));
 if(t==6||t==1){float ps=5.0;vec2 pb=floor(w*ps);for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 c=pb+vec2(i,j);vec2 p=(c+h22(c+77.7))/ps;
  if(h22(c+5.5).x>(t==6?.8:.35))continue;float s=.02+h22(c+9.1).y*(t==6?.065:.035);float d=length(w-p);if(d<s)h=max(h,s*1.6*sqrt(1.0-d*d/(s*s)));}}
 h=clamp(h,0.0,3.95);
 oH=vec4(h/4.0,h>.015?1.0:0.0,0.0,1.0);
 float wat=smoothstep(.3,.6,f.b*1.8+(vn(w*3.0)-.5)*.25);
 float spec=t==7?.35:(t==2&&f.b>.02?.25:0.0);
 oM=vec4(wat,clamp(f.b*1.15-.12,0.0,1.0),0.0,1.0-spec*.78);}`;

// props (trees, bushes, boulders) stamped into a chunk: one textured quad each
export const VS_SPRITE = `#version 300 es
layout(location=0) in vec4 aPos;layout(location=1) in vec4 aUV;uniform vec2 uOrigin;uniform float uSpan;out vec2 vUV;
void main(){vec2 q=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1));vec2 c=(q-.5)*aPos.z;float cr=cos(aPos.w),sr=sin(aPos.w);c=vec2(cr*c.x-sr*c.y,sr*c.x+cr*c.y);
vec2 w=aPos.xy+c;gl_Position=vec4((w-uOrigin)/uSpan*2.0-1.0,0.0,1.0);vUV=mix(aUV.xy,aUV.zw,q);}`;
export const FS_SPRITE = `#version 300 es
precision highp float;uniform sampler2D uAtlas;in vec2 vUV;out vec4 o;void main(){o=texture(uAtlas,vUV);}`;

// ---------------------------------------------------------------- frame passes
// Where the painted map lives: a chunk's layer when it has been painted, the whole-map overview otherwise.
const LOOKUP = `
uniform sampler2D uTable,uAlbO,uHmO,uMatO;uniform mediump sampler2DArray uAlbA,uHmA,uMatA;uniform float uMap;
const float CHS=32.0;
bool inMap(vec2 w){return w.x>=0.0&&w.y>=0.0&&w.x<uMap&&w.y<uMap;}
int layerAt(vec2 w){return int(texelFetch(uTable,ivec2(floor(w/CHS)),0).r*255.0+0.5)-1;}
vec4 albAt(vec2 w,vec2 gx,vec2 gy){if(!inMap(w))return vec4(.06,.07,.08,1.0);int L=layerAt(w);
 if(L>=0){vec2 uv=(w-floor(w/CHS)*CHS)/CHS;return textureGrad(uAlbA,vec3(uv,float(L)),gx/CHS,gy/CHS);}
 return textureGrad(uAlbO,w/uMap,gx/uMap,gy/uMap);}
vec4 hmAt(vec2 w){if(!inMap(w))return vec4(0.0);int L=layerAt(w);if(L>=0)return texture(uHmA,vec3((w-floor(w/CHS)*CHS)/CHS,float(L)));return texture(uHmO,w/uMap);}
vec4 matAt(vec2 w){if(!inMap(w))return vec4(0.0,0.0,0.0,1.0);int L=layerAt(w);if(L>=0)return texture(uMatA,vec3((w-floor(w/CHS)*CHS)/CHS,float(L)));return texture(uMatO,w/uMap);}
`;

export const FS_H = `#version 300 es
precision highp float;precision highp int;
${LOOKUP}
uniform sampler2D uDH;uniform vec2 uRes;uniform vec4 uCam;out vec4 o;
void main(){vec2 g=gl_FragCoord.xy/uRes;vec2 s=vec2(g.x,1.0-g.y);vec2 w=uCam.xy+s*uCam.zw;
vec4 a=hmAt(w);vec4 b=texture(uDH,s);o=vec4(max(a.rg,b.rg),0.0,1.0);}`;

export const FS_L = `#version 300 es
precision highp float;precision highp int;
${LOOKUP}
uniform sampler2D uH;uniform vec2 uRes,uWind;uniform vec4 uCam;
uniform vec3 uKeyDir,uKeyCol,uAmb;uniform float uNight,uTime,uCloud,uEnc,uPPT;
uniform vec4 uLP[24];uniform vec4 uLC[24];uniform int uNL;out vec4 o;
${NOISE}
vec2 HBL(vec2 s,float l){return textureLod(uH,vec2(s.x,1.0-s.y),l).rg;}
float H(vec2 s){return texture(uH,vec2(s.x,1.0-s.y)).r*4.0;}
void main(){
 vec2 g=gl_FragCoord.xy/uRes;vec2 s=vec2(g.x,1.0-g.y);vec2 w=uCam.xy+s*uCam.zw;vec2 px=1.0/uCam.zw;
 float j=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))));
 float h0=H(s);float e=0.16;
 vec2 gr=vec2(H(s+vec2(e*px.x,0.0))-H(s-vec2(e*px.x,0.0)),H(s+vec2(0.0,e*px.y))-H(s-vec2(0.0,e*px.y)))/(2.0*e);
 gr=clamp(gr,-3.0,3.0);vec3 n=normalize(vec3(-gr,1.0));
 float ao=0.0;
 for(int i=0;i<8;i++){float a=float(i)*0.7853982+j*0.7;vec2 d=vec2(cos(a),sin(a));
  ao+=clamp(H(s+d*0.3*px)-h0,0.0,1.0)*0.55+clamp(H(s+d*0.8*px)-h0,0.0,1.6)*0.3;}
 ao=clamp(1.0-ao*0.16,0.3,1.0);
 vec4 m=matAt(w);float roof=m.b*uNight;
 vec3 L=uKeyDir;float vis=1.0;
 if(uKeyCol.r+uKeyCol.g+uKeyCol.b>0.002){
  float lh=length(L.xy);vec2 dxy=L.xy/max(lh,1e-4);float tanE=L.z/max(lh,1e-3);
  float maxD=clamp(3.4/max(tanE,0.02),1.0,12.0);
  for(int i=0;i<44;i++){float f=(float(i)+j)/44.0;float t=maxD*pow(f,1.35)+0.02;float rh=h0+t*tanE;if(rh>4.0)break;
   float lod=log2(max(1.0,(0.05+0.09*t)*uPPT));vec2 q=HBL(s+dxy*t*px,lod);float top=q.r*4.0,base=(1.0-q.g)*4.0;float pen=0.05+0.05*t;
   float occ=smoothstep(0.0,pen*2.0,top-rh)*(1.0-smoothstep(0.0,pen*2.0,base-rh));vis=min(vis,1.0-occ);}
 }
 float cl=0.0;if(uCloud>0.001){float c=fbm(w*0.045+uWind*uTime);cl=smoothstep(0.5,0.76,c)*uCloud;}
 float sunv=vis*(1.0-0.6*cl);float ndl=max(dot(n,L),0.0);
 vec3 col=uAmb*ao*mix(1.0,0.42,roof)*(0.7+0.3*n.z)+uKeyCol*ndl*sunv*mix(1.0,0.1,roof);
 for(int i=0;i<24;i++){if(i>=uNL)break;vec4 P=uLP[i];vec2 d=P.xy-w;float dist=length(d);if(dist>P.w)continue;
  float att=1.0-dist/P.w;att=att*att/(1.0+dist*dist*0.25);
  vec3 Lv=normalize(vec3(d,max(P.z-h0,0.08)));float nd=max(dot(n,Lv),0.0)*0.75+0.25;float lv=1.0;
  for(int k=0;k<10;k++){float t=(float(k)+j)/10.0;vec2 q=HBL(s+d*t*px,log2(max(1.0,0.12*uPPT*(0.5+dist*(1.0-t)*0.3))));float top=q.r*4.0,base=(1.0-q.g)*4.0;float rh=mix(h0+0.03,P.z,t);
   float occ=smoothstep(0.0,0.15,top-rh)*(1.0-smoothstep(0.0,0.15,base-rh));lv=min(lv,1.0-occ);}
  col+=uLC[i].rgb*att*nd*lv*(0.5+0.5*ao);}
 if(uEnc>0.5)col=sqrt(col/8.0);
 o=vec4(col,sunv);}`;

export const FS_C = `#version 300 es
precision highp float;precision highp int;
${LOOKUP}
uniform sampler2D uDyn,uLight,uH,uKnown;uniform vec2 uRes;uniform vec4 uCam;
uniform float uTime,uExposure,uSat,uMist,uNight,uEnc,uVig,uFogOn;uniform vec3 uKeyDir,uKeyCol,uSky,uFog,uLift,uGain;
uniform vec4 uLP[24];uniform vec4 uLC[24];uniform int uNL;out vec4 o;
${NOISE}
vec3 aces(vec3 x){return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
void main(){
 vec2 g=gl_FragCoord.xy/uRes,s=vec2(g.x,1.0-g.y);
 vec2 w=uCam.xy+s*uCam.zw;vec2 gx=vec2(uCam.z/uRes.x,0.0),gy=vec2(0.0,uCam.w/uRes.y);
 vec4 dy=texture(uDyn,s);vec3 st=albAt(w,gx,gy).rgb;
 vec3 alb=pow(max(st*(1.0-dy.a)+dy.rgb,0.0),vec3(2.2));
 vec2 lp=1.0/vec2(textureSize(uLight,0));vec4 Lt=texture(uLight,g)*0.36+(texture(uLight,g+vec2(0.9,0.6)*lp)+texture(uLight,g+vec2(-0.6,0.9)*lp)+texture(uLight,g+vec2(-0.9,-0.6)*lp)+texture(uLight,g+vec2(0.6,-0.9)*lp))*0.16;vec3 light=uEnc>0.5?Lt.rgb*Lt.rgb*8.0:Lt.rgb;float sunv=Lt.a;
 vec3 col=alb*light;
 vec4 m=matAt(w);float hT=texture(uH,g).r*4.0;
 float wat=smoothstep(0.35,0.65,m.r)*(1.0-smoothstep(0.03,0.1,hT))*(1.0-dy.a);
 if(wat>0.002){float t=uTime;
  vec3 n1=noised(w*vec2(1.1,0.6)+vec2(0.0,-t*0.5));vec3 n2=noised(w*vec2(2.4,1.6)+vec2(t*0.12,-t*0.9)+5.3);vec3 n3=noised(w*5.5+vec2(-t*0.2,-t*1.5)+11.7);
  vec2 gw=n1.yz*0.5+n2.yz*0.35+n3.yz*0.2;vec3 n=normalize(vec3(-gw*0.3,1.0));
  float dep=m.g;vec3 bed=pow(albAt(w+n.xy*0.35,gx,gy).rgb,vec3(2.2));
  vec3 shallow=vec3(0.03,0.12,0.11),deep=vec3(0.004,0.028,0.05);
  vec3 body=mix(bed*vec3(0.3,0.55,0.55),mix(shallow,deep,smoothstep(0.1,1.0,dep)),clamp(smoothstep(0.0,0.6,dep)*0.85+0.15,0.0,1.0));
  vec3 wc=body*light;
  float fres=0.02+(1.0-n.z)*5.0;wc+=uSky*fres*0.5;
  vec3 ng=normalize(vec3(-(gw+noised(w*9.0+vec2(t*0.4,-t*2.0)).yz*0.3)*0.4,1.0));
  vec3 Hh=normalize(uKeyDir+vec3(0.0,0.0,1.0));float sp=pow(max(dot(ng,Hh),0.0),260.0)*sunv;wc+=uKeyCol*sp*(0.6+1.6*(1.0-Hh.z)*4.0);
  for(int i=0;i<24;i++){if(i>=uNL)break;vec4 P=uLP[i];vec2 d=P.xy-w;float dist=length(d);float R=P.w*1.5;if(dist>R)continue;
   vec3 Lv=normalize(vec3(d,P.z+0.6));vec3 Hl=normalize(Lv+vec3(0,0,1));float sl=pow(max(dot(n,Hl),0.0),70.0);wc+=uLC[i].rgb*sl*(1.0-dist/R)*1.4;}
  float fn=vn(w*vec2(3.0,1.4)+vec2(0.0,-t*0.7))*0.6+vn(w*7.0+vec2(t*0.3,-t*1.4))*0.4;
  float foam=smoothstep(0.2,0.0,dep)*smoothstep(0.42,0.72,fn+(0.2-dep)*1.4);
  wc=mix(wc,vec3(0.8,0.86,0.88)*(light*0.85+0.03),foam*0.7);
  col=mix(col,wc,wat);}
 float spec=clamp((1.0-m.a)*1.3,0.0,1.0);
 if(spec>0.01){vec3 Hh=normalize(uKeyDir+vec3(0.0,0.0,1.0));col+=uSky*0.12*spec+uKeyCol*pow(max(Hh.z,0.0),40.0)*0.25*sunv*spec;}
 for(int i=0;i<24;i++){if(i>=uNL)break;float r=uLC[i].a;if(r<=0.0)continue;vec2 d=uLP[i].xy-w;float dd=dot(d,d);col+=uLC[i].rgb*0.3*exp(-dd/(r*r))+uLC[i].rgb*0.05*exp(-dd/(r*r*9.0));}
 if(uMist>0.001){float mp=textureLod(uMatO,w/uMap,3.0).r;float fm=fbm(w*0.085+vec2(uTime*0.035,uTime*0.01));float dens=uMist*smoothstep(0.32,0.8,fm)*(0.4+1.2*mp);col=mix(col,uFog,clamp(dens,0.0,0.8));}
 col*=uExposure;col=aces(col);
 float lum=dot(col,vec3(0.2126,0.7152,0.0722));col=max(mix(vec3(lum),col,uSat),0.0);
 col=col*uGain+uLift*(1.0-col);
 vec2 v=s-0.5;v.x*=uRes.x/uRes.y;col*=clamp(1.0-uVig*dot(v,v)*1.15,0.0,1.0);
 // ground the Seed has not surveyed: seen only from orbit, so drained of colour, dimmer and cold, with a soft ragged edge
 if(uFogOn>0.5){vec2 fw=w+(vec2(vn(w*.21),vn(w*.21+7.3))-.5)*5.0;float kn=texture(uKnown,fw/uMap).r;float fg=1.0-smoothstep(.2,.8,kn);
  if(fg>0.001){float lm=dot(col,vec3(0.2126,0.7152,0.0722));vec3 fc=vec3(lm)*vec3(.6,.7,.86)*.62+vec3(.01,.015,.03);
   float edge=fg*(1.0-fg)*4.0;fc+=vec3(.05,.12,.16)*edge*(.6+.4*sin(uTime*1.5+w.x*.2+w.y*.13))*(1.0-uNight*.5);col=mix(col,fc,fg*.88);}}
 if(!inMap(w))col*=0.25;
 col=pow(col,vec3(1.0/2.2));
 col+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-0.5)/255.0;
 o=vec4(col,1.0);}`;
