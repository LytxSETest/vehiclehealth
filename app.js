geotab.addin.vehicleHealth = () => {

  // ========================= CONFIG (tune here) =========================
  const CONFIG = {
    weights: { DTC:0.30, T:0.20, P:0.15, U:0.15, M:0.10, B:0.10 },
    bands: [ [90,"High risk","vhs-b-high"], [75,"Priority maint.","vhs-b-priority"],
             [60,"Schedule inspection","vhs-b-inspect"], [40,"Monitor","vhs-b-monitor"],
             [0,"Normal","vhs-b-normal"] ],
    maxDevices: 2000, faultLookbackDays: 30, statusLookbackDays: 7, statusLookbackFastDays: 3, statusLookbackSlowDays: 30, pageSize: 25,
    faultLimit: 50000, exceptionLimit: 50000, dvirLimit: 10000, ruleLimit: 2000, statusLimit: 500,
    batteryFaultKeywords: ["battery","low voltage"],
    deviceFaultKeywords:  ["device","restarted","power was removed","gps","antenna","tamper","telematics"],
    deviceControllerId:   "ControllerGoDeviceId",
    stateMultiplier: { Active:1.0, Pending:0.6, Inactive:0.2 },
    riskServiceNow: 40,
    safetySystemKeywords: ["abs","brake","wheel speed","steering","stability"],
    harshRuleKeywords: ["harsh","aggressive","acceleration","braking","cornering"], // fallback for custom-named rules
    harshRuleIds: ["RuleHarshBrakingId","RuleHarshCorneringId","RuleJackrabbitStartsId",
                   "RuleHarshGpsBrakingId","RuleHarshGpsAccelerationId","RuleHarshGpsCorneringId"], // built-in harsh maneuvers (speeding excluded)
    decodeVinDetails: true,  // call Geotab DecodeVins to enrich the drawer with engine/trim/GVWR (cached, fail-soft)
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
      predictedRisk:{ id:"DiagnosticPredictedRiskOfBreakdownId", keyword:"predicted breakdown risk" }, // Geotab's own model (info only, not scored)
    },
    // ---- usage / harsh normalisation ----
    staleHours: 48,                           // a device not reporting for longer than this counts as "Offline"
    // ---- scale + UI ----
    tripLimit: 50000,
    statusLimitPerDiagnostic: 50000, // cap per diagnostic-wide StatusData query (scales by signal, not by vehicle)
    sectionPreviewRows: 25,          // rows shown per action group before "show more"
    defaultCollapsedActions: ["Monitor","OK","No data"], // groups collapsed on first load
    rootGroupIds: ["GroupCompanyId"],// excluded from group labels / rollup (every vehicle is in it)
    maxGroups: 5000,
    persistKey: "vh.v4",             // localStorage namespace (per-database key appended at runtime)
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
  // Geotab names unrecognized SPN/FMI codes like "**Unknown Diagnostic 521940" - make that readable.
  function cleanDiagName(nm,id){
    let s=String(nm==null?"":nm).replace(/\*/g,"").trim();
    const m=s.match(/unknown diagnostic\s*([0-9]+)/i);
    if(m) return "Unrecognized engine fault \u00b7 code "+m[1];
    if(s) return s;
    return "Unrecognized engine fault";
  }

  function groupByDiagnostic(records,nameById){
    const by={};
    records.forEach(f=>{ const id=f.diagnostic&&f.diagnostic.id; if(!id)return;
      const g=by[id]||(by[id]={id,name:cleanDiagName(nameById[id],id),occurrences:0,states:{},worstSeverity:null,worstLamp:0,maxRisk:null,safety:false,first:f.dateTime,last:f.dateTime});
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
  function usageTerm(s,harshCount,ctx){
    ctx=ctx||{}; const parts=[];
    // idle: prefer trip idle-TIME ratio (idle / (idle+drive)); fall back to fuel idle ratio
    let idleRatio=null;
    if(ctx.idleSec!=null && ctx.driveSec!=null && (ctx.idleSec+ctx.driveSec)>0) idleRatio=ctx.idleSec/(ctx.idleSec+ctx.driveSec);
    else if(s.fuelTotal!=null && s.fuelIdle!=null && s.fuelTotal>0) idleRatio=s.fuelIdle/s.fuelTotal;
    if(idleRatio!=null){ const c=CONFIG.idleRatio;
      parts.push(idleRatio<=c.normal?0:idleRatio>=c.critical?100:clamp((idleRatio-c.normal)/(c.critical-c.normal)*100,0,100)); }
    // harsh: raw event count over the window (Trip still supplies the idle-time ratio above and mileage for display)
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


  // ========================= UI model =========================
  // Ordered actions, most urgent first. Each carries a label, colour class, icon and plain-English meaning.
  const ACTIONS_BD = [
    { id:"Remove from service",     short:"Remove from service", cls:"r", icon:"alert",    desc:"Critical fault active \u2014 take out of service" },
    { id:"Service now",             short:"Service now",          cls:"o", icon:"wrench",   desc:"Active fault needs prompt repair" },
    { id:"Schedule diagnostic",     short:"Schedule diagnostic",  cls:"a", icon:"calendar", desc:"Pending fault or weak battery \u2014 book a check" },
    { id:"Watch \u2013 intermittent", short:"Watch",              cls:"c", icon:"eye",      desc:"Comes and goes \u2014 keep an eye on it" },
    { id:"Monitor",                 short:"Monitor",              cls:"t", icon:"pulse",    desc:"Minor signals \u2014 no action yet" },
    { id:"OK",                      short:"OK",                   cls:"g", icon:"check",    desc:"No issues detected" },
    { id:"No data",                 short:"No data",              cls:"x", icon:"dash",     desc:"No engine data reporting" },
    { id:"Unknown",                 short:"Unknown",              cls:"x", icon:"dash",     desc:"Could not compute" },
  ];
  const ACTIONS_EM = [
    { id:"Service emissions system",   short:"Service emissions",   cls:"r", icon:"alert",    desc:"Check-engine light on or aftertreatment fault" },
    { id:"Check SCR / aftertreatment", short:"Check SCR",           cls:"o", icon:"wrench",   desc:"Aftertreatment efficiency looks low" },
    { id:"Recheck after drive cycle",  short:"Recheck",             cls:"a", icon:"calendar", desc:"Monitors not complete \u2014 recheck after a drive" },
    { id:"Monitor",                    short:"Monitor",             cls:"t", icon:"pulse",    desc:"Minor emissions signals" },
    { id:"OK",                         short:"OK",                  cls:"g", icon:"check",    desc:"No emissions issues detected" },
    { id:"No data",                    short:"No data",             cls:"x", icon:"dash",     desc:"No emissions data reporting" },
    { id:"Unknown",                    short:"Unknown",             cls:"x", icon:"dash",     desc:"Could not compute" },
  ];
  const actionsFor = () => TAB==="breakdown" ? ACTIONS_BD : ACTIONS_EM;
  const actionMeta = id => (actionsFor().find(a=>a.id===id)) || { id, short:id, cls:"x", icon:"dash", desc:"" };

  // KPI cards = grouped action buckets (the single filter mechanism).
  const KPI_BD = [
    { id:"urgent",  label:"Urgent",          cls:"r", set:["Remove from service","Service now"] },
    { id:"schedule",label:"Schedule",        cls:"a", set:["Schedule diagnostic"] },
    { id:"watch",   label:"Watch & monitor", cls:"t", set:["Watch \u2013 intermittent","Monitor"] },
    { id:"healthy", label:"Healthy",         cls:"g", set:["OK"] },
  ];
  const KPI_EM = [
    { id:"service", label:"Service",  cls:"r", set:["Service emissions system","Check SCR / aftertreatment"] },
    { id:"recheck", label:"Recheck",  cls:"a", set:["Recheck after drive cycle"] },
    { id:"monitor", label:"Monitor",  cls:"t", set:["Monitor"] },
    { id:"healthy", label:"Healthy",  cls:"g", set:["OK"] },
  ];
  const kpisFor = () => TAB==="breakdown" ? KPI_BD : KPI_EM;

  const SWATCH = { r:"#B42318", o:"#B54708", a:"#854A0E", c:"#175CD3", t:"#107569", g:"#2D6A2F", x:"#98A2B3" };
  // Vivid hues for NON-TEXT marks (KPI accents, strip segments, row/section dots) - brighter than the AA text inks.
  const HUE = { r:"#E0533A", o:"#EC8B47", a:"#EBBF49", c:"#3FA0F5", t:"#28BFB0", g:"#5FBF7A", x:"#B0B7C3" };
  const TERM_LABEL = { DTC:"Faults", T:"Temp", P:"Pressure", U:"Usage", M:"Maint", B:"Battery" };

  // Inline SVG icons (rendered inside <body>, which the add-in loader keeps). 16px, currentColor.
  const ICON = {
    alert:'<path d="M10.3 3.2 1.8 17.5A1.5 1.5 0 0 0 3 19.8h16a1.5 1.5 0 0 0 1.3-2.3L11.7 3.2a1.5 1.5 0 0 0-1.4 0z"/><line x1="11" y1="9" x2="11" y2="13"/><line x1="11" y1="16" x2="11.01" y2="16"/>',
    wrench:'<path d="M14.7 6.3a4 4 0 0 1-5.2 5.2L5 16l-1 3 3-1 4.5-4.5a4 4 0 0 0 5.2-5.2l-2.1 2.1-2-.5-.5-2 2.1-2.1z"/>',
    calendar:'<rect x="3" y="4.5" width="16" height="14" rx="2"/><line x1="3" y1="8.5" x2="19" y2="8.5"/><line x1="7" y1="2.5" x2="7" y2="6"/><line x1="15" y1="2.5" x2="15" y2="6"/>',
    eye:'<path d="M1.5 11S5 4.5 11 4.5 20.5 11 20.5 11 17 17.5 11 17.5 1.5 11 1.5 11z"/><circle cx="11" cy="11" r="2.6"/>',
    pulse:'<polyline points="1.5,11 6,11 8.5,5 13,17 15.5,11 20.5,11"/>',
    check:'<circle cx="11" cy="11" r="8.2"/><polyline points="7.4,11.2 10,13.8 14.8,8.4"/>',
    dash:'<circle cx="11" cy="11" r="8.2"/><line x1="7.2" y1="11" x2="14.8" y2="11"/>',
    chevron:'<polyline points="7,4.5 13.5,11 7,17.5"/>',
    search:'<circle cx="9.5" cy="9.5" r="6"/><line x1="18" y1="18" x2="13.7" y2="13.7"/>',
    close:'<line x1="5" y1="5" x2="17" y2="17"/><line x1="17" y1="5" x2="5" y2="17"/>',
    download:'<path d="M11 3v10"/><polyline points="6.5,9 11,13.5 15.5,9"/><line x1="4" y1="18" x2="18" y2="18"/>',
  };
  const svg = (name, sz) => '<svg class="vh-i" width="'+(sz||16)+'" height="'+(sz||16)+'" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(ICON[name]||"")+'</svg>';

  // ========================= state =========================
  let API=null, STATE=null, NAME_BY_ID={}, GROUP_BY_ID={}, COMPUTED=[], LOADING=false, LAST_UPDATED=null, DB="";
  let TAB="breakdown", VIEW="list", FILTER=null, FILTER_ID="all", SEARCH="", WINDOW_DAYS=30;
  let COLLAPSED={};          // `${tab}:${actionId}` -> true if collapsed
  let SECTION_LIMIT={};      // `${tab}:${actionId}` -> rows currently shown
  let LAST_FOCUS=null;       // element focus returns to after the drawer closes
  let TRUNC=[];              // names of datasets that hit their result cap (truncated)
  let VIN_CACHE={};          // vin -> { engine, trim, driveline, gvwr, body } from Geotab DecodeVins (cached for the session)
  let CURRENT_DRAWER_ID=null;// vehicle id whose drawer is open (for post-enrichment refresh)

  // ========================= persistence (graceful if storage blocked) =========================
  const pKey = () => CONFIG.persistKey + ":" + (DB||"_");
  function saveState(){
    try{ localStorage.setItem(pKey(), JSON.stringify({
      tab:TAB, view:VIEW, filterId:FILTER_ID, windowDays:WINDOW_DAYS, collapsed:COLLAPSED
    })); }catch(e){}
  }
  function loadState(){
    try{
      const raw=localStorage.getItem(pKey()); if(!raw)return;
      const s=JSON.parse(raw);
      if(s.tab) TAB=s.tab;
      if(s.view) VIEW=s.view;
      if(typeof s.windowDays==="number") WINDOW_DAYS=s.windowDays;
      if(s.collapsed && typeof s.collapsed==="object") COLLAPSED=s.collapsed;
      if(s.filterId){ FILTER_ID=s.filterId; FILTER=filterSetFromId(s.filterId); }
    }catch(e){}
  }
  function filterSetFromId(id){
    if(!id || id==="all") return null;
    if(id.indexOf("kpi:")===0){ const k=kpisFor().find(x=>"kpi:"+x.id===id); return k?new Set(k.set):null; }
    if(id.indexOf("act:")===0){ return new Set([id.slice(4)]); }
    return null;
  }

  // ========================= dom + a11y helpers =========================
  const el = id => document.getElementById(id);
  const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmtInt = n => (n==null?"\u2014":Math.round(n).toLocaleString());
  const fmtKg = kg => kg==null?"\u2014":(kg>=1000?(kg/1000).toFixed(1)+" t":Math.round(kg).toLocaleString()+" kg");
  function setStatus(html){ const m=el("vh-status"); if(m)m.innerHTML=html||""; }
  function announce(msg){ const r=el("vh-live"); if(r)r.textContent=msg||""; }   // polite SR announcement
  function lastUpdatedText(){ if(!LAST_UPDATED)return ""; const d=LAST_UPDATED;
    const hh=String(d.getHours()).padStart(2,"0"), mm=String(d.getMinutes()).padStart(2,"0");
    return "Updated "+hh+":"+mm; }
  const fbClass = v => v>=75?"r":v>=60?"o":v>=40?"a":"g";   // score-bar colour band
  // AA-contrast text colour for a score, matching the gauge zones (green<40, teal<60, amber<75, orange<90, red).
  const bandColor = v => v==null?"#98A2B3" : v>=90?"#B42318" : v>=75?"#B54708" : v>=60?"#854A0E" : v>=40?"#107569" : "#2D6A2F";
  function normGroups(state){ const raw=(state&&state.getGroupFilter&&state.getGroupFilter())||[]; return raw.map(g=>typeof g==="string"?{id:g}:g).filter(g=>g&&g.id); }
  const resolveId = kw => { const k=lc(kw); for(const id in NAME_BY_ID) if(lc(NAME_BY_ID[id]).indexOf(k)>-1) return id; return null; };

  // ---- vehicle identity from VIN (year deterministic; make from manufacturer prefix) ----
  const WMI={ "1FA":"Ford","1FB":"Ford","1FC":"Ford","1FD":"Ford","1FT":"Ford","1FM":"Ford","2FA":"Ford","2FM":"Ford","2FT":"Ford","3FA":"Ford","NM0":"Ford",
    "1FU":"Freightliner","1FV":"Freightliner","3AK":"Freightliner",
    "1G1":"Chevrolet","1GC":"Chevrolet","1GB":"Chevrolet","1GN":"Chevrolet","2G1":"Chevrolet","3GC":"Chevrolet","KL1":"Chevrolet",
    "1GD":"GMC","1GK":"GMC","1GT":"GMC",
    "1C3":"Chrysler","2C3":"Chrysler","1C4":"Jeep","1J4":"Jeep","1C6":"RAM","3C6":"RAM","1D7":"Dodge","2D4":"Dodge","3D7":"Dodge",
    "1HG":"Honda","2HG":"Honda","JHM":"Honda","5J6":"Honda","1N4":"Nissan","1N6":"Nissan","3N1":"Nissan","JN1":"Nissan","JN6":"Nissan","JN8":"Nissan",
    "4T1":"Toyota","5TF":"Toyota","5TD":"Toyota","2T1":"Toyota","1NX":"Toyota","JTD":"Toyota","JT3":"Toyota","JTE":"Toyota",
    "1HT":"International","1HS":"International","3HA":"International","3HS":"International","1XP":"Peterbilt","1NP":"Peterbilt","1XK":"Kenworth","1XKW":"Kenworth",
    "4V4":"Volvo","4V1":"Volvo","YV1":"Volvo","1M1":"Mack","1M2":"Mack","5PV":"Hino","JAL":"Isuzu","54D":"Isuzu","JALC":"Isuzu",
    "WD3":"Mercedes-Benz","WD4":"Mercedes-Benz","W1V":"Mercedes-Benz","W1X":"Mercedes-Benz","WDB":"Mercedes-Benz","4JG":"Mercedes-Benz",
    "WBA":"BMW","5UX":"BMW","WVW":"Volkswagen","WV1":"Volkswagen","WV2":"Volkswagen","1VW":"Volkswagen","3VW":"Volkswagen","WAU":"Audi" };
  function vinYear(vin){ if(!vin||vin.length<10)return null;
    const map={A:1980,B:1981,C:1982,D:1983,E:1984,F:1985,G:1986,H:1987,J:1988,K:1989,L:1990,M:1991,N:1992,P:1993,R:1994,S:1995,T:1996,V:1997,W:1998,X:1999,Y:2000,"1":2001,"2":2002,"3":2003,"4":2004,"5":2005,"6":2006,"7":2007,"8":2008,"9":2009};
    let y=map[vin.charAt(9).toUpperCase()]; if(y==null)return null;
    if(/[A-Za-z]/.test(vin.charAt(6)) && y<2010) y+=30;        // position 7 alpha => 2010+
    const cap=new Date().getFullYear()+1; if(y>cap) y-=30;     // never return a future year
    return y; }
  function decodeVin(vin){ if(!vin)return {year:null,make:null}; const v=String(vin).toUpperCase().replace(/\s/g,"");
    return { year:vinYear(v), make:WMI[v.slice(0,3)]||null }; }
  function vehicleSubtitle(r){ const p=[]; if(r.year)p.push(r.year); if(r.make)p.push(r.make); if(r.model)p.push(r.model); return p.join(" "); }

  // ---- parse a Geotab TimeSpan ("[d.]HH:MM:SS") to seconds; null if unparseable ----
  function durSec(v){ if(v==null)return null; if(typeof v==="number")return v; const str=String(v);
    let days=0, rest=str;
    if(/^\d+\./.test(str) && str.indexOf(":")>-1){ const i=str.indexOf("."); days=parseInt(str.slice(0,i),10)||0; rest=str.slice(i+1); }
    const p=rest.split(":"); if(p.length<3)return null;
    const h=parseInt(p[0],10)||0, m=parseInt(p[1],10)||0, s=parseFloat(p[2])||0;
    return days*86400+h*3600+m*60+s; }

  // ---- "2h" / "3d" since a timestamp ----
  function timeSince(d){ if(!d)return null; const ms=Date.now()-new Date(d).getTime(); if(ms<0)return "just now";
    const m=ms/60000; if(m<60)return Math.max(1,Math.round(m))+"m";
    const h=m/60; if(h<48)return Math.round(h)+"h"; return Math.round(h/24)+"d"; }

  // Top risk factors for a vehicle row: named contributors instead of cryptic letter-bars.
  function topContributors(terms){
    if(!terms) return [];
    const arr=Object.keys(terms).filter(k=>k!=="U" && terms[k]!=null).map(k=>({k,label:TERM_LABEL[k],v:terms[k]})).sort((a,b)=>b.v-a.v);
    const elevated=arr.filter(x=>x.v>=40).slice(0,2);
    if(elevated.length) return elevated;
    if(arr.length && arr[0].v>0) return [arr[0]];
    return [];
  }

  // ========================= small shared helpers =========================
  const daysAgo = d => new Date(Date.now()-d*864e5).toISOString();
  const dispOf  = r => TAB==="breakdown" ? r.disp : r.em.disp;
  const scoreOf = r => TAB==="breakdown" ? r.score : (r.em?r.em.score:null);
  const NEED = new Set(["Remove from service","Service now","Schedule diagnostic","Watch \u2013 intermittent",
                        "Service emissions system","Check SCR / aftertreatment","Recheck after drive cycle"]);
  function actionNeededCount(){ return COMPUTED.filter(r=>NEED.has(dispOf(r))).length; }
  function lockRefresh(on){ const b=el("vh-refresh"); if(b)b.disabled=!!on; }

  // ========================= data pipeline (scales by signal, not by vehicle) =========================
  function run(){
    LOADING=true; lockRefresh(true); showLoading();
    setStatus("Loading vehicles, faults and events\u2026"); announce("Loading fleet data");
    const groups=normGroups(STATE); const deviceSearch=groups.length?{groups}:{};
    const wsel=el("vh-window"); WINDOW_DAYS=Number(wsel&&wsel.value)||WINDOW_DAYS||CONFIG.faultLookbackDays;
    const fFrom=daysAgo(WINDOW_DAYS);

    API.multiCall([
      ["Get",{typeName:"Device",search:deviceSearch,resultsLimit:CONFIG.maxDevices}],
      ["Get",{typeName:"FaultData",search:{fromDate:fFrom},resultsLimit:CONFIG.faultLimit}],
      ["Get",{typeName:"ExceptionEvent",search:{fromDate:fFrom},resultsLimit:CONFIG.exceptionLimit}],
      ["Get",{typeName:"DVIRLog",search:{fromDate:fFrom},resultsLimit:CONFIG.dvirLimit}],
      ["Get",{typeName:"Rule",resultsLimit:CONFIG.ruleLimit}],
      ["Get",{typeName:"Group",resultsLimit:CONFIG.maxGroups}],
      ["Get",{typeName:"Trip",search:{fromDate:fFrom},resultsLimit:CONFIG.tripLimit}],
      ["Get",{typeName:"DeviceStatusInfo",resultsLimit:CONFIG.maxDevices}],
    ], r => {
      const devices=r[0],faults=r[1],exceptions=r[2],dvirs=r[3],rules=r[4],allGroups=r[5],trips=r[6],dsiAll=r[7];
      if(!devices||!devices.length){ LOADING=false; lockRefresh(false); COMPUTED=[]; LAST_UPDATED=new Date();
        setStatus("No vehicles for the current group filter."); renderAll(); return; }
      const idSet=new Set(devices.map(d=>d.id));
      GROUP_BY_ID={}; (allGroups||[]).forEach(g=>{ GROUP_BY_ID[g.id]=g.name||g.id; });
      // truncation guard: a Get that returns exactly its cap probably lost records
      TRUNC=[]; if((faults||[]).length>=CONFIG.faultLimit)TRUNC.push("faults"); if((exceptions||[]).length>=CONFIG.exceptionLimit)TRUNC.push("events"); if((trips||[]).length>=CONFIG.tripLimit)TRUNC.push("trips");

      // trips by device: distance (m), idle + drive seconds over the window
      const tripByDev={}; (trips||[]).forEach(t=>{ const dv=t.device&&t.device.id; if(!dv||!idSet.has(dv))return;
        const g=tripByDev[dv]||(tripByDev[dv]={distM:0,idleSec:0,driveSec:0});
        if(typeof t.distance==="number")g.distM+=t.distance;
        const is=durSec(t.idlingDuration); if(is!=null)g.idleSec+=is;
        const ds=durSec(t.drivingDuration); if(ds!=null)g.driveSec+=ds; });
      // last-contact by device (smarter "No data": offline vs no engine telematics)
      const dsiByDev={}; (dsiAll||[]).forEach(x=>{ const dv=x.device&&x.device.id; if(!dv||!idSet.has(dv))return;
        dsiByDev[dv]={ lastComm:x.dateTime||null, comm:(x.isDeviceCommunicating!==false) }; });

      const HARSH_IDS=new Set(CONFIG.harshRuleIds);
      const harshRuleIds={}; (rules||[]).forEach(x=>{ if(HARSH_IDS.has(x.id) || CONFIG.harshRuleKeywords.some(k=>lc(x.name).indexOf(k)>-1)) harshRuleIds[x.id]=1; });
      const harshByDev={}; (exceptions||[]).forEach(e=>{ const dv=e.device&&e.device.id, ru=e.rule&&e.rule.id;
        if(dv&&idSet.has(dv)&&ru&&harshRuleIds[ru])harshByDev[dv]=(harshByDev[dv]||0)+1; });

      const defectsByDev={}; (dvirs||[]).forEach(l=>{ const dv=l.device&&l.device.id; if(!dv||!idSet.has(dv))return;
        const list=l.defects||l.dvirDefects||[]; let open=0;
        list.forEach(d=>{ const rs=lc((d&&(d.repairStatus||(d.defect&&d.defect.repairStatus)))||""); if(rs===""||rs.indexOf("notrepaired")>-1||rs.indexOf("repairrequired")>-1)open++; });
        if(l.isSafeToOperate===false&&!list.length)open=Math.max(open,1);
        defectsByDev[dv]=(defectsByDev[dv]||0)+open; });

      const perDev={}; devices.forEach(d=>perDev[d.id]={vehicle:[],battery:[],device:[]});
      const faultDiagIds=[],seenD={};
      (faults||[]).forEach(f=>{ const dv=f.device&&f.device.id; if(!dv||!idSet.has(dv))return; const id=f.diagnostic&&f.diagnostic.id; if(id&&!seenD[id]){seenD[id]=1;faultDiagIds.push(id);} });

      const proceed=()=>{
        (faults||[]).forEach(f=>{ const dv=f.device&&f.device.id; if(!dv||!idSet.has(dv))return; const name=NAME_BY_ID[(f.diagnostic&&f.diagnostic.id)]||""; perDev[dv][classify(f,name)].push(f); });

        const sigKeys=Object.keys(CONFIG.signals);
        const sigId={}; sigKeys.forEach(k=>{ sigId[k]=CONFIG.signals[k].id||resolveId(CONFIG.signals[k].keyword); });
        const active=sigKeys.filter(k=>sigId[k]);
        // Per-signal lookback: chatty signals (coolant/voltage) need only a short window; slow accumulators
        // and monitors need a long one so a recently-parked vehicle still shows its last known value.
        const FAST=new Set(["coolant","deviceVoltage","cranking","oilTemp","transTemp","oilPressure","fuelPressure","boost","noxIn","noxOut"]);
        const fastFrom=daysAgo(CONFIG.statusLookbackFastDays), slowFrom=daysAgo(CONFIG.statusLookbackSlowDays);
        // ONE query per diagnostic across the whole filtered fleet (not per-device): ~N_signals calls regardless of fleet size.
        const calls=active.map(k=>["Get",{typeName:"StatusData",
          search:Object.assign({diagnosticSearch:{id:sigId[k]},fromDate:(FAST.has(k)?fastFrom:slowFrom)}, groups.length?{deviceSearch:{groups}}:{}),
          resultsLimit:CONFIG.statusLimitPerDiagnostic}]);

        const compute=(latestBy,firstBy)=>{
          COMPUTED=devices.map(dev=>{
            const b=perDev[dev.id], s=latestBy[dev.id]||{}, f0=firstBy[dev.id]||{};
            const dtc=dtcTerm(groupByDiagnostic(b.vehicle,NAME_BY_ID));
            const battOcc=b.battery.length;
            const harsh=harshByDev[dev.id]!=null?harshByDev[dev.id]:null;
            const openDef=defectsByDev[dev.id]!=null?defectsByDev[dev.id]:null;
            const tp=tripByDev[dev.id]||null;
            const distanceMi = tp && tp.distM>0 ? tp.distM/1609.344 : null;
            const ctx = tp ? { distanceMi, idleSec:tp.idleSec, driveSec:tp.driveSec } : {};
            const terms={ DTC:dtc.score, T:tempTerm(s), P:pressureTerm(s), U:usageTerm(s,harsh,ctx), M:maintTerm(s,openDef), B:batteryTerm(s,battOcc) };
            const hasData = b.vehicle.length||b.battery.length||Object.keys(s).length||(harsh&&harsh>0)||(openDef&&openDef>0);
            const dFuel=(s.fuelTotal!=null&&f0.fuelTotal!=null)?s.fuelTotal-f0.fuelTotal:null;
            const hk=s.engineHours!=null?"engineHours":(s.engineHoursAdj!=null?"engineHoursAdj":null);
            const dHours=(hk&&f0[hk]!=null)?s[hk]-f0[hk]:null;
            const dsi=dsiByDev[dev.id]||null;
            const geotabRisk = (s.predictedRisk!=null && !isNaN(s.predictedRisk)) ? s.predictedRisk : null;
            let score,disp,em,co2,noDataReason=null;
            if(!hasData){ score=null; disp="No data"; em={score:null,disp:"No data",detail:[]}; co2=null;
              const stale = dsi && dsi.lastComm && (Date.now()-new Date(dsi.lastComm).getTime())>CONFIG.staleHours*3600e3;
              noDataReason = (dsi && (dsi.comm===false || stale)) ? ("Offline"+(dsi.lastComm?" \u00b7 "+timeSince(dsi.lastComm):"")) : "No engine data";
            } else { score=combine(terms); disp=score==null?"Unknown":disposition(dtc.items,terms.B); em=emissionsHealth(s); co2=co2Estimate(s,dFuel,dHours,CONFIG.statusLookbackSlowDays); }
            const gids=(dev.groups||[]).map(g=>g.id).filter(id=>id && CONFIG.rootGroupIds.indexOf(id)<0);
            const gnames=gids.map(id=>GROUP_BY_ID[id]).filter(Boolean);
            const vin=dev.vehicleIdentificationNumber||null; const vd=decodeVin(vin);
            const make=dev.vinInfoMake||vd.make||null;
            const year=dev.vinInfoYear||(vd.year!=null?String(vd.year):null);
            const model=dev.vinInfoModel||null;
            return { id:dev.id, name:dev.name||dev.id, groups:gids, groupNames:gnames,
              vin, year, make, model, plate:dev.licensePlate||null,
              distanceMi, geotabRisk, lastComm:dsi?dsi.lastComm:null, comm:dsi?dsi.comm:null, noDataReason,
              score, terms, disp, items:dtc.items, battOcc, deviceFaultCount:b.device.length,
              harsh:harshByDev[dev.id]||0, openDefects:defectsByDev[dev.id]||0, em, co2, noData:!hasData };
          });
          LOADING=false; lockRefresh(false); LAST_UPDATED=new Date(); SECTION_LIMIT={};
          renderAll();
          const trunc = TRUNC.length ? " \u00b7 <b style=\"color:#B54708\">\u26a0 "+TRUNC.join("/")+" truncated \u2014 narrow window/group</b>" : "";
          setStatus("<b>"+COMPUTED.length+"</b> vehicles \u00b7 "+WINDOW_DAYS+"-day window \u00b7 <b>"+active.length+"</b> signals resolved"+trunc);
          announce(COMPUTED.length+" vehicles loaded. "+actionNeededCount()+" need attention."+(TRUNC.length?" Warning: some results were truncated.":""));
          enrichVins();
        };

        if(!calls.length){ compute({},{}); return; }
        setStatus("Reading "+calls.length+" signal series across the fleet\u2026");
        API.multiCall(calls, results => {
          const latestBy={}, firstBy={}, latestT={}, firstT={};
          results.forEach((rows,i)=>{ const k=active[i]; if(!rows)return;
            rows.forEach(rec=>{ const dv=rec.device&&rec.device.id; if(!dv||!idSet.has(dv))return; const t=new Date(rec.dateTime).getTime();
              const lT=(latestT[dv]=latestT[dv]||{}); if(lT[k]==null||t>lT[k]){ (latestBy[dv]=latestBy[dv]||{})[k]=rec.data; lT[k]=t; }
              const fT=(firstT[dv]=firstT[dv]||{}); if(fT[k]==null||t<fT[k]){ (firstBy[dv]=firstBy[dv]||{})[k]=rec.data; fT[k]=t; }
            });
          });
          compute(latestBy,firstBy);
        }, fail);
      };

      NAME_BY_ID={};
      if(faultDiagIds.length){ API.call("Get",{typeName:"Diagnostic",search:{ids:faultDiagIds}}, diags=>{ (diags||[]).forEach(d=>{NAME_BY_ID[d.id]=d.name;}); proceed(); }, fail); }
      else proceed();
    }, fail);
  }
  function fail(err){ LOADING=false; lockRefresh(false); setStatus("Error: "+(err&&err.message?err.message:String(err))); showError(); announce("Error loading data"); console.error("[VehicleHealth]",err); }

  // ---- optional: enrich the drawer with engine/trim/GVWR via Geotab's own DecodeVins (cached, fail-soft) ----
  function enrichVins(){
    if(!CONFIG.decodeVinDetails || !API) return;
    const need={}; COMPUTED.forEach(r=>{ if(r.vin && r.vin.length===17 && !VIN_CACHE[r.vin]) need[r.vin]=1; });
    const vins=Object.keys(need); if(!vins.length) return;
    const pick=(arr,k)=>{ const f=(arr||[]).find(d=>d&&d.Item1===k); return f?f.Item2:null; };
    for(let i=0;i<vins.length;i+=50){
      const chunk=vins.slice(i,i+50);
      try{
        API.call("DecodeVins",{vins:chunk}, res=>{
          (res||[]).forEach(d=>{ if(!d||!d.vin)return;
            VIN_CACHE[d.vin]={ engine:pick(d.extraDetails,"EngineOut"), trim:pick(d.extraDetails,"TrimLevelOut"),
              driveline:pick(d.extraDetails,"DrivelineOut"), gvwr:pick(d.extraDetails,"GVWLbsOut"), body:pick(d.extraDetails,"BodyOut") }; });
          if(CURRENT_DRAWER_ID){ const r=COMPUTED.find(x=>x.id===CURRENT_DRAWER_ID); if(r && VIN_CACHE[r.vin]) refreshDrawerBody(r); }
        }, ()=>{ /* fail-soft: details simply won't show */ });
      }catch(e){}
    }
  }

  // ========================= rendering: orchestration + summary + states =========================
  function counts(){ const c={}; COMPUTED.forEach(r=>{ const d=dispOf(r); c[d]=(c[d]||0)+1; }); return c; }
  function isCollapsed(id){ const key=TAB+":"+id;
    if(Object.prototype.hasOwnProperty.call(COLLAPSED,key)) return !!COLLAPSED[key];
    return CONFIG.defaultCollapsedActions.indexOf(id)>-1; }
  function filteredRows(){
    let arr=COMPUTED.slice();
    if(SEARCH){ const q=SEARCH.toLowerCase(); arr=arr.filter(r=>r.name.toLowerCase().indexOf(q)>-1 || r.groupNames.join(" ").toLowerCase().indexOf(q)>-1); }
    if(FILTER){ arr=arr.filter(r=>FILTER.has(dispOf(r))); }
    return arr;
  }
  function sortWithin(rows){
    rows.sort((a,b)=>{
      const sa=scoreOf(a),sb=scoreOf(b); let c=(sb==null?-1:sb)-(sa==null?-1:sa);
      if(c===0 && TAB==="emissions"){ const ca=a.co2?a.co2.totalKg:-1, cb=b.co2?b.co2.totalKg:-1; c=cb-ca; }
      if(c===0){ const x=a.name.toLowerCase(),y=b.name.toLowerCase(); c=x<y?-1:x>y?1:0; }
      return c;
    });
    return rows;
  }

  function renderAll(){
    const title=VIEW==="group" ? "By group" : (TAB==="breakdown" ? "Vehicles by recommended action" : "Vehicles by emissions action");
    const t=el("vh-panel-title"); if(t)t.textContent=title;
    const cnt=el("vh-count"); if(cnt)cnt.textContent=COMPUTED.length?("\u00b7 "+COMPUTED.length+" total"):"";
    const tb=el("vh-tab-bd"), te=el("vh-tab-em");
    if(tb){ tb.classList.toggle("on",TAB==="breakdown"); tb.setAttribute("aria-selected",TAB==="breakdown"); }
    if(te){ te.classList.toggle("on",TAB==="emissions"); te.setAttribute("aria-selected",TAB==="emissions"); }
    const vl=el("vh-view-list"), vg=el("vh-view-group");
    if(vl){ vl.classList.toggle("on",VIEW==="list"); vl.setAttribute("aria-pressed",VIEW==="list"); }
    if(vg){ vg.classList.toggle("on",VIEW==="group"); vg.setAttribute("aria-pressed",VIEW==="group"); }
    const si=el("vh-search"); if(si && si.value!==SEARCH) si.value=SEARCH;
    renderSummary();
    if(VIEW==="group") renderGroupView(); else renderList();
    saveState();
  }

  function renderSummary(){
    const wrap=el("vh-summary"); if(!wrap)return;
    if(LOADING){ wrap.innerHTML=""; return; }
    const total=COMPUTED.length, c=counts(), kpis=kpisFor(), need=actionNeededCount(), upd=lastUpdatedText();
    const cards=kpis.map((k,i)=>{ const n=k.set.reduce((a,d)=>a+(c[d]||0),0); const pct=total?Math.round(n/total*100):0; const sel=FILTER_ID==="kpi:"+k.id;
      return '<button class="vh-kpi'+(sel?" sel":"")+'" data-kpi="'+k.id+'" aria-pressed="'+(sel?"true":"false")+'" title="'+esc(k.label)+' \u2014 click to filter" style="--kc:'+HUE[k.cls]+';animation-delay:'+(i*50)+'ms">'
        +'<span class="kdot" aria-hidden="true"></span>'
        +'<span class="kl">'+esc(k.label)+'</span>'
        +'<span class="kn">'+n+'</span>'
        +'<span class="kp"><b>'+pct+'%</b> of fleet</span></button>'; }).join("");
    const segs=kpis.map(k=>({ n:k.set.reduce((a,d)=>a+(c[d]||0),0), cls:k.cls, label:k.label }));
    const kpiSum=segs.reduce((a,s)=>a+s.n,0);
    const rem=Math.max(0,total-kpiSum);
    const stripSegs=segs.concat(rem>0?[{n:rem,cls:"x",label:"No data"}]:[]).filter(s=>s.n>0);
    const stripDen=stripSegs.reduce((a,s)=>a+s.n,0)||1;
    const strip = total ? '<div class="vh-dist" role="img" aria-label="Fleet distribution by status">'
      + stripSegs.map(s=>'<span class="vh-dist-seg" style="flex:'+s.n+';background:'+HUE[s.cls]+'" title="'+esc(s.label)+': '+s.n+' ('+Math.round(s.n/stripDen*100)+'%)"></span>').join("")
      + '</div>' : "";
    const legend = total ? '<div class="vh-distleg">'
      + stripSegs.map(s=>'<span class="vh-distleg-item"><i style="background:'+HUE[s.cls]+'"></i>'+esc(s.label)+' <b>'+s.n+'</b></span>').join("")
      + '</div>' : "";
    wrap.innerHTML=
      '<div class="vh-overview"><div class="vh-ov-l"><b>'+need+'</b> need attention <span class="vh-ov-sep">\u00b7</span> '+total+' vehicles</div>'
      +'<div class="vh-ov-r">'+(upd?esc(upd):"")+'</div></div>'
      +'<div class="vh-kpis" role="group" aria-label="Filter vehicles by status">'+cards+'</div>'
      +strip+legend;
    wrap.querySelectorAll("[data-kpi]").forEach(b=>b.addEventListener("click",()=>{ const id=b.getAttribute("data-kpi");
      if(FILTER_ID==="kpi:"+id) setFilter("all",null);
      else { const k=kpisFor().find(x=>x.id===id); setFilter("kpi:"+id,new Set(k.set)); } }));
  }

  function showLoading(){ const w=el("vh-listwrap"); if(w)w.innerHTML='<div class="vh-state"><div class="vh-spin" role="status" aria-label="Loading"></div><div class="t">Loading fleet data\u2026</div><div class="d">Fetching faults, signals and events from Geotab.</div></div>'; const s=el("vh-summary"); if(s)s.innerHTML=""; }
  function showError(){ const w=el("vh-listwrap"); if(w)w.innerHTML='<div class="vh-state"><div class="ico" style="color:'+SWATCH.o+'">'+svg("alert",28)+'</div><div class="t">Could not load data</div><div class="d">See the status line above, then try Refresh.</div></div>'; }
  function stateBox(icon,colour,t,d){ return '<div class="vh-state"><div class="ico" style="color:'+colour+'">'+svg(icon,28)+'</div><div class="t">'+esc(t)+'</div><div class="d">'+esc(d)+'</div></div>'; }

  // ========================= rendering: grouped list + rows =========================
  function chip(label,v){ return '<span class="vh-chip chip-'+fbClass(v)+'">'+esc(label)+' '+Math.round(v)+'</span>'; }
  function contribHTML(terms){ const tops=topContributors(terms);
    if(!tops.length) return '<span class="vh-chip chip-none">No active factors</span>';
    return tops.map(t=>chip(t.label,t.v)).join(""); }
  function scoreMini(v){ if(v==null) return '<span class="vh-score na" aria-label="no data">\u2014</span>';
    const col=bandColor(v);
    return '<span class="vh-score" aria-label="'+Math.round(v)+' of 100, lower is healthier"><b style="color:'+col+'">'+Math.round(v)+'</b>'
      +'<span class="vh-track"><i style="width:'+Math.max(4,Math.round(v))+'%;background:'+col+'"></i></span></span>'; }

  function rowHTML(r,a){
    const dev=r.deviceFaultCount?' <span class="vh-tag" title="Telematics device fault recorded \u2014 excluded from score">device</span>':'';
    const grp=r.groupNames.length?'<span class="vh-rowgrp">'+esc(r.groupNames[0])+(r.groupNames.length>1?' +'+(r.groupNames.length-1):'')+'</span>':'';
    const subt=vehicleSubtitle(r);
    const sub=subt?'<span class="vh-rowsub">'+esc(subt)+'</span>':'';
    const head='<span class="vh-dot" style="background:'+HUE[a.cls]+'" aria-hidden="true"></span>'
      +'<span class="vh-rowname"><span class="vh-rowtop"><span class="vh-nm">'+esc(r.name)+'</span>'+dev+grp+'</span>'+sub+'</span>';
    if(TAB==="breakdown"){
      const mid = r.noData ? '<span class="vh-chip chip-none">'+esc(r.noDataReason||"No data")+'</span>' : contribHTML(r.terms);
      const aria=esc(r.name+(subt?" ("+subt+")":"")+", action "+a.short+", risk score "+(r.score==null?"no data":Math.round(r.score)+" of 100")+". Activate for details.");
      return '<div class="vh-row bd'+(r.noData?" nodata":"")+'" role="button" tabindex="0" data-id="'+esc(r.id)+'" aria-label="'+aria+'">'
        +head+'<span class="vh-contrib">'+mid+'</span>'
        +'<span class="vh-scorecell">'+scoreMini(r.score)+'</span>'
        +'<span class="vh-chev" aria-hidden="true">'+svg("chevron",15)+'</span></div>';
    }
    const finding = r.noData ? (r.noDataReason||"No data") : ((r.em.detail&&r.em.detail.length)?r.em.detail[0]:(r.em.score===0?"No issues detected":"\u2014"));
    const co2=r.co2?fmtInt(r.co2.totalKg):"\u2014";
    const ph=r.co2&&r.co2.perHour!=null?('<span class="vh-ph">~'+r.co2.perHour.toFixed(1)+' kg/hr</span>'):'';
    const aria=esc(r.name+(subt?" ("+subt+")":"")+", action "+a.short+". "+finding+". Activate for details.");
    return '<div class="vh-row em'+(r.noData?" nodata":"")+'" role="button" tabindex="0" data-id="'+esc(r.id)+'" aria-label="'+aria+'">'
      +head+'<span class="vh-finding">'+esc(finding)+'</span>'
      +'<span class="vh-scorecell num">'+co2+ph+'</span>'
      +'<span class="vh-chev" aria-hidden="true">'+svg("chevron",15)+'</span></div>';
  }

  function renderList(){
    const wrap=el("vh-listwrap"); if(!wrap)return;
    if(LOADING){ showLoading(); return; }
    if(!COMPUTED.length){ wrap.innerHTML=stateBox("dash",SWATCH.x,"No vehicles to show","Adjust the group filter in MyGeotab, then Refresh."); return; }
    const rows=filteredRows();
    if(!rows.length){ wrap.innerHTML=stateBox("search",SWATCH.c,"No matches","No vehicles match this filter or search."); return; }

    const byAction={}; rows.forEach(r=>{ const d=dispOf(r); (byAction[d]=byAction[d]||[]).push(r); });
    const order=actionsFor();
    const colhead = TAB==="breakdown"
      ? '<div class="vh-colhead bd"><span></span><span>Vehicle</span><span>Top risk factors</span><span class="ralign">Risk score <span class="vh-colhint">lower = healthier</span></span><span></span></div>'
      : '<div class="vh-colhead em"><span></span><span>Vehicle</span><span>Finding</span><span class="ralign">CO\u2082 (kg)</span><span></span></div>';

    let html=colhead;
    order.forEach(a=>{ const list=byAction[a.id]; if(!list||!list.length)return;
      sortWithin(list);
      const key=TAB+":"+a.id, collapsed=isCollapsed(a.id), limit=SECTION_LIMIT[key]||CONFIG.sectionPreviewRows;
      const shown=collapsed?[]:list.slice(0,limit);
      const bodyId="sec-"+TAB+"-"+a.id.replace(/[^a-z0-9]+/gi,"-").toLowerCase();
      html+='<div class="vh-sec'+(NEED.has(a.id)?" need":"")+'">'
        +'<button class="vh-sechead" data-sec="'+esc(a.id)+'" aria-expanded="'+(collapsed?"false":"true")+'" aria-controls="'+bodyId+'">'
          +'<span class="vh-sechev'+(collapsed?'':' open')+'" aria-hidden="true">'+svg("chevron",13)+'</span>'
          +'<span class="vh-sicon" style="color:'+HUE[a.cls]+'" aria-hidden="true">'+svg(a.icon,16)+'</span>'
          +'<span class="vh-secname">'+esc(a.short)+'</span>'
          +'<span class="vh-seccount">'+list.length+'</span>'
          +'<span class="vh-secdesc">'+esc(a.desc)+'</span>'
        +'</button>'
        +'<div class="vh-secbody" id="'+bodyId+'"'+(collapsed?' hidden':'')+'>'
          + shown.map(r=>rowHTML(r,a)).join("")
          + (!collapsed && list.length>shown.length ? '<button class="vh-more" data-more="'+esc(a.id)+'">Show '+(list.length-shown.length)+' more</button>' : '')
        +'</div></div>';
    });
    wrap.innerHTML=html;

    wrap.querySelectorAll("[data-sec]").forEach(b=>b.addEventListener("click",()=>toggleSection(b.getAttribute("data-sec"))));
    wrap.querySelectorAll("[data-more]").forEach(b=>b.addEventListener("click",()=>{ const id=b.getAttribute("data-more"), key=TAB+":"+id;
      SECTION_LIMIT[key]=(SECTION_LIMIT[key]||CONFIG.sectionPreviewRows)+CONFIG.sectionPreviewRows; renderList(); }));
    wrap.querySelectorAll(".vh-row").forEach(rw=>{
      rw.addEventListener("click",()=>openDrawer(rw.getAttribute("data-id"),rw));
      rw.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); openDrawer(rw.getAttribute("data-id"),rw); } });
    });
  }

  // ========================= rendering: group rollup =========================
  function groupRollup(){
    const map={};
    COMPUTED.forEach(r=>{ const names=r.groupNames.length?r.groupNames:["(No group)"]; const need=NEED.has(dispOf(r));
      names.forEach(n=>{ const g=map[n]||(map[n]={name:n,total:0,need:0}); g.total++; if(need)g.need++; }); });
    return Object.keys(map).map(k=>map[k]).sort((a,b)=> (b.need-a.need)||(b.total-a.total)||(a.name<b.name?-1:1));
  }
  function renderGroupView(){
    const wrap=el("vh-listwrap"); if(!wrap)return;
    if(LOADING){ showLoading(); return; }
    if(!COMPUTED.length){ wrap.innerHTML=stateBox("dash",SWATCH.x,"No vehicles to show","Adjust the group filter, then Refresh."); return; }
    const rolls=groupRollup();
    const head='<div class="vh-colhead grp"><span>Group</span><span class="ralign">Need attention</span><span class="ralign">Vehicles</span><span></span></div>';
    const body=rolls.map(g=>{ const pct=g.total?Math.round(g.need/g.total*100):0; const cls=g.need===0?"g":(pct>=30?"r":"a");
      const aria=esc(g.name+": "+g.need+" of "+g.total+" vehicles need attention. Activate to view in list.");
      return '<div class="vh-row grp" role="button" tabindex="0" data-grp="'+esc(g.name)+'" aria-label="'+aria+'">'
        +'<span class="vh-rowname"><span class="vh-nm">'+esc(g.name)+'</span></span>'
        +'<span class="vh-scorecell"><span class="vh-chip chip-'+cls+'">'+g.need+'</span></span>'
        +'<span class="vh-scorecell num">'+g.total+'</span>'
        +'<span class="vh-chev" aria-hidden="true">'+svg("chevron",15)+'</span></div>'; }).join("");
    wrap.innerHTML=head+'<div class="vh-secbody">'+body+'</div>';
    wrap.querySelectorAll("[data-grp]").forEach(rw=>{ const go=()=>{ const n=rw.getAttribute("data-grp"); if(n==="(No group)")return; setSearch(n); setView("list"); };
      rw.addEventListener("click",go); rw.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); } }); });
  }

  // ========================= drawer (unified: breakdown + emissions) =========================
  function pill(disp){ const m=ACTIONS_BD.concat(ACTIONS_EM).find(a=>a.id===disp)||{cls:"x",icon:"dash"};
    return '<span class="vh-pill pill-'+m.cls+'"><span class="pi" aria-hidden="true">'+svg(m.icon,12)+'</span>'+esc(disp)+'</span>'; }
  function termRow(label,key,terms){ const v=terms?terms[key]:null;
    if(v==null) return '<div class="vh-trm na"><span class="lab">'+esc(label)+'</span><span class="tk"></span><span class="v">\u2014</span></div>';
    return '<div class="vh-trm"><span class="lab">'+esc(label)+'</span><span class="tk"><i class="fb-'+fbClass(v)+'" style="width:'+Math.max(3,Math.round(v))+'%"></i></span><span class="v">'+Math.round(v)+'</span></div>'; }

  // Labeled gauge that anchors the breakdown score: 0-100 scale, banded track, marker, band-coloured value.
  function riskGauge(r){
    if(r.score==null){
      return '<div class="vh-gauge nodata"><div class="vh-gauge-top"><span class="vh-gauge-num na">\u2014</span>'
        +'<span class="vh-gauge-sub">no engine data to score</span></div></div>';
    }
    const v=Math.round(r.score), pos=clamp(v,0,100), col=bandColor(v);
    const urgent=(r.disp==="Service now"||r.disp==="Remove from service");
    const note=(urgent && v<60)
      ? '<div class="vh-gauge-note">Overall risk is '+(v<40?"low":"moderate")+'. This vehicle is flagged \u201c'+esc(r.disp)+'\u201d because of a specific active fault, not its composite score.</div>'
      : '';
    return '<div class="vh-gauge">'
      +'<div class="vh-gauge-top"><span class="vh-gauge-num" style="color:'+col+'">'+v+'<span class="vh-gauge-max">/100</span></span>'
      +'<span class="vh-gauge-sub">breakdown-risk index \u00b7 lower is healthier</span></div>'
      +'<div class="vh-gauge-track"><span class="vh-gauge-mark" style="left:'+pos+'%"></span></div>'
      +'<div class="vh-gauge-ticks"><span>0</span><span>50</span><span>100</span></div>'
      +note+'</div>';
  }

  function breakdownSection(r){
    const w=CONFIG.weights;
    const factors='<div class="vh-terms">'
      +termRow("Faults \u00b7 "+(w.DTC*100)+"%","DTC",r.terms)+termRow("Temp \u00b7 "+(w.T*100)+"%","T",r.terms)
      +termRow("Pressure \u00b7 "+(w.P*100)+"%","P",r.terms)+termRow("Usage \u00b7 "+(w.U*100)+"%","U",r.terms)
      +termRow("Maint \u00b7 "+(w.M*100)+"%","M",r.terms)+termRow("Battery \u00b7 "+(w.B*100)+"%","B",r.terms)+'</div>';
    const frows=r.items.length?r.items.map(i=>'<tr><td>'+esc(i.name)+(i.safety?' \u26a0':'')+'</td><td>'+esc(i.domState)+(i.intermittent?' \u00b7 intermittent':'')
      +'</td><td class="num">'+(i.worstSeverity!=null?Math.round(i.worstSeverity):"\u2014")+'</td><td class="num">'+(i.maxRisk!=null?i.maxRisk.toFixed(1)+"%":"\u2014")
      +'</td><td class="num">'+i.occurrences+'</td><td class="num">'+Math.round(i.contribution)+'</td></tr>').join("")
      :'<tr><td colspan="6" class="vh-muted">No vehicle ECU faults in window.</td></tr>';
    const faults='<table class="vh-dtable"><thead><tr><th>Fault</th><th>State</th><th>Sev</th><th>Risk</th><th>Count</th><th>Score</th></tr></thead><tbody>'+frows+'</tbody></table>';
    const notes=[];
    if(r.battOcc)notes.push(r.battOcc+" battery / low-voltage record(s) \u2192 Battery factor.");
    if(r.harsh)notes.push(r.harsh+" harsh-driving event(s) in window \u2192 Usage factor.");
    if(r.openDefects)notes.push(r.openDefects+" open DVIR defect(s) \u2192 Maintenance factor.");
    if(r.deviceFaultCount)notes.push(r.deviceFaultCount+" telematics device record(s) (excluded from score).");
    const ns=notes.length?'<ul class="vh-notes">'+notes.map(n=>'<li>'+esc(n)+'</li>').join("")+'</ul>':'';
    const gr=r.geotabRisk!=null?'<div class="vh-callout" style="margin-bottom:12px">Geotab predicted breakdown risk: <b>'+Math.round(r.geotabRisk)+'%</b> <span class="vh-muted">(Geotab\u2019s own model, shown for comparison)</span></div>':'';
    return '<section class="vh-dsec"><div class="vh-dsec-h"><h4>Breakdown risk</h4><div class="vh-dsec-meta">'+pill(r.disp)+'</div></div>'
      +riskGauge(r)
      +gr
      +'<div class="vh-dsub">Top risk factors (weight)</div>'+factors
      +'<div class="vh-dsub">Diagnostic faults</div>'+faults
      +(ns?'<div class="vh-dsub">Notes</div>'+ns:'')+'</section>';
  }
  function emissionsSection(r){
    const em=r.em, score=em.score==null?'\u2014':Math.round(em.score);
    const lines=(em.detail&&em.detail.length)?'<ul class="vh-notes">'+em.detail.map(d=>'<li>'+esc(d)+'</li>').join("")+'</ul>':'<p class="vh-muted">No emissions issues detected from available signals.</p>';
    let carbon='';
    if(r.co2){ const ph=r.co2.perHour!=null?('<br><b>~'+r.co2.perHour.toFixed(1)+' kg CO\u2082 / engine-hour</b> (last '+r.co2.perHourDays+' days)'):'';
      carbon='<div class="vh-callout"><b>'+fmtInt(r.co2.totalKg)+' kg</b> total \u00b7 <b>'+fmtInt(r.co2.idleKg)+' kg</b> from idling'+(r.co2.idleWaste?' \u26a0 high idle waste':'')+ph
        +'<br><span class="vh-muted">Fuel-derived estimate \u2014 use the Geotab Sustainability Center for certified figures.</span></div>'; }
    return '<section class="vh-dsec"><div class="vh-dsec-h"><h4>Emissions health</h4><div class="vh-dsec-meta">'+pill(em.disp)
      +'<span class="vh-dscore" style="color:'+bandColor(em.score)+'">'+score+'</span></div></div>'
      +'<div class="vh-dsub">Findings</div>'+lines
      +(carbon?'<div class="vh-dsub">Carbon estimate</div>'+carbon:'')+'</section>';
  }

  let DRAWER_TRAP=null;
  function focusables(c){ return Array.prototype.slice.call(c.querySelectorAll('button,[href],input,select,textarea,[tabindex]')).filter(e=>!e.disabled && e.tabIndex!==-1 && e.offsetParent!==null); }
  function drawerHTML(r){
    const grp=r.groupNames.length?esc(r.groupNames.join(" \u00b7 ")):"";
    const idbits=[]; const ym=vehicleSubtitle(r); if(ym)idbits.push(esc(ym)); if(r.plate)idbits.push("Plate "+esc(r.plate)); if(r.vin)idbits.push("VIN "+esc(r.vin));
    const idline=idbits.length?'<span class="vh-dmeta">'+idbits.join(" &nbsp;\u00b7&nbsp; ")+'</span>':'';
    const det=VIN_CACHE[r.vin]; const dp=[];
    if(det){ if(det.engine)dp.push(esc(det.engine)); if(det.trim)dp.push(esc(det.trim)); if(det.driveline)dp.push(esc(det.driveline)); if(det.gvwr)dp.push(esc(det.gvwr)); }
    const detline=dp.length?'<span class="vh-dmeta">'+dp.join(" &nbsp;\u00b7&nbsp; ")+'</span>':'';
    const seen=r.lastComm?("Last reported "+esc(timeSince(r.lastComm))+" ago"):(r.comm===false?"Offline":"");
    const seenline=seen?'<span class="vh-dmeta">'+seen+'</span>':'';
    const sub=(grp?'<span class="vh-dgrp">'+grp+'</span>':'')+idline+detline+seenline;
    return '<div class="vh-dhead"><div class="vh-dhead-row"><div><h3 id="vh-dtitle">'+esc(r.name)+'</h3>'+sub+'</div>'
      +'<button class="vh-x" id="vh-dx" aria-label="Close details">'+svg("close",16)+'</button></div></div>'
      +'<div class="vh-dbody">'+breakdownSection(r)+emissionsSection(r)+'</div>';
  }
  function refreshDrawerBody(r){ const d=el("vh-drawer"); if(!d)return; d.innerHTML=drawerHTML(r); const dx=el("vh-dx"); if(dx)dx.addEventListener("click",closeDrawer); }
  function openDrawer(id,fromEl){
    const r=COMPUTED.find(x=>x.id===id); if(!r)return;
    LAST_FOCUS=fromEl||document.activeElement; CURRENT_DRAWER_ID=id;
    el("vh-drawer").innerHTML=drawerHTML(r);
    const dx=el("vh-dx"); if(dx)dx.addEventListener("click",closeDrawer);
    const d=el("vh-drawer"), sc=el("vh-scrim");
    d.classList.add("on"); if(sc)sc.classList.add("on"); d.setAttribute("aria-hidden","false");
    DRAWER_TRAP=function(e){ if(e.key!=="Tab")return; const f=focusables(d); if(!f.length)return; const first=f[0],last=f[f.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();} };
    document.addEventListener("keydown",DRAWER_TRAP,true);
    if(dx)dx.focus();
  }
  function closeDrawer(){ const d=el("vh-drawer"), sc=el("vh-scrim");
    if(d){ d.classList.remove("on"); d.setAttribute("aria-hidden","true"); } if(sc)sc.classList.remove("on");
    if(DRAWER_TRAP){ document.removeEventListener("keydown",DRAWER_TRAP,true); DRAWER_TRAP=null; }
    CURRENT_DRAWER_ID=null;
    if(LAST_FOCUS&&LAST_FOCUS.focus){ try{LAST_FOCUS.focus();}catch(e){} } LAST_FOCUS=null;
  }

  // ========================= controls =========================
  function setTab(t){ if(TAB===t)return; TAB=t; FILTER=null; FILTER_ID="all"; SECTION_LIMIT={}; closeDrawer(); renderAll();
    announce(TAB==="breakdown"?"Breakdown risk view":"Emissions health view"); }
  function setFilter(id,set){ FILTER_ID=id; FILTER=set; SECTION_LIMIT={}; renderAll(); announce("Showing "+filteredRows().length+" vehicles"); }
  function setView(v){ if(VIEW===v)return; VIEW=v; SECTION_LIMIT={}; renderAll(); }
  function setSearch(q){ SEARCH=q; SECTION_LIMIT={}; renderAll(); }
  function toggleSection(id){ const key=TAB+":"+id; COLLAPSED[key]=!isCollapsed(id); renderAll(); }

  function exportCSV(){
    const rows=filteredRows(); if(!rows.length)return;
    const order=actionsFor().map(a=>a.id);
    rows.sort((a,b)=>{ const ia=order.indexOf(dispOf(a)),ib=order.indexOf(dispOf(b)); if(ia!==ib)return ia-ib;
      const sa=scoreOf(a),sb=scoreOf(b); return (sb==null?-1:sb)-(sa==null?-1:sa); });
    const q=s=>'"'+String(s==null?"":s).replace(/"/g,'""')+'"';
    const idCols=r=>[r.vin||"",r.year||"",r.make||"",r.model||"",r.plate||"",r.distanceMi!=null?Math.round(r.distanceMi):"",r.lastComm?new Date(r.lastComm).toISOString():""];
    const idHead=["VIN","Year","Make","Model","Plate","Miles (window)","Last reported"];
    let head,line;
    if(TAB==="breakdown"){
      head=["Vehicle","Group"].concat(idHead,["Recommended action","Risk score","Geotab risk %","Faults","Temp","Pressure","Usage","Maint","Battery","Device faults"]);
      line=r=>[r.name,r.groupNames.join(" | ")].concat(idCols(r),[r.disp,r.score==null?"":Math.round(r.score),r.geotabRisk==null?"":Math.round(r.geotabRisk),
        r.terms.DTC==null?"":Math.round(r.terms.DTC),r.terms.T==null?"":Math.round(r.terms.T),r.terms.P==null?"":Math.round(r.terms.P),
        r.terms.U==null?"":Math.round(r.terms.U),r.terms.M==null?"":Math.round(r.terms.M),r.terms.B==null?"":Math.round(r.terms.B),r.deviceFaultCount]);
    } else {
      head=["Vehicle","Group"].concat(idHead,["Emissions action","Emissions score","CO2 total kg","CO2 idle kg","CO2 per engine-hour","Findings"]);
      line=r=>[r.name,r.groupNames.join(" | ")].concat(idCols(r),[r.em.disp,r.em.score==null?"":Math.round(r.em.score),
        r.co2?Math.round(r.co2.totalKg):"",r.co2?Math.round(r.co2.idleKg):"",r.co2&&r.co2.perHour!=null?r.co2.perHour.toFixed(2):"",(r.em.detail||[]).join("; ")]);
    }
    const csv=[head.map(q).join(",")].concat(rows.map(r=>line(r).map(q).join(","))).join("\r\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=url; a.download="vehicle-health-"+TAB+".csv"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  // ========================= lifecycle =========================
  return {
    initialize(api,state,callback){ API=api; STATE=state;
      try{ loadState(); }catch(e){}
      const on=(id,ev,fn)=>{ const e=el(id); if(e)e.addEventListener(ev,fn); };
      const w=el("vh-window"); if(w)w.value=String(WINDOW_DAYS);
      on("vh-refresh","click",run);
      on("vh-window","change",()=>{ const w2=el("vh-window"); WINDOW_DAYS=Number(w2&&w2.value)||WINDOW_DAYS; run(); });
      on("vh-tab-bd","click",()=>setTab("breakdown"));
      on("vh-tab-em","click",()=>setTab("emissions"));
      on("vh-view-list","click",()=>setView("list"));
      on("vh-view-group","click",()=>setView("group"));
      on("vh-export","click",exportCSV);
      on("vh-scrim","click",closeDrawer);
      document.addEventListener("keydown",e=>{ if(e.key==="Escape")closeDrawer(); });
      const si=el("vh-search"); let t=null;
      if(si){ si.value=SEARCH; si.addEventListener("input",()=>{ const v=si.value.trim(); clearTimeout(t); t=setTimeout(()=>setSearch(v),130); }); }
      if(callback)callback();
    },
    focus(api,state){ API=api; STATE=state; run(); },
    blur(){ closeDrawer(); }
  };
};
