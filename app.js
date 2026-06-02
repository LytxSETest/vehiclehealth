geotab.addin.vehicleHealth = () => {

  // ========================= CONFIG (tune here) =========================
  const CONFIG = {
    weights: { DTC:0.30, T:0.20, P:0.15, U:0.15, M:0.10, B:0.10 },
    bands: [ [90,"High risk","vhs-b-high"], [75,"Priority maint.","vhs-b-priority"],
             [60,"Schedule inspection","vhs-b-inspect"], [40,"Monitor","vhs-b-monitor"],
             [0,"Normal","vhs-b-normal"] ],
    maxDevices: 2000, faultLookbackDays: 30, statusLookbackDays: 7, pageSize: 25,
    faultLimit: 50000, exceptionLimit: 50000, dvirLimit: 10000, ruleLimit: 2000, statusLimit: 500,
    batteryFaultKeywords: ["battery","low voltage"],
    deviceFaultKeywords:  ["device","restarted","power was removed","gps","antenna","tamper","telematics"],
    deviceControllerId:   "ControllerGoDeviceId",
    stateMultiplier: { Active:1.0, Pending:0.6, Inactive:0.2 },
    riskServiceNow: 40,
    safetySystemKeywords: ["abs","brake","wheel speed","steering","stability"],
    harshRuleKeywords: ["harsh","aggressive","acceleration","braking","cornering"],
    harshRate: { normal:20, critical:120 },
    idleRatio:    { normal:0.25, critical:0.60 },
    fuel: { factorKgPerL: { gasoline:2.31, diesel:2.68 }, defaultType:"gasoline", idleWasteWarnL:50 },
    signals: {
      coolant:      { id:"DiagnosticEngineCoolantTemperatureId", keyword:"engine coolant temperature", dir:"high", normal:105, critical:120, term:"T" },
      oilTemp:      { keyword:"engine oil temperature", dir:"high", normal:120, critical:140, term:"T" },
      transTemp:    { keyword:"transmission", dir:"high", normal:110, critical:130, term:"T" },
      oilPressure:  { keyword:"oil pressure", dir:"low",  normal:200, critical:80,  term:"P" },
      fuelPressure: { keyword:"fuel rail pressure", dir:"low", normal:300, critical:150, term:"P" },
      boost:        { keyword:"turbo boost", dir:"high", normal:200, critical:300, term:"P" },
      deviceVoltage:{ id:"DiagnosticGoDeviceVoltageId", keyword:"telematics device voltage", dir:"low", normal:12.2, critical:11.4, term:"B" },
      cranking:     { id:"DiagnosticCrankingVoltageId", keyword:"cranking voltage", dir:"low", normal:11.0, critical:9.0, term:"B" },
      oilLife:      { keyword:"oil life", dir:"low", normal:30, critical:5, term:"M" },
      fuelTotal:    { id:"DiagnosticDeviceTotalFuelId", keyword:"total fuel used (since" },
      fuelIdle:     { id:"DiagnosticDeviceTotalIdleFuelId", keyword:"total fuel used while idling" },
      engineHours:  { id:"DiagnosticEngineHoursId", keyword:"engine hours" },
      engineHoursAdj:{ id:"DiagnosticEngineHoursAdjustmentId", keyword:"engine hours" },
      milDistance:  { id:"ak0pLOA92RkSyQDvovh8Afg", keyword:"malfunction indicator lamp (mil) on" },
      distSinceClear:{ id:"aKpyOK5cMZkmSE_isEqk8iA", keyword:"distance traveled since codes cleared" },
      monCatalyst:  { id:"a-dPsmgsMg0OiBKjmQASXWQ", keyword:"catalyst monitor complete" },
      monO2:        { id:"aQlf26vuLj06djxfNj-9rIQ", keyword:"oxygen sensor monitor complete" },
      monEGR:       { id:"a2cJr2HdL9UiQeEcvYL_Wkw", keyword:"egr system monitor complete" },
      monMisfire:   { id:"aDn7Ky78pnUmai2B3dmPmqQ", keyword:"misfire monitor complete" },
      dpfSoot:      { keyword:"particulate filter 1 soot", dir:"high", normal:60, critical:90 },
      defLevel:     { keyword:"diesel exhaust fluid", dir:"low", normal:20, critical:5 },
      noxIn:        { keyword:"nox", dir:"high" }, noxOut: { keyword:"outlet nox", dir:"high" },
    },
  };

  // ========================= pure helpers =========================
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const lc=s=>(s||"").toLowerCase();
  const maxOf=a=>a.length?Math.max.apply(null,a):null;
  const num=v=>(typeof v==="number"&&!isNaN(v))?v:null;

  function signalBadness(val,normal,critical,dir){
    if(val==null||isNaN(val))return null;
    if(dir==="high"){ if(val<=normal)return 0; if(val>=critical)return 100; return clamp((val-normal)/(critical-normal)*100,0,100); }
    if(val>=normal)return 0; if(val<=critical)return 100; return clamp((normal-val)/(normal-critical)*100,0,100);
  }
  function severityToScore(sev){ const s=lc(sev); if(!s)return null;
    if(s.indexOf("redstop")>-1||s.indexOf("severe")>-1||s.indexOf("critical")>-1)return 100;
    if(s.indexOf("protect")>-1)return 70; if(s.indexOf("amber")>-1||s.indexOf("warning")>-1)return 60;
    if(s.indexOf("maintenance")>-1||s.indexOf("none")>-1)return 25; return null; }
  function lampToScore(f){ if(f.redStopLamp)return 100; if(f.protectWarningLamp)return 70;
    if(f.amberWarningLamp||f.malfunctionLamp)return 60; return 0; }
  function stateOf(f){ if(f.faultState)return f.faultState;
    const e=f.faultStates&&f.faultStates.effectiveStatus;
    if(e)return e.indexOf("Pending")>-1?"Pending":e.indexOf("Inactive")>-1?"Inactive":"Active"; return "Active"; }
  function classify(f,name){
    const hay=lc(((f.diagnostic&&f.diagnostic.id)||"")+" "+(name||"")); const hayNS=hay.replace(/\s+/g,"");
    const hit=kws=>kws.some(k=>{k=lc(k); return hay.indexOf(k)>-1||hayNS.indexOf(k.replace(/\s+/g,""))>-1;});
    if(hit(CONFIG.batteryFaultKeywords))return "battery";
    if((f.controller&&f.controller.id===CONFIG.deviceControllerId)||hit(CONFIG.deviceFaultKeywords))return "device";
    return "vehicle";
  }
  function isSafetyFault(name){ return CONFIG.safetySystemKeywords.some(k=>lc(name).indexOf(k)>-1); }

  function groupByDiagnostic(records,nameById){
    const by={};
    records.forEach(f=>{ const id=f.diagnostic&&f.diagnostic.id; if(!id)return;
      const g=by[id]||(by[id]={id,name:nameById[id]||id,occurrences:0,states:{},worstSeverity:null,worstLamp:0,maxRisk:null,safety:false,first:f.dateTime,last:f.dateTime});
      g.occurrences++; const st=stateOf(f); g.states[st]=(g.states[st]||0)+1;
      const sv=severityToScore(f.severity||f.diagnosticSeverity); if(sv!=null)g.worstSeverity=Math.max(g.worstSeverity||0,sv);
      g.worstLamp=Math.max(g.worstLamp,lampToScore(f));
      if(typeof f.riskOfBreakdown==="number")g.maxRisk=Math.max(g.maxRisk||0,f.riskOfBreakdown);
      if(isSafetyFault(g.name))g.safety=true;
      if(f.dateTime<g.first)g.first=f.dateTime; if(f.dateTime>g.last)g.last=f.dateTime; });
    return Object.keys(by).map(k=>by[k]);
  }
  function scoreFaultGroup(g){
    const parts=[]; if(g.worstSeverity!=null)parts.push(g.worstSeverity); if(g.worstLamp>0)parts.push(g.worstLamp); if(g.maxRisk!=null)parts.push(g.maxRisk);
    let badness=parts.length?Math.max.apply(null,parts):15;
    if(g.safety)badness=Math.max(badness,60);  // safety systems never trivial
    const active=g.states.Active||0,pending=g.states.Pending||0,inactive=g.states.Inactive||0;
    const dom=active?"Active":pending?"Pending":"Inactive";
    const mult=CONFIG.stateMultiplier[dom]!=null?CONFIG.stateMultiplier[dom]:1.0;
    const intermittent=(active>0&&inactive>0)||(g.occurrences>=5&&active>0);
    return Object.assign(g,{badness,domState:dom,intermittent,contribution:clamp(badness*mult*(intermittent?1.1:1.0),0,100)});
  }
  function dtcTerm(groups){
    if(!groups.length)return {score:0,items:[]};
    const items=groups.map(scoreFaultGroup);
    const worst=maxOf(items.map(i=>i.contribution))||0;
    const moderate=items.filter(i=>i.contribution>=40).length;
    return {score:clamp(worst+Math.min(20,Math.max(0,moderate-1)*5),0,100),items};
  }

  // ---- term builders ----
  function tempTerm(s){ return maxOf(["coolant","oilTemp","transTemp"].map(k=>{
    const sg=CONFIG.signals[k]; return signalBadness(s[k],sg.normal,sg.critical,sg.dir); }).filter(v=>v!=null)); }
  function pressureTerm(s){ return maxOf(["oilPressure","fuelPressure","boost"].map(k=>{
    const sg=CONFIG.signals[k]; return signalBadness(s[k],sg.normal,sg.critical,sg.dir); }).filter(v=>v!=null)); }
  function usageTerm(s,harshCount){
    const parts=[];
    if(s.fuelTotal!=null&&s.fuelIdle!=null&&s.fuelTotal>0){ const r=s.fuelIdle/s.fuelTotal,c=CONFIG.idleRatio;
      parts.push(r<=c.normal?0:r>=c.critical?100:clamp((r-c.normal)/(c.critical-c.normal)*100,0,100)); }
    if(harshCount!=null){ const h=CONFIG.harshRate;
      parts.push(harshCount<=h.normal?0:harshCount>=h.critical?100:clamp((harshCount-h.normal)/(h.critical-h.normal)*100,0,100)); }
    return parts.length?Math.max.apply(null,parts):null;
  }
  function maintTerm(s,openDefects){
    const parts=[];
    if(openDefects!=null)parts.push(openDefects<=0?0:clamp(40+(openDefects-1)*30,0,100));
    const ol=CONFIG.signals.oilLife; const olb=signalBadness(s.oilLife,ol.normal,ol.critical,ol.dir); if(olb!=null)parts.push(olb);
    if(s.milDistance!=null)parts.push(s.milDistance>0?60:0);
    return parts.length?Math.max.apply(null,parts):null;
  }
  function batteryTerm(s,batteryFaultOcc){
    const parts=[];
    const dv=CONFIG.signals.deviceVoltage; const dvb=signalBadness(s.deviceVoltage,dv.normal,dv.critical,dv.dir); if(dvb!=null)parts.push(dvb);
    const cr=CONFIG.signals.cranking; const crb=signalBadness(s.cranking,cr.normal,cr.critical,cr.dir); if(crb!=null)parts.push(crb);
    if(batteryFaultOcc>0)parts.push(clamp(40+batteryFaultOcc*3,0,100));
    return parts.length?Math.max.apply(null,parts):null;
  }

  function combine(terms){ let w=0,a=0; for(const k in CONFIG.weights){ const v=terms[k]; if(v==null)continue; w+=CONFIG.weights[k]; a+=CONFIG.weights[k]*v; } return w===0?null:a/w; }
  function band(score){ if(score==null)return ["Unknown","vhs-b-unknown"]; for(const b of CONFIG.bands) if(score>=b[0])return [b[1],b[2]]; return ["Normal","vhs-b-normal"]; }
  function disposition(items,batteryScore){
    if(items.some(i=>i.domState==="Active"&&i.worstLamp>=100))return "Remove from service";
    if(items.some(i=>i.domState==="Active"&&(i.worstLamp>=60||(i.worstSeverity||0)>=60||(i.maxRisk||0)>=CONFIG.riskServiceNow||i.safety)))return "Service now";
    let d=items.length?"Monitor":"OK";
    if(items.some(i=>i.domState==="Pending"&&(i.worstSeverity||0)>=25)||items.some(i=>i.domState==="Active"))d="Schedule diagnostic";
    else if(items.some(i=>i.intermittent))d="Watch \u2013 intermittent";
    if((d==="OK"||d==="Monitor")&&batteryScore!=null&&batteryScore>=60)d="Schedule diagnostic";
    return d;
  }

  const DISP_RANK={ "Remove from service":5, "Service now":4, "Schedule diagnostic":3, "Watch \u2013 intermittent":2, "Monitor":1, "OK":0, "Unknown":-1 };
  const dispRank=d=>DISP_RANK[d]!=null?DISP_RANK[d]:0;

  // ---- emissions (Section 2) ----
  function emissionsHealth(s){
    const detail=[], parts=[];
    const milOn = s.milDistance!=null && s.milDistance>0;
    if(milOn){ parts.push(80); detail.push("Check-engine (MIL) on; driven "+Math.round(s.milDistance)+" m with it on"); }
    // heavy-duty aftertreatment
    const dpf=signalBadness(s.dpfSoot,CONFIG.signals.dpfSoot.normal,CONFIG.signals.dpfSoot.critical,"high");
    if(dpf!=null){ parts.push(dpf); detail.push("DPF soot load "+Math.round(s.dpfSoot)+"%"); }
    const def=signalBadness(s.defLevel,CONFIG.signals.defLevel.normal,CONFIG.signals.defLevel.critical,"low");
    if(def!=null){ parts.push(def); detail.push("DEF level "+Math.round(s.defLevel)+"%"); }
    if(s.noxIn!=null&&s.noxOut!=null&&s.noxIn>0){ const ratio=s.noxOut/s.noxIn; const b=ratio<=0.3?0:ratio>=0.8?100:clamp((ratio-0.3)/0.5*100,0,100);
      parts.push(b); detail.push("NOx out/in ratio "+ratio.toFixed(2)+" (SCR efficiency)"); }
    // monitor readiness
    const mons=["monCatalyst","monO2","monEGR","monMisfire"]; let incomplete=0,have=0;
    mons.forEach(k=>{ const v=s[k]; if(v!=null){ have++; if(v===0)incomplete++; } });
    if(incomplete>0){ parts.push(Math.min(30,incomplete*10)); detail.push(incomplete+" of "+have+" OBD monitors incomplete"); }
    const recentClear = s.distSinceClear!=null && s.distSinceClear>=0 && s.distSinceClear<16000; // <~10mi
    if(recentClear && incomplete>0){ parts.push(40); detail.push("Codes cleared recently with monitors not yet complete \u2013 possible masking"); }
    const score = parts.length?Math.max.apply(null,parts):(have>0||milOn===false?0:null);
    let disp="OK";
    if(score==null)disp="Unknown";
    else if(milOn||(dpf!=null&&dpf>=100)||(def!=null&&def>=100))disp="Service emissions system";
    else if((s.noxIn!=null&&s.noxOut!=null)&&score>=60)disp="Check SCR / aftertreatment";
    else if(recentClear&&incomplete>0)disp="Recheck after drive cycle";
    else if(score>=40)disp="Monitor";
    return { score, disp, detail };
  }

  // CO2: windowed per-engine-hour. delta fuel / delta hours over the status window;
  // if the hours delta exceeds windowDays*24 it is in seconds -> /3600 (decision 2).
  function co2Estimate(s,dFuel,dHoursRaw,windowDays){
    const f=CONFIG.fuel.factorKgPerL[CONFIG.fuel.defaultType]||2.31;
    if(s.fuelTotal==null)return null;
    const total=s.fuelTotal*f, idle=(s.fuelIdle!=null?s.fuelIdle:0)*f;
    let perHour=null;
    if(dFuel!=null&&dFuel>0&&dHoursRaw!=null&&dHoursRaw>0){
      let dh=dHoursRaw; if(dh>windowDays*24)dh=dh/3600;
      if(dh>=0.5)perHour=(dFuel*f)/dh;
    }
    return { totalKg:total, idleKg:idle, perHour, perHourDays:windowDays,
             idleWaste: s.fuelIdle!=null && s.fuelIdle>=CONFIG.fuel.idleWasteWarnL };
  }

  // ========================= UI maps =========================
  const PILL={ "Remove from service":"r","Service now":"o","Schedule diagnostic":"a","Watch \u2013 intermittent":"c",
    "Monitor":"t","OK":"g","No data":"x","Unknown":"x",
    "Service emissions system":"r","Check SCR / aftertreatment":"o","Recheck after drive cycle":"a" };
  const BRANK={ "Remove from service":5,"Service now":4,"Schedule diagnostic":3,"Watch \u2013 intermittent":2,"Monitor":1,"OK":0,"Unknown":-1,"No data":-2 };
  const ERANK={ "Service emissions system":4,"Check SCR / aftertreatment":3,"Recheck after drive cycle":2,"Monitor":1,"OK":0,"Unknown":-1,"No data":-2 };
  const SWATCH={ r:"#CF4520", o:"#E87722", a:"#E8A722", c:"#407EC9", t:"#00859B", g:"#84BD00", x:"#98A4AE" };
  const KPI_BD=[
    {id:"urgent",label:"Urgent",cls:"r",set:["Remove from service","Service now"]},
    {id:"schedule",label:"Schedule",cls:"a",set:["Schedule diagnostic"]},
    {id:"watch",label:"Watch & monitor",cls:"t",set:["Watch \u2013 intermittent","Monitor"]},
    {id:"healthy",label:"Healthy",cls:"g",set:["OK"]},
  ];
  const KPI_EM=[
    {id:"service",label:"Service",cls:"r",set:["Service emissions system","Check SCR / aftertreatment"]},
    {id:"recheck",label:"Recheck",cls:"a",set:["Recheck after drive cycle"]},
    {id:"monitor",label:"Monitor",cls:"t",set:["Monitor"]},
    {id:"healthy",label:"Healthy",cls:"g",set:["OK"]},
  ];

  // ========================= state + dom helpers =========================
  let API=null,STATE=null,NAME_BY_ID={},COMPUTED=[],LOADING=false;
  let TAB="breakdown", FILTER=null, FILTER_ID="all", SEARCH="", SORTK="disp", SORTD=-1, PAGE=0;
  const el=id=>document.getElementById(id);
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const setMsg=t=>{ const m=el("vh-status"); if(m)m.innerHTML=t||""; };
  const daysAgo=d=>new Date(Date.now()-d*864e5).toISOString();
  function normGroups(state){ const raw=(state.getGroupFilter&&state.getGroupFilter())||[]; return raw.map(g=>typeof g==="string"?{id:g}:g).filter(g=>g&&g.id); }
  const resolveId=kw=>{ const k=lc(kw); for(const id in NAME_BY_ID) if(lc(NAME_BY_ID[id]).indexOf(k)>-1)return id; return null; };
  const dispOf=r=>TAB==="breakdown"?r.disp:r.em.disp;
  const scoreOf=r=>TAB==="breakdown"?r.score:r.em.score;
  const rankMap=()=>TAB==="breakdown"?BRANK:ERANK;
  const fbClass=v=>v>=75?"r":v>=60?"o":v>=40?"a":"g";

  // ========================= data pipeline =========================
  function run(){
    LOADING=true; const btn=el("vh-refresh"); if(btn)btn.disabled=true;
    showLoading(); setMsg("Loading vehicles, faults and events\u2026");
    const groups=normGroups(STATE); const deviceSearch=groups.length?{groups}:{};
    const winDays=Number(el("vh-window").value)||CONFIG.faultLookbackDays;
    const fFrom=daysAgo(winDays);
    API.multiCall([
      ["Get",{typeName:"Device",search:deviceSearch,resultsLimit:CONFIG.maxDevices}],
      ["Get",{typeName:"FaultData",search:{fromDate:fFrom},resultsLimit:CONFIG.faultLimit}],
      ["Get",{typeName:"ExceptionEvent",search:{fromDate:fFrom},resultsLimit:CONFIG.exceptionLimit}],
      ["Get",{typeName:"DVIRLog",search:{fromDate:fFrom},resultsLimit:CONFIG.dvirLimit}],
      ["Get",{typeName:"Rule",resultsLimit:CONFIG.ruleLimit}],
    ],([devices,faults,exceptions,dvirs,rules])=>{
      LOADING=false; if(btn)btn.disabled=false;
      if(!devices||!devices.length){ COMPUTED=[]; setMsg("No vehicles for the current group filter."); renderAll(); return; }
      const idSet=new Set(devices.map(d=>d.id));
      const harshRuleIds={}; (rules||[]).forEach(r=>{ if(CONFIG.harshRuleKeywords.some(k=>lc(r.name).indexOf(k)>-1))harshRuleIds[r.id]=1; });
      const harshByDev={}; (exceptions||[]).forEach(e=>{ const dv=e.device&&e.device.id, ru=e.rule&&e.rule.id;
        if(dv&&idSet.has(dv)&&ru&&harshRuleIds[ru])harshByDev[dv]=(harshByDev[dv]||0)+1; });
      const defectsByDev={}; (dvirs||[]).forEach(l=>{ const dv=l.device&&l.device.id; if(!dv||!idSet.has(dv))return;
        const list=l.defects||l.dvirDefects||[]; let open=0;
        list.forEach(d=>{ const rs=lc((d&&(d.repairStatus||(d.defect&&d.defect.repairStatus)))||""); if(rs===""||rs.indexOf("notrepaired")>-1||rs.indexOf("repairrequired")>-1)open++; });
        if(l.isSafeToOperate===false&&!list.length)open=Math.max(open,1);
        defectsByDev[dv]=(defectsByDev[dv]||0)+open; });
      const perDev={}; devices.forEach(d=>perDev[d.id]={vehicle:[],battery:[],device:[]});
      const faultDiagIds=[],seen={};
      (faults||[]).forEach(f=>{ const dv=f.device&&f.device.id; if(!dv||!idSet.has(dv))return;
        const id=f.diagnostic&&f.diagnostic.id; if(id&&!seen[id]){seen[id]=1;faultDiagIds.push(id);} });

      const proceed=()=>{
        (faults||[]).forEach(f=>{ const dv=f.device&&f.device.id; if(!dv||!idSet.has(dv))return;
          const name=NAME_BY_ID[(f.diagnostic&&f.diagnostic.id)]||""; perDev[dv][classify(f,name)].push(f); });
        const sigKeys=Object.keys(CONFIG.signals);
        const sigId={}; sigKeys.forEach(k=>{ sigId[k]=CONFIG.signals[k].id||resolveId(CONFIG.signals[k].keyword); });
        const active=sigKeys.filter(k=>sigId[k]);
        const calls=[],idx=[],sFrom=daysAgo(CONFIG.statusLookbackDays);
        devices.forEach(dev=>active.forEach(k=>{ calls.push(["Get",{typeName:"StatusData",
          search:{deviceSearch:{id:dev.id},diagnosticSearch:{id:sigId[k]},fromDate:sFrom},resultsLimit:CONFIG.statusLimit}]); idx.push({dev:dev.id,key:k}); }));
        const firstBy={};
        const finish=latestBy=>{
          COMPUTED=devices.map(dev=>{
            const b=perDev[dev.id], s=latestBy[dev.id]||{}, f0=firstBy[dev.id]||{};
            const dtc=dtcTerm(groupByDiagnostic(b.vehicle,NAME_BY_ID));
            const battOcc=b.battery.length;
            const harsh=harshByDev[dev.id]!=null?harshByDev[dev.id]:null;
            const openDef=defectsByDev[dev.id]!=null?defectsByDev[dev.id]:null;
            const terms={ DTC:dtc.score, T:tempTerm(s), P:pressureTerm(s),
              U:usageTerm(s,harsh), M:maintTerm(s,openDef), B:batteryTerm(s,battOcc) };
            const hasData = b.vehicle.length||b.battery.length||Object.keys(s).length||(harsh&&harsh>0)||(openDef&&openDef>0);
            const dFuel=(s.fuelTotal!=null&&f0.fuelTotal!=null)?s.fuelTotal-f0.fuelTotal:null;
            const hk=s.engineHours!=null?"engineHours":(s.engineHoursAdj!=null?"engineHoursAdj":null);
            const dHours=(hk&&f0[hk]!=null)?s[hk]-f0[hk]:null;
            let score,disp,em,co2;
            if(!hasData){ score=null; disp="No data"; em={score:null,disp:"No data",detail:[]}; co2=null; }
            else { score=combine(terms); disp=score==null?"Unknown":disposition(dtc.items,terms.B);
                   em=emissionsHealth(s); co2=co2Estimate(s,dFuel,dHours,CONFIG.statusLookbackDays); }
            return { id:dev.id, name:dev.name||dev.id, score, terms, disp, items:dtc.items,
              battOcc, deviceFaultCount:b.device.length, harsh:harshByDev[dev.id]||0,
              openDefects:defectsByDev[dev.id]||0, em, co2, noData:!hasData };
          });
          PAGE=0; renderAll();
          setMsg("<b>"+COMPUTED.length+"</b> vehicles \u00b7 "+winDays+"-day window \u00b7 <b>"+active.length+"</b> signals resolved");
        };
        if(!calls.length){ finish({}); return; }
        setMsg("Reading "+calls.length+" signal series\u2026");
        API.multiCall(calls,results=>{ const by={};
          results.forEach((rows,i)=>{ const {dev,key}=idx[i]; if(!rows||!rows.length)return;
            let nw=rows[0], od=rows[0];
            for(const r of rows){ const t=new Date(r.dateTime); if(t>new Date(nw.dateTime))nw=r; if(t<new Date(od.dateTime))od=r; }
            (by[dev]=by[dev]||{})[key]=nw.data; (firstBy[dev]=firstBy[dev]||{})[key]=od.data; });
          finish(by);
        },fail);
      };
      NAME_BY_ID={};
      if(faultDiagIds.length){ API.call("Get",{typeName:"Diagnostic",search:{ids:faultDiagIds}},diags=>{ (diags||[]).forEach(d=>{NAME_BY_ID[d.id]=d.name;}); proceed(); },fail); }
      else proceed();
    },fail);
  }
  function fail(err){ LOADING=false; const b=el("vh-refresh"); if(b)b.disabled=false;
    setMsg("Error: "+(err&&err.message?err.message:String(err))); showError(); console.error("[VehicleHealth]",err); }

  // ========================= rendering =========================
  const pillHTML=d=>'<span class="vh-pill pill-'+(PILL[d]||"x")+'">'+esc(d)+'</span>';
  function scoreCell(v){
    if(v==null)return '<div class="vh-sc na"><span class="n">\u2014</span></div>';
    return '<div class="vh-sc"><span class="n num">'+Math.round(v)+'</span>'
      +'<span class="track"><i class="fb-'+fbClass(v)+'" style="width:'+Math.max(3,Math.round(v))+'%"></i></span></div>';
  }
  const TERMS=[["DTC","D"],["T","T"],["P","P"],["U","U"],["M","M"],["B","B"]];
  function miniBars(terms){
    return '<div class="vh-bars">'+TERMS.map(t=>{ const k=t[0],ch=t[1]; const v=terms?terms[k]:null;
      if(v==null)return '<span class="vh-fb na" title="'+k+': no data"><span class="tk"></span><b>'+ch+'</b></span>';
      return '<span class="vh-fb" title="'+k+': '+Math.round(v)+'"><span class="tk"><i class="fl fb-'+fbClass(v)+'" style="height:'+Math.max(6,Math.round(v))+'%"></i></span><b>'+ch+'</b></span>';
    }).join("")+'</div>';
  }
  function counts(){ const c={}; COMPUTED.forEach(r=>{ const d=dispOf(r); c[d]=(c[d]||0)+1; }); return c; }

  function renderSummary(){
    const wrap=el("vh-summary"); if(!wrap)return;
    const total=COMPUTED.length||1, c=counts();
    const kpis=TAB==="breakdown"?KPI_BD:KPI_EM;
    const cards=kpis.map((k,i)=>{ const n=k.set.reduce((a,d)=>a+(c[d]||0),0); const pct=Math.round(n/total*100);
      const mine=k.set.slice().sort().join("|"); const selSet=FILTER?Array.from(FILTER).sort().join("|"):"";
      const sel=FILTER_ID===("kpi:"+k.id)||(FILTER&&selSet===mine);
      return '<button class="vh-kpi'+(sel?" sel":"")+'" data-kpi="'+k.id+'" style="--kc:'+SWATCH[k.cls]+';animation-delay:'+(i*55)+'ms">'
        +'<span class="kdot"></span><div class="kl">'+k.label+'</div><div class="kn num">'+n+'</div>'
        +'<div class="kp"><b>'+pct+'%</b> of fleet</div></button>'; }).join("");
    const RANK=rankMap();
    const present=Object.keys(c).sort((a,b)=>(RANK[b]!=null?RANK[b]:0)-(RANK[a]!=null?RANK[a]:0));
    const segs=present.map(d=>'<i title="'+esc(d)+': '+c[d]+'" data-seg="'+esc(d)+'" style="width:'+(c[d]/total*100)+'%;background:'+SWATCH[PILL[d]||"x"]+'"></i>').join("");
    const legend=present.map(d=>'<button class="vh-leg" data-seg="'+esc(d)+'"><span class="sw" style="background:'+SWATCH[PILL[d]||"x"]+'"></span>'+esc(d)+' <b>'+c[d]+'</b></button>').join("");
    let co2line="";
    if(TAB==="emissions"){ let kg=0,any=false; COMPUTED.forEach(r=>{ if(r.co2){kg+=r.co2.totalKg;any=true;} });
      co2line=any?'<div class="co2">Fleet CO\u2082 (est) <b>'+(kg>=1000?(kg/1000).toFixed(1)+" t":Math.round(kg)+" kg")+'</b> \u00b7 fuel-derived</div>':""; }
    wrap.innerHTML='<div class="vh-kpis">'+cards+'</div>'
      +'<div class="vh-dist"><div class="vh-dist-top"><span class="t">Fleet distribution</span>'+co2line+'</div>'
      +'<div class="vh-bar">'+segs+'</div><div class="vh-legend">'+legend+'</div></div>';
    wrap.querySelectorAll("[data-kpi]").forEach(b=>b.addEventListener("click",()=>{
      const k=kpis.find(x=>x.id===b.getAttribute("data-kpi"));
      if(FILTER_ID==="kpi:"+k.id){ setFilter("all",null); } else { setFilter("kpi:"+k.id,new Set(k.set)); } }));
    wrap.querySelectorAll("[data-seg]").forEach(b=>b.addEventListener("click",()=>{
      const d=b.getAttribute("data-seg");
      if(FILTER_ID==="seg:"+d){ setFilter("all",null); } else { setFilter("seg:"+d,new Set([d])); } }));
  }
  function renderFilters(){
    const f=el("vh-filters"); if(!f)return; const total=COMPUTED.length, c=counts();
    const RANK=rankMap();
    const present=Object.keys(c).sort((a,b)=>(RANK[b]!=null?RANK[b]:0)-(RANK[a]!=null?RANK[a]:0));
    let html='<button class="vh-fpill'+(FILTER_ID==="all"?" on":"")+'" data-f="all">All<span class="c num">'+total+'</span></button>';
    html+=present.map(d=>'<button class="vh-fpill'+(FILTER_ID==="seg:"+d?" on":"")+'" data-f="'+esc(d)+'">'+esc(d)+'<span class="c num">'+c[d]+'</span></button>').join("");
    f.innerHTML=html;
    f.querySelectorAll("[data-f]").forEach(b=>b.addEventListener("click",()=>{
      const v=b.getAttribute("data-f");
      if(v==="all")setFilter("all",null); else if(FILTER_ID==="seg:"+v)setFilter("all",null); else setFilter("seg:"+v,new Set([v])); }));
  }
  function filtered(){
    let arr=COMPUTED.slice();
    if(SEARCH){ const q=SEARCH.toLowerCase(); arr=arr.filter(r=>r.name.toLowerCase().indexOf(q)>-1); }
    if(FILTER){ arr=arr.filter(r=>FILTER.has(dispOf(r))); }
    const RANK=rankMap();
    const byName=(a,b)=>{ const x=a.name.toLowerCase(),y=b.name.toLowerCase(); return x<y?-1:x>y?1:0; };
    const byRank=(a,b)=>(RANK[dispOf(a)]!=null?RANK[dispOf(a)]:0)-(RANK[dispOf(b)]!=null?RANK[dispOf(b)]:0);
    const byScore=(a,b)=>{ const sa=scoreOf(a),sb=scoreOf(b); return (sa==null?-1:sa)-(sb==null?-1:sb); };
    const byCO2=(a,b)=>{ const sa=a.co2?a.co2.totalKg:-1, sb=b.co2?b.co2.totalKg:-1; return sa-sb; };
    arr.sort((a,b)=>{ let c=SORTK==="name"?byName(a,b):SORTK==="score"?byScore(a,b):SORTK==="co2"?byCO2(a,b):byRank(a,b);
      if(c===0)c=byRank(a,b); if(c===0)c=byScore(a,b); return SORTD*c; });
    return arr;
  }
  function thCell(key,label){ const act=SORTK===key; const ar=act?(SORTD<0?"\u25bc":"\u25b2"):"\u25bc";
    return '<th class="srt'+(act?" act":"")+'" data-srt="'+key+'">'+label+'<span class="ar">'+ar+'</span></th>'; }
  function renderTable(){
    const wrap=el("vh-tablewrap"), pager=el("vh-pager"); if(!wrap)return;
    if(LOADING){ showLoading(); return; }
    if(!COMPUTED.length){ wrap.innerHTML='<div class="vh-state"><div class="ico">\u25CE</div><div class="t">No vehicles to show</div><div class="d">Adjust the group filter in MyGeotab, then Refresh.</div></div>'; if(pager)pager.innerHTML=""; return; }
    const rows=filtered();
    if(!rows.length){ wrap.innerHTML='<div class="vh-state"><div class="ico">\u2315</div><div class="t">No matches</div><div class="d">No vehicles match this filter or search.</div></div>'; if(pager)pager.innerHTML=""; return; }
    const ps=CONFIG.pageSize, pages=Math.ceil(rows.length/ps);
    if(PAGE>=pages)PAGE=pages-1; if(PAGE<0)PAGE=0;
    const slice=rows.slice(PAGE*ps,PAGE*ps+ps);
    let head;
    if(TAB==="breakdown"){
      head='<tr>'+thCell("name","Vehicle")+thCell("score","Score")+thCell("disp","Disposition")+'<th>Risk factors</th><th></th></tr>';
    } else {
      head='<tr>'+thCell("name","Vehicle")+thCell("score","Emissions")+thCell("disp","Disposition")+thCell("co2","CO\u2082 (kg)")+'<th>CO\u2082/hr</th><th></th></tr>';
    }
    const body=slice.map(r=>{
      const flag=r.deviceFaultCount?'<span class="vh-tag vh-tag-dev" title="Telematics device fault recorded \u2014 excluded from score">device</span>':"";
      const veh='<td class="vh-veh"><span class="vh-vehname">'+esc(r.name)+'</span>'+flag+'</td>';
      if(TAB==="breakdown"){
        return '<tr class="vh-tr'+(r.noData?" nodata":"")+'" data-id="'+esc(r.id)+'">'+veh
          +'<td>'+scoreCell(r.score)+'</td><td>'+pillHTML(r.disp)+'</td>'
          +'<td>'+miniBars(r.terms)+'</td><td class="vh-chev">\u203A</td></tr>';
      }
      const ph=r.co2&&r.co2.perHour!=null?('~'+r.co2.perHour.toFixed(1)):"\u2014";
      const tot=r.co2?Math.round(r.co2.totalKg):"\u2014";
      return '<tr class="vh-tr'+(r.noData?" nodata":"")+'" data-id="'+esc(r.id)+'">'+veh
        +'<td>'+scoreCell(r.em.score)+'</td><td>'+pillHTML(r.em.disp)+'</td>'
        +'<td class="num">'+tot+'</td><td class="num vh-muted">'+ph+'</td><td class="vh-chev">\u203A</td></tr>';
    }).join("");
    wrap.innerHTML='<table class="vh-table"><thead>'+head+'</thead><tbody>'+body+'</tbody></table>';
    wrap.querySelectorAll("[data-srt]").forEach(th=>th.addEventListener("click",()=>setSort(th.getAttribute("data-srt"))));
    wrap.querySelectorAll(".vh-tr").forEach(tr=>tr.addEventListener("click",()=>openDrawer(tr.getAttribute("data-id"))));
    if(pager){ const from=PAGE*ps+1, to=Math.min(rows.length,PAGE*ps+ps);
      pager.innerHTML='<span class="pinfo">Showing <b>'+from+'\u2013'+to+'</b> of <b>'+rows.length+'</b></span>'
        +'<button class="vh-pg" id="vh-prev"'+(PAGE<=0?" disabled":"")+'>\u2190 Prev</button>'
        +'<span class="vh-pg-n num">Page '+(PAGE+1)+' / '+pages+'</span>'
        +'<button class="vh-pg" id="vh-next"'+(PAGE>=pages-1?" disabled":"")+'>Next \u2192</button>';
      const p=el("vh-prev"),n=el("vh-next");
      if(p)p.addEventListener("click",()=>{ PAGE--; renderTable(); });
      if(n)n.addEventListener("click",()=>{ PAGE++; renderTable(); }); }
  }
  function renderAll(){
    const ttl=el("vh-panel-title"); if(ttl)ttl.textContent=TAB==="breakdown"?"Vehicle detail":"Emissions detail";
    const cnt=el("vh-count"); if(cnt)cnt.textContent=COMPUTED.length?("\u00b7 "+COMPUTED.length+" total"):"";
    renderSummary(); renderFilters(); renderTable();
  }
  function showLoading(){ const w=el("vh-tablewrap"); if(w)w.innerHTML='<div class="vh-state"><div class="vh-spin"></div><div class="t">Loading fleet data\u2026</div><div class="d">Fetching faults, signals and events from Geotab.</div></div>'; const p=el("vh-pager"); if(p)p.innerHTML=""; const s=el("vh-summary"); if(s)s.innerHTML=""; }
  function showError(){ const w=el("vh-tablewrap"); if(w)w.innerHTML='<div class="vh-state"><div class="ico">\u26A0</div><div class="t">Could not load data</div><div class="d">See the status line above, then try Refresh.</div></div>'; }

  // ---- drawer ----
  function termRow(label,key,terms){ const v=terms?terms[key]:null;
    if(v==null)return '<div class="vh-trm na"><span class="lab">'+label+'</span><span class="tk"></span><span class="v">\u2014</span></div>';
    return '<div class="vh-trm"><span class="lab">'+label+'</span><span class="tk"><i class="fb-'+fbClass(v)+'" style="width:'+Math.max(3,Math.round(v))+'%"></i></span><span class="v">'+Math.round(v)+'</span></div>'; }
  function breakdownDrawer(r){
    const w=CONFIG.weights;
    const terms='<div class="vh-sec"><div class="h">Risk factors (weight)</div><div class="vh-terms">'
      +termRow("DTC \u00b7 "+(w.DTC*100)+"%","DTC",r.terms)+termRow("Temp \u00b7 "+(w.T*100)+"%","T",r.terms)
      +termRow("Pressure \u00b7 "+(w.P*100)+"%","P",r.terms)+termRow("Usage \u00b7 "+(w.U*100)+"%","U",r.terms)
      +termRow("Maint \u00b7 "+(w.M*100)+"%","M",r.terms)+termRow("Battery \u00b7 "+(w.B*100)+"%","B",r.terms)+'</div></div>';
    const frows=r.items.length?r.items.map(i=>'<tr><td>'+esc(i.name)+(i.safety?' \u26a0':'')+'</td><td>'+i.domState+(i.intermittent?' \u00b7 intermittent':'')
      +'</td><td class="num">'+(i.worstSeverity!=null?Math.round(i.worstSeverity):"\u2014")+'</td><td class="num">'+(i.maxRisk!=null?i.maxRisk.toFixed(1)+"%":"\u2014")
      +'</td><td class="num">'+i.occurrences+'</td><td class="num">'+Math.round(i.contribution)+'</td></tr>').join("")
      :'<tr><td colspan="6" class="vh-muted">No vehicle ECU faults in window.</td></tr>';
    const faults='<div class="vh-sec"><div class="h">Diagnostic faults</div><table class="vh-dtable"><thead><tr><th>Fault</th><th>State</th><th>Sev</th><th>Risk</th><th>Count</th><th>Score</th></tr></thead><tbody>'+frows+'</tbody></table></div>';
    const notes=[];
    if(r.battOcc)notes.push("Electrical: "+r.battOcc+" battery / low-voltage record(s) \u2192 Battery term.");
    if(r.harsh)notes.push("Harsh-driving events in window: "+r.harsh+" \u2192 Usage term.");
    if(r.openDefects)notes.push("Open DVIR defect(s): "+r.openDefects+" \u2192 Maintenance term.");
    if(r.deviceFaultCount)notes.push("Telematics device records: "+r.deviceFaultCount+" (excluded from score).");
    const ns=notes.length?'<div class="vh-sec"><div class="h">Notes</div>'+notes.map(n=>'<div class="vh-li">'+esc(n)+'</div>').join("")+'</div>':"";
    return terms+faults+ns;
  }
  function emissionsDrawer(r){
    const lines=r.em.detail.length?r.em.detail.map(d=>'<div class="vh-li">'+esc(d)+'</div>').join(""):'<div class="vh-li vh-muted">No emissions issues detected from available signals.</div>';
    let co2="";
    if(r.co2){ const ph=r.co2.perHour!=null?('<br><b>~'+r.co2.perHour.toFixed(1)+' kg CO\u2082 / engine-hour</b> (last '+r.co2.perHourDays+' days)'):"";
      co2='<div class="vh-sec"><div class="h">Carbon estimate</div><div class="vh-callout">'
        +'<b>'+Math.round(r.co2.totalKg)+' kg</b> total \u00b7 <b>'+Math.round(r.co2.idleKg)+' kg</b> from idling'
        +(r.co2.idleWaste?' \u26a0 high idle waste':'')+ph
        +'<br><span class="vh-muted">Fuel-derived estimate. Use the Geotab Sustainability Center for certified figures.</span></div></div>'; }
    return '<div class="vh-sec"><div class="h">Findings</div>'+lines+'</div>'+co2;
  }
  function openDrawer(id){
    const r=COMPUTED.find(x=>x.id===id); if(!r)return;
    const sc=TAB==="breakdown"?r.score:r.em.score, disp=TAB==="breakdown"?r.disp:r.em.disp;
    const col=SWATCH[fbClass(sc==null?0:sc)];
    const body=TAB==="breakdown"?breakdownDrawer(r):emissionsDrawer(r);
    el("vh-drawer").innerHTML='<div class="vh-drawer-head"><div class="row1"><div>'
      +'<h3>'+esc(r.name)+'</h3><div class="sub">'+(TAB==="breakdown"?"Breakdown risk":"Emissions health")
      +(r.deviceFaultCount?' \u00b7 device fault present':'')+'</div></div>'
      +'<button class="vh-x" id="vh-dx" aria-label="Close">\u2715</button></div>'
      +'<div class="meta"><span class="vh-bigscore" style="color:'+(sc==null?"#9aa3c4":col)+'">'+(sc==null?"\u2014":Math.round(sc))+'</span>'+pillHTML(disp)+'</div></div>'
      +'<div class="vh-drawer-body">'+body+'</div>';
    el("vh-dx").addEventListener("click",closeDrawer);
    el("vh-drawer").classList.add("on"); el("vh-scrim").classList.add("on");
  }
  function closeDrawer(){ el("vh-drawer").classList.remove("on"); el("vh-scrim").classList.remove("on"); }

  // ---- controls ----
  function setTab(t){ if(TAB===t)return; TAB=t; FILTER=null; FILTER_ID="all"; PAGE=0; SORTK="disp"; SORTD=-1;
    el("vh-tab-bd").classList.toggle("on",t==="breakdown"); el("vh-tab-em").classList.toggle("on",t==="emissions"); renderAll(); }
  function setFilter(id,set){ FILTER_ID=id; FILTER=set; PAGE=0; renderSummary(); renderFilters(); renderTable(); }
  function setSort(k){ if(SORTK===k){ SORTD=-SORTD; } else { SORTK=k; SORTD=(k==="name")?1:-1; } PAGE=0; renderTable(); }
  function exportCSV(){
    const rows=filtered(); if(!rows.length)return;
    const q=s=>'"'+String(s==null?"":s).replace(/"/g,'""')+'"';
    let head,line;
    if(TAB==="breakdown"){ head=["Vehicle","Score","Disposition","DTC","Temp","Pressure","Usage","Maintenance","Battery","Device faults"];
      line=r=>[r.name,r.score==null?"":Math.round(r.score),r.disp,
        r.terms.DTC==null?"":Math.round(r.terms.DTC),r.terms.T==null?"":Math.round(r.terms.T),r.terms.P==null?"":Math.round(r.terms.P),
        r.terms.U==null?"":Math.round(r.terms.U),r.terms.M==null?"":Math.round(r.terms.M),r.terms.B==null?"":Math.round(r.terms.B),r.deviceFaultCount]; }
    else { head=["Vehicle","Emissions score","Disposition","CO2 total kg","CO2 idle kg","CO2 per engine-hour","Findings"];
      line=r=>[r.name,r.em.score==null?"":Math.round(r.em.score),r.em.disp,
        r.co2?Math.round(r.co2.totalKg):"",r.co2?Math.round(r.co2.idleKg):"",r.co2&&r.co2.perHour!=null?r.co2.perHour.toFixed(2):"",
        (r.em.detail||[]).join("; ")]; }
    const csv=[head.map(q).join(",")].concat(rows.map(r=>line(r).map(q).join(","))).join("\r\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob); const a=document.createElement("a");
    a.href=url; a.download="vehicle-health-"+TAB+".csv"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  // ========================= lifecycle =========================
  return {
    initialize(api,state,callback){ API=api; STATE=state;
      try{
        const on=(id,ev,fn)=>{ const e=el(id); if(e)e.addEventListener(ev,fn); };
        const w=el("vh-window"); if(w)w.value=String(CONFIG.faultLookbackDays);
        on("vh-refresh","click",run);
        on("vh-window","change",run);
        on("vh-tab-bd","click",()=>setTab("breakdown"));
        on("vh-tab-em","click",()=>setTab("emissions"));
        on("vh-export","click",exportCSV);
        on("vh-scrim","click",closeDrawer);
        document.addEventListener("keydown",e=>{ if(e.key==="Escape")closeDrawer(); });
        const si=el("vh-search"); let t=null;
        if(si)si.addEventListener("input",()=>{ SEARCH=si.value.trim(); PAGE=0; clearTimeout(t); t=setTimeout(renderTable,120); });
      }catch(e){ console.error("[VehicleHealth] init",e); }
      if(callback)callback();
    },
    focus(api,state){ API=api; STATE=state; run(); },
    blur(){ closeDrawer(); }
  };
};
