import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

export function SignaturePad({ onChange }: { onChange: (blob: Blob | null) => void }) {
  const ref=useRef<HTMLCanvasElement|null>(null);
  const drawing=useRef(false);
  useEffect(()=>{
    const c=ref.current;if(!c)return;
    const dpr=Math.max(1,window.devicePixelRatio||1);
    const rect=c.getBoundingClientRect();
    c.width=rect.width*dpr;c.height=rect.height*dpr;
    const ctx=c.getContext("2d");if(!ctx)return;
    ctx.scale(dpr,dpr);ctx.lineWidth=2;ctx.lineCap="round";ctx.strokeStyle="#111";
  },[]);
  const point=(e:PointerEvent)=>{
    const c=ref.current;if(!c)return {x:0,y:0};
    const r=c.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};
  };
  const clear=()=>{const c=ref.current;if(!c)return;const ctx=c.getContext("2d");if(!ctx)return;ctx.clearRect(0,0,c.width,c.height);onChange(null);};
  const finish=()=>ref.current?.toBlob((b)=>onChange(b),"image/png");
  return <div>
    <div className="rounded-md border bg-white">
      <canvas ref={ref} className="h-32 w-full touch-none" onPointerDown={e=>{drawing.current=true;const p=point(e.nativeEvent);const ctx=ref.current?.getContext("2d");ctx?.beginPath();ctx?.moveTo(p.x,p.y);}} onPointerMove={e=>{if(!drawing.current)return;const p=point(e.nativeEvent);const ctx=ref.current?.getContext("2d");ctx?.lineTo(p.x,p.y);ctx?.stroke();}} onPointerUp={()=>{drawing.current=false;finish();}} onPointerLeave={()=>{if(drawing.current){drawing.current=false;finish();}}}/>
    </div>
    <Button type="button" variant="ghost" size="sm" onClick={clear} className="mt-1"><RotateCcw className="h-3.5 w-3.5"/> Clear signature</Button>
  </div>
}
