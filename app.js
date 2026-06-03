geotab.addin.vehicleHealth = () => {

  // ========================= CONFIG (tune here) =========================
  const CONFIG = {
    weights: { DTC:0.30, T:0.20, P:0.15, U:0.15, M:0.10, B:0.10 },
    bands: [ [90,"High risk","vhs-b-high"], [75,"Priority maint.","vhs-b-priority"],
             [60,"Schedule inspection","vhs-b-inspect"], [40,"Monitor","vhs-b-monitor"],
             [0,"Normal","vhs-b-normal"] ],
    maxDevices: 50000, faultLookbackDays: 30, statusLookbackDays: 7, statusLookbackFastDays: 3, statusLookbackSlowDays: 30, pageSize: 25,
    faultLimit: 50000, exceptionLimit: 50000, dvirLimit: 10000, ruleLimit: 2000, statusLimit: 500,
    batteryFaultKeywords: ["battery","low voltage"],
    deviceFaultKeywords:  ["device","restarted","power was removed","gps","antenna","tamper","telematics"],
    deviceControllerId:   "ControllerGoDeviceId",
    stateMultiplier: { Active:1.0, Pending:0.6, Inactive:0.2 },
    riskServiceNow: 40,
    signalActionBand: 75,  // a live temp/pressure reading at/above this (near its critical limit) bumps the action to "Schedule"
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
      transTemp:    { keyword:"transmission oil temperature", dir:"high", normal:110, critical:130, term:"T" },
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
      monEvap:      { keyword:"evaporative system monitor complete" },
      monSecAir:    { keyword:"secondary air system monitor complete" },
      monFuelSys:   { keyword:"fuel system monitor complete" },
      dpfSoot:      { keyword:"particulate filter 1 soot", dir:"high", normal:60, critical:90 },
      defLevel:     { keyword:"def level", dir:"low", normal:20, critical:5 },
      dpfIntakeTemp:{ keyword:"diesel particulate filter intake gas temperature" },
      dpfOutletTemp:{ keyword:"diesel particulate filter outlet gas temperature" },
      dpfIntakePress:{ keyword:"diesel particulate filter intake pressure" },
      dpfRegen:     { keyword:"diesel particulate filter regeneration status" },
      regenInhibit: { keyword:"aft regen inhibit status" },
      noxIn:        { keyword:"aftertreatment 1 intake nox", dir:"high" }, noxOut: { keyword:"aftertreatment 1 outlet nox", dir:"high" },
      // ---- auto-detected profile / classification (presence or value; not scored) ----
      dieselDetected:{ keyword:"diesel engine detected" },
      vehClass:     { keyword:"vehicle class for safety metrics" },
      gcvw:         { keyword:"gross combination vehicle weight" },
      ptoEngaged:   { keyword:"power takeoff engaged" },
      absEquipped:  { keyword:"generic abs active" },
      adasEquipped: { keyword:"adas forward collision status" },
      tpmsEquipped: { keyword:"tire pressure: axle 1 tire 1" },
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
    // Security-group ids allowed to CHANGE shared settings, IN ADDITION to built-in Administrator/Supervisor/Manager
    // clearances (auto-detected). Add a customer's custom admin clearance id here if their DB uses custom groups.
    adminGroupIds: [],
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
  // J1939 FMI (Failure Mode Identifier) - standardized failure modes per SAE J1939-73. 22-30 are reserved.
  const FMI_TEXT = {
    0:"above normal range (most severe)", 1:"below normal range (most severe)",
    2:"data erratic or intermittent", 3:"voltage above normal / shorted high",
    4:"voltage below normal / shorted low", 5:"current below normal / open circuit",
    6:"current above normal / grounded", 7:"mechanical system not responding",
    8:"abnormal frequency or pulse width", 9:"abnormal update rate", 10:"abnormal rate of change",
    11:"root cause not known", 12:"bad intelligent device or component", 13:"out of calibration",
    14:"special instructions", 15:"above normal range (least severe)", 16:"above normal range (moderate)",
    17:"below normal range (least severe)", 18:"below normal range (moderate)",
    19:"received network data in error", 20:"data drifted high", 21:"data drifted low", 31:"condition exists" };
  function fmiText(code){ if(code==null||code==="")return ""; return FMI_TEXT[Number(code)]||""; }
  // SAE J1939-73 reserves SPN 520192-524287 for proprietary, manufacturer-specific diagnostics.
  const PROP_SPN_MIN=520192, PROP_SPN_MAX=524287;
  // Conservative set of common STANDARD J1939 SPNs - only labels codes Geotab itself left unnamed (rare, since
  // Geotab already names standard SPNs). Always presented as "Likely ... - verify", never asserted as fact.
  const SPN_STD = {
    84:"wheel-based vehicle speed", 91:"accelerator pedal position", 92:"engine percent load",
    94:"fuel delivery pressure", 98:"engine oil level", 100:"engine oil pressure",
    102:"intake manifold (boost) pressure", 105:"intake manifold temperature", 108:"barometric pressure",
    110:"engine coolant temperature", 111:"coolant level", 157:"injector rail pressure",
    158:"keyswitch battery voltage", 168:"battery / electrical potential", 171:"ambient air temperature",
    174:"fuel temperature", 175:"engine oil temperature", 177:"transmission oil temperature",
    190:"engine speed", 247:"engine total hours", 411:"EGR differential pressure", 412:"EGR temperature",
    512:"driver demand engine torque", 513:"actual engine torque", 639:"J1939 data link",
    1127:"turbocharger boost pressure", 1761:"DEF tank level", 3216:"aftertreatment intake NOx",
    3226:"aftertreatment outlet NOx", 3242:"DPF intake temperature", 3246:"DPF outlet temperature",
    3251:"DPF differential pressure", 3719:"DPF soot load", 5246:"SCR inducement severity" };
  // Classify a diagnostic for display. Recognized -> Geotab's own name. Unrecognized ("**Unknown Diagnostic N")
  // -> identify by J1939 SPN: known standard SPN -> "Likely <param>"; proprietary range -> "Manufacturer-specific";
  // otherwise "Unrecognized". Never invents a meaning; std/proprietary labels carry a verify-with-OEM caveat.
  function classifyDiag(nm){
    const s=String(nm==null?"":nm).replace(/\*/g,"").trim();
    const m=s.match(/unknown\s+diagnostic\s*([0-9]+)/i);
    if(!m) return { label: s || "Unrecognized fault", spn:null, klass:"named" };
    const spn=Number(m[1]);
    if(SPN_STD[spn]) return { label:"Likely "+SPN_STD[spn]+" \u00b7 code "+spn, spn, klass:"std" };
    if(spn>=PROP_SPN_MIN && spn<=PROP_SPN_MAX) return { label:"Manufacturer-specific \u00b7 code "+spn, spn, klass:"proprietary" };
    return { label:"Unrecognized fault \u00b7 code "+spn, spn, klass:"unknown" };
  }

  function groupByDiagnostic(records,nameById,fmById){
    fmById=fmById||{};
    const by={};
    records.forEach(f=>{ const id=f.diagnostic&&f.diagnostic.id; if(!id)return;
      let g=by[id];
      if(!g){ const c=classifyDiag(nameById[id]); g=by[id]={id,name:c.label,spn:c.spn,codeClass:c.klass,occurrences:0,states:{},worstSeverity:null,worstLamp:0,maxRisk:null,safety:false,fmi:null,fmiName:null,_fmiLamp:-1,first:f.dateTime,last:f.dateTime}; }
      g.occurrences++; const st=stateOf(f); g.states[st]=(g.states[st]||0)+1;
      const sv=severityToScore(f.severity||f.diagnosticSeverity); if(sv!=null)g.worstSeverity=Math.max(g.worstSeverity||0,sv);
      const lamp=lampToScore(f); g.worstLamp=Math.max(g.worstLamp,lamp);
      if(typeof f.riskOfBreakdown==="number")g.maxRisk=Math.max(g.maxRisk||0,f.riskOfBreakdown);
      if(isSafetyFault(g.name))g.safety=true;
      // FMI from the record carrying the strongest lamp (the representative failure mode for this code)
      const fm = (f.failureMode && f.failureMode.id && fmById[f.failureMode.id]) || null;
      if(fm && fm.code!=null && lamp>=g._fmiLamp){ g.fmi=fm.code; g.fmiName=fm.name; g._fmiLamp=lamp; }
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
  // recurrence points for one fault, by how many times it fired in the window (bounded per fault)
  function recurrencePts(occ){ occ=occ||0; return occ>=20?6 : occ>=10?4 : occ>=5?2 : occ>=2?1 : 0; }
  function dtcTerm(groups){
    if(!groups.length)return {score:0,items:[]};
    const items=groups.map(scoreFaultGroup);
    const worst=maxOf(items.map(i=>i.contribution))||0;
    // DTC = "severity AND frequency": worst fault's severity score, lifted by a bounded frequency
    // component = recurrence points summed over ACTIVE faults (so repeat/recurring faults count).
    const freq=clamp(items.reduce((a,i)=>a+(i.domState==="Active"?recurrencePts(i.occurrences):0),0),0,25);
    return {score:clamp(worst+freq,0,100),items,freq};
  }

  // ---- term builders ----
  function tempTerm(s){ return maxOf(["coolant","oilTemp","transTemp"].map(k=>{
    const sg=CONFIG.signals[k]; return signalBadness(s[k],sg.normal,sg.critical,sg.dir); }).filter(v=>v!=null)); }
  function pressureTerm(s){ return maxOf(["oilPressure","fuelPressure","boost"].map(k=>{
    const sg=CONFIG.signals[k]; return signalBadness(s[k],sg.normal,sg.critical,sg.dir); }).filter(v=>v!=null)); }
  function usageParts(s,harshCount,ctx){
    ctx=ctx||{};
    // idle: prefer trip idle-TIME ratio (idle / (idle+drive)); fall back to fuel idle ratio
    let idleRatio=null;
    if(ctx.idleSec!=null && ctx.driveSec!=null && (ctx.idleSec+ctx.driveSec)>0) idleRatio=ctx.idleSec/(ctx.idleSec+ctx.driveSec);
    else if(s.fuelTotal!=null && s.fuelIdle!=null && s.fuelTotal>0) idleRatio=s.fuelIdle/s.fuelTotal;
    const ic=SETTINGS.idle, hc=SETTINGS.harsh;
    const idleBad = idleRatio==null?null:(idleRatio<=ic.normal?0:idleRatio>=ic.critical?100:clamp((idleRatio-ic.normal)/(ic.critical-ic.normal)*100,0,100));
    const harshBad = harshCount==null?null:(harshCount<=hc.normal?0:harshCount>=hc.critical?100:clamp((harshCount-hc.normal)/(hc.critical-hc.normal)*100,0,100));
    const vals=[idleBad,harshBad].filter(v=>v!=null);
    return { score: vals.length?Math.max.apply(null,vals):null, idleBad, harshBad };
  }
  function usageTerm(s,harshCount,ctx){ return usageParts(s,harshCount,ctx).score; }
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

  // ========================= configurable settings (stored in Geotab AddInData; shared across the database) =========================
  // Encoded GUID that isolates THIS add-in's stored data from every other add-in. Generated once - do NOT change it
  // (changing it orphans previously saved settings). Geotab format: "a" + 22 URL-safe base64 chars.
  const ADDIN_ID = "amM5ODA0OTgtMzBmZi04Y2E";

  // The only cutoffs a fleet manager can tune. Everything else (scoring weights, score bands, temp/pressure limits)
  // stays internal so scores stay comparable across fleets. Defaults mirror CONFIG (= the "Medium" presets).
  function defaultSettings(){ return {
    v:1,
    harsh:{ normal:CONFIG.harshRate.normal, critical:CONFIG.harshRate.critical },
    idle:{ normal:CONFIG.idleRatio.normal, critical:CONFIG.idleRatio.critical },
    staleHours:CONFIG.staleHours,
    weights: Object.assign({}, CONFIG.weights)
  }; }
  const PRESETS = {
    harsh: { high:{normal:10,critical:60},   medium:{normal:20,critical:120}, low:{normal:40,critical:200} },
    idle:  { high:{normal:0.15,critical:0.45}, medium:{normal:0.25,critical:0.60}, low:{normal:0.35,critical:0.75} }
  };
  // Which preset (if any) a pair of numbers matches exactly - used to light the right preset button.
  function presetName(kind,pair){ const P=PRESETS[kind]; for(const n in P){ if(P[n].normal===pair.normal && P[n].critical===pair.critical) return n; } return "custom"; }

  function safeJSON(str){ try{ return JSON.parse(str); }catch(e){ return null; } }
  function errText(err){ if(!err)return "Save failed."; if(typeof err==="string")return err; return err.message||err.name||"Save failed."; }

  // Validate/repair anything coming back from storage (or a stale schema) so the engine always gets sane numbers.
  function sanitizeSettings(raw){
    const d=defaultSettings();
    if(!raw||typeof raw!=="object") return d;
    const n=(x,fb)=>{ const v=Number(x); return isFinite(v)?v:fb; };
    let hn=clamp(Math.round(n(raw.harsh&&raw.harsh.normal,d.harsh.normal)),1,2000);
    let hc=clamp(Math.round(n(raw.harsh&&raw.harsh.critical,d.harsh.critical)),1,5000); if(hc<=hn)hc=hn+1;
    let inn=clamp(n(raw.idle&&raw.idle.normal,d.idle.normal),0,0.95);
    let ic=clamp(n(raw.idle&&raw.idle.critical,d.idle.critical),0,1); if(ic<=inn)ic=Math.min(1,inn+0.01);
    let sh=clamp(Math.round(n(raw.staleHours,d.staleHours)),1,720);
    // weights: clamp each factor to 0..1; if everything is zero, fall back to defaults (combine renormalises).
    const dw=d.weights, rw=(raw.weights&&typeof raw.weights==="object")?raw.weights:{};
    const w={}; let wsum=0;
    for(const k in dw){ let v=n(rw[k],dw[k]); if(!(v>=0))v=dw[k]; v=clamp(v,0,1); w[k]=Math.round(v*100)/100; wsum+=w[k]; }
    if(wsum<=0){ for(const k in dw) w[k]=dw[k]; }
    return { v:1, harsh:{normal:hn,critical:hc}, idle:{normal:inn,critical:ic}, staleHours:sh, weights:w };
  }

  // A user may CHANGE shared settings only with elevated clearance. Built-in Administrator/Supervisor/Manager
  // clearances are recognised by their security-group id; custom clearances can be added via CONFIG.adminGroupIds.
  // Anything else (Default User, View Only, custom) is read-only - fail-safe.
  const ELEVATED_RE = /(everything|administrator|supervisor|manager|admin)/i;
  function isElevated(groups){
    if(!groups||!groups.length) return false;
    return groups.some(g=>{ const id=g&&g.id; if(!id)return false;
      return CONFIG.adminGroupIds.indexOf(id)>-1 || ELEVATED_RE.test(id); });
  }
  function checkClearance(cb){
    CAN_EDIT_SETTINGS=false;
    if(!API||!API.getSession){ return cb&&cb(); }
    let done=false; const fin=()=>{ if(done)return; done=true; cb&&cb(); };
    try{
      API.getSession(function(session){
        const uname = session && (session.userName || (session.credentials&&session.credentials.userName));
        if(!uname){ return fin(); }
        API.call("Get",{typeName:"User",search:{name:uname}}, function(users){
          try{ const u=users&&users[0]; CAN_EDIT_SETTINGS=isElevated((u&&u.securityGroups)||[]); }catch(e){}
          fin();
        }, function(){ fin(); });
      }, function(){ fin(); });
    }catch(e){ fin(); }
  }
  function loadSettings(cb){
    if(!API||!API.call){ SETTINGS=defaultSettings(); return cb&&cb(); }
    try{
      API.call("Get",{typeName:"AddInData",search:{addInId:ADDIN_ID}}, function(rows){
        try{
          if(rows && rows.length){
            const row=rows[0]; SETTINGS_ID=row.id||null;
            let det=(row.details!=null)?row.details:row.data;     // 'details' deserialises as an object (preferred over legacy 'data')
            if(typeof det==="string") det=safeJSON(det);
            SETTINGS=sanitizeSettings(det);
          } else { SETTINGS=defaultSettings(); SETTINGS_ID=null; }
        }catch(e){ SETTINGS=defaultSettings(); }
        cb&&cb();
      }, function(){ SETTINGS=defaultSettings(); cb&&cb(); });
    }catch(e){ SETTINGS=defaultSettings(); cb&&cb(); }
  }
  function saveSettings(next, done){
    next=sanitizeSettings(next);
    if(!CAN_EDIT_SETTINGS){ return done&&done(false,"You need Administrator or Supervisor access to change these settings."); }
    if(!API||!API.call){ return done&&done(false,"Storage is not available in this session."); }
    const ok=()=>{ SETTINGS=next; done&&done(true,""); };
    try{
      if(SETTINGS_ID){
        API.call("Set",{typeName:"AddInData",entity:{id:SETTINGS_ID,addInId:ADDIN_ID,groups:[{id:"GroupCompanyId"}],details:next}},
          function(){ ok(); }, function(err){ done&&done(false,errText(err)); });
      } else {
        API.call("Add",{typeName:"AddInData",entity:{addInId:ADDIN_ID,groups:[{id:"GroupCompanyId"}],details:next}},
          function(res){ SETTINGS_ID=(res&&res.id)?res.id:(typeof res==="string"?res:SETTINGS_ID); ok(); },
          function(err){ done&&done(false,errText(err)); });
      }
    }catch(e){ done&&done(false,errText(e)); }
  }
  // Load clearance + settings exactly once, then drain any waiters. Later calls run the callback immediately.
  function ensureSettings(cb){
    if(SETTINGS_LOADED){ return cb&&cb(); }
    ENS_Q.push(cb);
    if(SETTINGS_LOADING) return;
    SETTINGS_LOADING=true;
    checkClearance(function(){ loadSettings(function(){
      SETTINGS_LOADED=true; SETTINGS_LOADING=false;
      const q=ENS_Q.slice(); ENS_Q.length=0; q.forEach(fn=>fn&&fn());
    }); });
  }

  // ---- per-row signal detail: the worst live reading behind each factor, for the plain-language row chips ----
  function cToF(c){ return Math.round(c*9/5+32); }
  function kpaToPsi(k){ return Math.round(k*0.1450377); }
  function dominantSignal(s,keys){   // worst (highest-badness) reading among keys, only when it actually contributes
    let best=null;
    keys.forEach(k=>{ const sg=CONFIG.signals[k]; const b=signalBadness(s[k],sg.normal,sg.critical,sg.dir);
      if(b!=null && b>0 && (best==null||b>best.score)) best={score:b,who:k,value:s[k]}; });
    return best;
  }
  function buildDetail(s,openDef,battOcc){
    const d={ T:null, P:null, B:null, M:null };
    d.T=dominantSignal(s,["coolant","oilTemp","transTemp"]);
    d.P=dominantSignal(s,["oilPressure","fuelPressure","boost"]);
    let b=dominantSignal(s,["deviceVoltage","cranking"]);
    if(battOcc>0){ const fb=clamp(40+battOcc*3,0,100); if(b==null||fb>b.score) b={score:fb,who:"battFault",value:battOcc}; }
    d.B=b;
    let m=null;
    if(s.milDistance!=null && s.milDistance>0) m={score:60,who:"mil",value:s.milDistance};
    if(openDef!=null && openDef>0){ const sc=clamp(40+(openDef-1)*30,0,100); if(m==null||sc>m.score) m={score:sc,who:"defects",value:openDef}; }
    const ol=CONFIG.signals.oilLife; const olb=signalBadness(s.oilLife,ol.normal,ol.critical,ol.dir);
    if(olb!=null && olb>0 && (m==null||olb>m.score)) m={score:olb,who:"oilLife",value:s.oilLife};
    d.M=m;
    return d;
  }

  function combine(terms){ const W=(SETTINGS&&SETTINGS.weights)||CONFIG.weights; let w=0,a=0; for(const k in W){ const v=terms[k]; if(v==null)continue; w+=W[k]; a+=W[k]*v; } return w===0?null:a/w; }
  function band(score){ if(score==null)return ["Unknown","vhs-b-unknown"]; for(const b of CONFIG.bands) if(score>=b[0])return [b[1],b[2]]; return ["Normal","vhs-b-normal"]; }
  function disposition(items,terms){
    terms=terms||{};
    if(items.some(i=>i.domState==="Active"&&i.worstLamp>=100))return "Remove from service";
    if(items.some(i=>i.domState==="Active"&&(i.worstLamp>=60||(i.worstSeverity||0)>=60||(i.maxRisk||0)>=CONFIG.riskServiceNow||i.safety)))return "Service now";
    let d=items.length?"Monitor":"OK";
    if(items.some(i=>i.domState==="Pending"&&(i.worstSeverity||0)>=25)||items.some(i=>i.domState==="Active"))d="Schedule diagnostic";
    else if(items.some(i=>i.intermittent))d="Watch \u2013 intermittent";
    // a weak battery, or a live temp/pressure reading near its critical limit, warrants at least a scheduled check
    if(d==="OK"||d==="Monitor"){
      const sb=CONFIG.signalActionBand;
      const liveSignal=(terms.T!=null&&terms.T>=sb)||(terms.P!=null&&terms.P>=sb);
      const weakBattery=terms.B!=null&&terms.B>=60;
      if(liveSignal||weakBattery)d="Schedule diagnostic";
    }
    return d;
  }

  const DISP_RANK={ "Remove from service":5, "Service now":4, "Schedule diagnostic":3, "Watch \u2013 intermittent":2, "Monitor":1, "OK":0, "Unknown":-1,
                    "Attention":4, "Recheck":3, "No data":-1 };
  const dispRank=d=>DISP_RANK[d]!=null?DISP_RANK[d]:0;

  // ---- emissions (Section 2) ----
  function emissionsHealth(s, faults){
    const rows=[], detail=[], parts=[];
    let worstState="ok"; const RANK={ok:0,recheck:1,attention:2};
    const bump=st=>{ if(RANK[st]>RANK[worstState])worstState=st; };
    const monKeys=["monCatalyst","monO2","monEGR","monMisfire","monEvap","monSecAir","monFuelSys"];
    const hasMon = monKeys.some(k=>s[k]!=null) || s.milDistance!=null;
    const hasDiesel = s.defLevel!=null||s.dpfIntakeTemp!=null||s.dpfOutletTemp!=null||s.dpfIntakePress!=null||s.dpfRegen!=null||s.dpfSoot!=null||(s.noxIn!=null&&s.noxOut!=null);
    // Diesel takes priority: a diesel that also reports OBD monitors should still show aftertreatment, not gas readiness.
    const kind = hasDiesel ? "diesel" : (hasMon ? "gas" : "none");
    let headline="";

    if(kind==="gas"){
      // Inspection readiness: OBD-II monitor completion + MIL + catalyst fault + recent-code-clear masking.
      const milOn = s.milDistance!=null && s.milDistance>0;
      const catFault = (faults||[]).some(f=>/catalyst.*efficiency below threshold/i.test(f.name||""));
      if(milOn){ parts.push(80); bump("attention"); detail.push("Check-engine (MIL) on"); rows.push({label:"Check-engine light",value:"on",state:"attention"}); }
      else if(s.milDistance!=null){ rows.push({label:"Check-engine light",value:"off",state:"ok"}); }
      const monLabel={monCatalyst:"Catalyst monitor",monO2:"O\u2082 sensor monitor",monEGR:"EGR monitor",monMisfire:"Misfire monitor",monEvap:"EVAP monitor",monSecAir:"Secondary air monitor",monFuelSys:"Fuel system monitor"};
      let incomplete=0,have=0; const incNames=[];
      monKeys.forEach(k=>{ const v=s[k]; if(v!=null){ have++; const done=v!==0; if(!done){incomplete++; incNames.push(monLabel[k].replace(" monitor",""));} rows.push({label:monLabel[k],value:done?"complete":"not complete",state:done?"ok":"recheck"}); } });
      if(incomplete>0){ parts.push(Math.min(30,incomplete*10)); bump("recheck"); detail.push(incomplete+" of "+have+" readiness monitors incomplete"); }
      const recentClear = s.distSinceClear!=null && s.distSinceClear>=0 && s.distSinceClear<16000; // <~10 mi
      let masking=false;
      if(recentClear && incomplete>0){ parts.push(40); masking=true; detail.push("Codes cleared recently, monitors not yet re-run \u2014 recent repair or possible masking"); rows.push({label:"Recent code clear",value:"yes \u2014 monitors not re-run",state:"recheck"}); }
      // Catalytic converter line = the ECU's own verdict: catalyst monitor + P0420/P0430.
      if(catFault){ parts.push(80); bump("attention"); detail.push("Catalyst efficiency fault (P0420/P0430)"); rows.push({label:"Catalytic converter",value:"efficiency fault (P0420/P0430)",state:"attention"}); }
      else if(s.monCatalyst===0){ rows.push({label:"Catalytic converter",value:"monitor not yet complete",state:"recheck"}); }
      else if(s.monCatalyst!=null){ rows.push({label:"Catalytic converter",value:"no efficiency fault",state:"ok"}); }
      if(milOn) headline="Check-engine light on \u2014 would fail an emissions inspection.";
      else if(catFault) headline="Catalytic converter efficiency fault (P0420/P0430) \u2014 would fail an emissions inspection.";
      else if(incomplete>0) headline="Not ready for inspection \u2014 "+incNames.join(", ")+" monitor"+(incNames.length>1?"s":"")+" not complete."+(masking?" Codes were cleared recently, so this could be a recent repair or could be masking a fault \u2014 recheck after a full drive cycle.":" Recheck after a full drive cycle.");
      else if(have>0) headline="Inspection-ready \u2014 all reported readiness monitors complete, no check-engine light.";
      else headline="No OBD readiness data reported.";
    } else if(kind==="diesel"){
      // Aftertreatment: DEF level + DPF regen state + DPF readings (soot/NOx only if the vehicle reports them).
      const def=CONFIG.signals.defLevel;
      if(s.defLevel!=null){ const lv=Math.round(s.defLevel);
        const st = s.defLevel<=def.critical?"attention":(s.defLevel<def.normal?"recheck":"ok");
        if(st==="attention"){ parts.push(100); detail.push("DEF critically low ("+lv+"%)"); }
        else if(st==="recheck"){ parts.push(60); detail.push("DEF low ("+lv+"%)"); }
        bump(st); rows.push({label:"DEF level",value:lv+"%",state:st}); }
      if(s.dpfRegen!=null){ const on=s.dpfRegen!==0; rows.push({label:"DPF regeneration",value:on?"in progress":"not active",state:"ok"}); if(on)detail.push("DPF regenerating"); }
      if(s.regenInhibit!=null && s.regenInhibit!==0){ parts.push(40); bump("recheck"); detail.push("DPF regeneration inhibited"); rows.push({label:"DPF regen inhibited",value:"yes",state:"recheck"}); }
      const dpf=signalBadness(s.dpfSoot,CONFIG.signals.dpfSoot.normal,CONFIG.signals.dpfSoot.critical,"high");
      if(dpf!=null){ const st=dpf>=100?"attention":dpf>=60?"recheck":"ok"; parts.push(dpf); if(st!=="ok")bump(st); detail.push("DPF soot load "+Math.round(s.dpfSoot)+"%"); rows.push({label:"DPF soot load",value:Math.round(s.dpfSoot)+"%",state:st}); }
      if(s.dpfIntakePress!=null) rows.push({label:"DPF intake pressure",value:kpaToPsi(s.dpfIntakePress)+" psi",state:"ok"});
      if(s.dpfIntakeTemp!=null) rows.push({label:"DPF intake temp",value:cToF(s.dpfIntakeTemp)+"\u00b0F",state:"ok"});
      if(s.dpfOutletTemp!=null) rows.push({label:"DPF outlet temp",value:cToF(s.dpfOutletTemp)+"\u00b0F",state:"ok"});
      if(s.noxIn!=null&&s.noxOut!=null&&s.noxIn>0){ const ratio=s.noxOut/s.noxIn; const b=ratio<=0.3?0:ratio>=0.8?100:clamp((ratio-0.3)/0.5*100,0,100); const st=b>=60?"recheck":"ok"; parts.push(b); if(st!=="ok")bump(st); detail.push("NOx out/in ratio "+ratio.toFixed(2)+" (SCR)"); rows.push({label:"SCR (NOx out/in)",value:ratio.toFixed(2),state:st}); }
      if(s.defLevel!=null && s.defLevel<=def.critical) headline="DEF critically low \u2014 engine derate likely; refill now.";
      else if(s.defLevel!=null && s.defLevel<def.normal) headline="DEF low \u2014 refill soon.";
      else if(s.regenInhibit!=null && s.regenInhibit!==0) headline="DPF regeneration is inhibited \u2014 soot can build up; clear the inhibit when safe.";
      else if(dpf!=null && dpf>=100) headline="DPF soot load very high \u2014 service the particulate filter.";
      else headline=(s.dpfRegen!=null&&s.dpfRegen!==0)?"DPF is regenerating now \u2014 no aftertreatment alerts from reported signals.":"No aftertreatment alerts from reported signals.";
    } else {
      return { score:null, disp:"No data", state:"none", kind:"none", headline:"No emissions data reported.", rows:[], detail:[] };
    }

    const score = parts.length?Math.max.apply(null,parts):0;
    const disp = worstState==="attention"?"Attention":worstState==="recheck"?"Recheck":"OK";
    return { score, disp, state:worstState, kind, headline, rows, detail };
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
    { id:"Attention", short:"Attention", cls:"r", icon:"alert",    desc:"Would fail inspection, or DEF critically low" },
    { id:"Recheck",   short:"Recheck",   cls:"a", icon:"calendar", desc:"Monitors not complete, or aftertreatment needs a look" },
    { id:"OK",        short:"OK",        cls:"g", icon:"check",    desc:"Inspection-ready / aftertreatment normal" },
    { id:"No data",   short:"No data",   cls:"x", icon:"dash",     desc:"No emissions data reporting" },
    { id:"Unknown",   short:"Unknown",   cls:"x", icon:"dash",     desc:"Could not compute" },
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
    { id:"attention", label:"Attention", cls:"r", set:["Attention"] },
    { id:"recheck",   label:"Recheck",   cls:"a", set:["Recheck"] },
    { id:"healthy",   label:"OK",        cls:"g", set:["OK"] },
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
    gear:'<circle cx="11" cy="11" r="3"/><path d="M11 1.8v2.4M11 17.8v2.4M2.2 11h2.4M17.4 11h2.4M4.8 4.8l1.7 1.7M15.5 15.5l1.7 1.7M4.8 17.2l1.7-1.7M15.5 6.5l1.7-1.7"/>',
    engine:'<path d="M4 8.5h7V6.5h4.5v2H17l2-1.6V10h1.2v3.2H19v3.3l-2-1.6h-2.5"/><path d="M4 8.5v6.5h3.2L11 18h3.5v-3.5H4z"/><path d="M4 11.5H2v2h2"/>',
    temp:'<path d="M13 12.4V6a2 2 0 1 0-4 0v6.4a3.6 3.6 0 1 0 4 0z"/><line x1="11" y1="7.5" x2="11" y2="12.8"/>',
    gauge:'<path d="M3.6 15.5a8 8 0 1 1 14.8 0"/><line x1="11" y1="15.5" x2="14.6" y2="9.2"/><circle cx="11" cy="15.5" r="1.4"/>',
    wheel:'<circle cx="11" cy="11" r="8"/><circle cx="11" cy="11" r="2.3"/><line x1="11" y1="3" x2="11" y2="8.7"/><line x1="4.2" y1="15.4" x2="9" y2="12.4"/><line x1="17.8" y1="15.4" x2="13" y2="12.4"/>',
    battery:'<rect x="2.5" y="7" width="15" height="9" rx="1.6"/><path d="M17.5 9.8h2v3.4h-2"/><line x1="6.5" y1="9.7" x2="6.5" y2="13.3"/><line x1="10.5" y1="9.7" x2="10.5" y2="13.3"/>',
    filter:'<path d="M3 4.5h16l-6.3 7.5v5.2l-3.4 1.8v-7z"/>',
  };
  const svg = (name, sz) => '<svg class="vh-i" width="'+(sz||16)+'" height="'+(sz||16)+'" viewBox="0 0 22 22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'+(ICON[name]||"")+'</svg>';

  // ========================= state =========================
  let API=null, STATE=null, NAME_BY_ID={}, GROUP_BY_ID={}, FM_BY_ID={}, COMPUTED=[], LOADING=false, LAST_UPDATED=null, DB="";
  let TAB="breakdown", VIEW="list", FILTER=null, FILTER_ID="all", SEARCH="", WINDOW_DAYS=30;
  // Multi-facet filters that AND-combine with each other and with the disposition pills/KPIs. Each facet is a
  // Set of selected keys (empty = unconstrained); chips within a facet OR together. factor/band are breakdown-only.
  let FACETS = { factor:new Set(), band:new Set(), fuel:new Set(), group:new Set() };
  let FILTERS_OPEN = false;
  // Side-by-side vehicle compare: a selection set (max 4) populated by tapping rows while compare mode is on.
  let COMPARE_MODE = false, COMPARE_SET = [];
  const COMPARE_MAX = 4;
  let COLLAPSED={};          // `${tab}:${actionId}` -> true if collapsed
  let SECTION_LIMIT={};      // `${tab}:${actionId}` -> rows currently shown
  let LAST_FOCUS=null;       // element focus returns to after the drawer closes
  let TRUNC=[];              // names of datasets that hit their result cap (truncated)
  let VIN_CACHE={};          // vin -> { engine, trim, driveline, gvwr, body } from Geotab DecodeVins (cached for the session)
  let CURRENT_DRAWER_ID=null;// vehicle id whose drawer is open (for post-enrichment refresh)
  // ---- configurable settings (loaded from Geotab AddInData on first focus) ----
  let SETTINGS=defaultSettings(); // active cutoffs (defaults until loaded)
  let SETTINGS_ID=null;           // AddInData object id (null until first save; enables in-place updates)
  let CAN_EDIT_SETTINGS=false;    // true only for elevated clearances (fail-safe default: read-only)
  let SETTINGS_LOADED=false, SETTINGS_LOADING=false;
  const ENS_Q=[];                 // callbacks waiting on the one-time settings load
  let SET_FORM=null;              // working copy of settings while the panel is open

  // ========================= persistence (graceful if storage blocked) =========================
  const pKey = () => CONFIG.persistKey + ":" + (DB||"_");
  function saveState(){
    try{ localStorage.setItem(pKey(), JSON.stringify({
      tab:TAB, view:VIEW, filterId:FILTER_ID, windowDays:WINDOW_DAYS, collapsed:COLLAPSED,
      facets:{ factor:[...FACETS.factor], band:[...FACETS.band], fuel:[...FACETS.fuel], group:[...FACETS.group] }
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
      if(s.facets && typeof s.facets==="object"){ ["factor","band","fuel","group"].forEach(f=>{ if(Array.isArray(s.facets[f])) FACETS[f]=new Set(s.facets[f]); }); }
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
  // Resolve a diagnostic id by keyword. Prefers an exact (case-insensitive) name match, else the first
  // substring match. For analog readings, skips enumerated/indicator diagnostics ("... (1. On)") so a
  // reading like "oil pressure" can't bind to a low-pressure warning lamp and fabricate a critical value.
  const INDICATOR_RE = /\(-?\d+\.\s/;
  function resolveId(kw, analog){
    const k=lc(kw); let exact=null, sub=null;
    for(const id in NAME_BY_ID){ const nm=NAME_BY_ID[id]; if(analog && INDICATOR_RE.test(nm)) continue;
      const ln=lc(nm); if(ln===k){ exact=id; break; } if(sub==null && ln.indexOf(k)>-1) sub=id; }
    return exact||sub;
  }
  const isAnalogSignal = cfg => !!(cfg && cfg.dir);
  // Full Diagnostic id->name catalog, needed so keyword-only signals (DEF, DPF temps/pressure/regen, oil
  // pressure, etc.) resolve even when they never appear as a fault. Cached in localStorage (7-day TTL) plus
  // in memory for the session; a manual Refresh clears it. Fail-soft: a load error degrades signal
  // resolution but does not blank the page.
  let DIAG_CAT=null;
  const DIAG_CAT_KEY = () => "vh.diagcat."+(DB||"");
  function clearDiagCatalog(){ DIAG_CAT=null; try{ localStorage.removeItem(DIAG_CAT_KEY()); }catch(e){} }
  function ensureDiagCatalog(done){
    if(DIAG_CAT){ NAME_BY_ID=DIAG_CAT; done(); return; }
    try{ const raw=localStorage.getItem(DIAG_CAT_KEY()); if(raw){ const c=JSON.parse(raw);
      if(c && c.t && (Date.now()-c.t)<7*864e5 && c.m){ DIAG_CAT=c.m; NAME_BY_ID=c.m; done(); return; } } }catch(e){}
    setStatus("Loading diagnostic catalog\u2026");
    API.call("Get",{typeName:"Diagnostic",resultsLimit:50000}, diags=>{
      const m={}; (diags||[]).forEach(d=>{ if(d&&d.id)m[d.id]=d.name||""; });
      DIAG_CAT=m; NAME_BY_ID=m;
      try{ localStorage.setItem(DIAG_CAT_KEY(), JSON.stringify({t:Date.now(),m:m})); }catch(e){}
      done();
    }, err=>{ console.warn("[VehicleHealth] diagnostic catalog load failed; degrading",err); NAME_BY_ID=NAME_BY_ID||{}; done(); });
  }

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
                        "Attention","Recheck"]);
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
      ["Get",{typeName:"FailureMode",resultsLimit:5000}],
    ], r => {
      const devices=r[0],faults=r[1],exceptions=r[2],dvirs=r[3],rules=r[4],allGroups=r[5],trips=r[6],dsiAll=r[7],failModes=r[8];
      if(!devices||!devices.length){ LOADING=false; lockRefresh(false); COMPUTED=[]; LAST_UPDATED=new Date();
        setStatus("No vehicles for the current group filter."); renderAll(); return; }
      const idSet=new Set(devices.map(d=>d.id));
      GROUP_BY_ID={}; (allGroups||[]).forEach(g=>{ GROUP_BY_ID[g.id]=g.name||g.id; });
      FM_BY_ID={}; (failModes||[]).forEach(m=>{ if(m&&m.id)FM_BY_ID[m.id]={code:m.code, name:m.name}; });
      // truncation guard: a Get that returns exactly its cap probably lost records
      TRUNC=[]; if((devices||[]).length>=CONFIG.maxDevices)TRUNC.push("vehicles"); if((faults||[]).length>=CONFIG.faultLimit)TRUNC.push("faults"); if((exceptions||[]).length>=CONFIG.exceptionLimit)TRUNC.push("events"); if((trips||[]).length>=CONFIG.tripLimit)TRUNC.push("trips"); if((dvirs||[]).length>=CONFIG.dvirLimit)TRUNC.push("inspections");

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

      const proceed=()=>{
        (faults||[]).forEach(f=>{ const dv=f.device&&f.device.id; if(!dv||!idSet.has(dv))return; const name=NAME_BY_ID[(f.diagnostic&&f.diagnostic.id)]||""; perDev[dv][classify(f,name)].push(f); });

        const sigKeys=Object.keys(CONFIG.signals);
        const sigId={}; sigKeys.forEach(k=>{ sigId[k]=CONFIG.signals[k].id||resolveId(CONFIG.signals[k].keyword, isAnalogSignal(CONFIG.signals[k])); });
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
            const dtc=dtcTerm(groupByDiagnostic(b.vehicle,NAME_BY_ID,FM_BY_ID));
            const battOcc=b.battery.length;
            const harsh=harshByDev[dev.id]!=null?harshByDev[dev.id]:null;
            const openDef=defectsByDev[dev.id]!=null?defectsByDev[dev.id]:null;
            const tp=tripByDev[dev.id]||null;
            const distanceMi = tp && tp.distM>0 ? tp.distM/1609.344 : null;
            const ctx = tp ? { distanceMi, idleSec:tp.idleSec, driveSec:tp.driveSec } : {};
            const up=usageParts(s,harsh,ctx);
            const terms={ DTC:dtc.score, T:tempTerm(s), P:pressureTerm(s), U:up.score, M:maintTerm(s,openDef), B:batteryTerm(s,battOcc) };
            const usageKind = up.score==null?null:((up.harshBad||0)>=(up.idleBad||0)?"harsh":"idle");
            const hasData = b.vehicle.length||b.battery.length||Object.keys(s).length||(harsh&&harsh>0)||(openDef&&openDef>0);
            const detail = hasData ? buildDetail(s,openDef,battOcc) : null;
            const dFuel=(s.fuelTotal!=null&&f0.fuelTotal!=null)?s.fuelTotal-f0.fuelTotal:null;
            const hk=s.engineHours!=null?"engineHours":(s.engineHoursAdj!=null?"engineHoursAdj":null);
            const dHours=(hk&&f0[hk]!=null)?s[hk]-f0[hk]:null;
            const dsi=dsiByDev[dev.id]||null;
            const geotabRisk = (s.predictedRisk!=null && !isNaN(s.predictedRisk)) ? s.predictedRisk : null;
            let score,disp,em,co2,noDataReason=null;
            if(!hasData){ score=null; disp="No data"; em={score:null,disp:"No data",state:"none",kind:"none",headline:"No emissions data reported.",rows:[],detail:[]}; co2=null;
              const stale = dsi && dsi.lastComm && (Date.now()-new Date(dsi.lastComm).getTime())>SETTINGS.staleHours*3600e3;
              noDataReason = (dsi && (dsi.comm===false || stale)) ? ("Offline"+(dsi.lastComm?" \u00b7 "+timeSince(dsi.lastComm):"")) : "No engine data";
            } else { score=combine(terms); disp=score==null?"Unknown":disposition(dtc.items,terms); em=emissionsHealth(s,dtc.items); co2=co2Estimate(s,dFuel,dHours,CONFIG.statusLookbackSlowDays); }
            const gids=(dev.groups||[]).map(g=>g.id).filter(id=>id && CONFIG.rootGroupIds.indexOf(id)<0);
            const gnames=gids.map(id=>GROUP_BY_ID[id]).filter(Boolean);
            const vin=dev.vehicleIdentificationNumber||null; const vd=decodeVin(vin);
            const make=dev.vinInfoMake||vd.make||null;
            const year=dev.vinInfoYear||(vd.year!=null?String(vd.year):null);
            const model=dev.vinInfoModel||null;
            return { id:dev.id, name:dev.name||dev.id, groups:gids, groupNames:gnames,
              vin, year, make, model, plate:dev.licensePlate||null,
              distanceMi, geotabRisk, lastComm:dsi?dsi.lastComm:null, comm:dsi?dsi.comm:null, noDataReason,
              score, terms, detail, disp, items:dtc.items, battOcc, deviceFaultCount:b.device.length,
              harsh:harshByDev[dev.id]||0, openDefects:defectsByDev[dev.id]||0, usageKind, em, co2, noData:!hasData, sig:s };
          });
          LOADING=false; lockRefresh(false); LAST_UPDATED=new Date(); SECTION_LIMIT={};
          renderAll();
          const trunc = TRUNC.length ? " \u00b7 <b style=\"color:#B54708\">\u26a0 "+TRUNC.join("/")+" truncated \u2014 narrow window/group</b>" : "";
          setStatus("<b>"+COMPUTED.length+"</b> vehicles \u00b7 "+WINDOW_DAYS+"-day window"+trunc);
          announce(COMPUTED.length+" vehicles loaded. "+actionNeededCount()+" need attention."+(TRUNC.length?" Warning: some results were truncated.":""));
          enrichVins();
        };

        if(!calls.length){ compute({},{}); return; }
        setStatus("Reading "+calls.length+" signal series across the fleet\u2026");
        API.multiCall(calls, results => {
          const latestBy={}, firstBy={}, latestT={}, firstT={};
          let sigTrunc=false;
          results.forEach((rows,i)=>{ const k=active[i]; if(!rows)return;
            if(rows.length>=CONFIG.statusLimitPerDiagnostic)sigTrunc=true;
            rows.forEach(rec=>{ const dv=rec.device&&rec.device.id; if(!dv||!idSet.has(dv))return; const t=new Date(rec.dateTime).getTime();
              const lT=(latestT[dv]=latestT[dv]||{}); if(lT[k]==null||t>lT[k]){ (latestBy[dv]=latestBy[dv]||{})[k]=rec.data; lT[k]=t; }
              const fT=(firstT[dv]=firstT[dv]||{}); if(fT[k]==null||t<fT[k]){ (firstBy[dv]=firstBy[dv]||{})[k]=rec.data; fT[k]=t; }
            });
          });
          if(sigTrunc && TRUNC.indexOf("signal readings")<0)TRUNC.push("signal readings");
          compute(latestBy,firstBy);
        }, fail);
      };

      ensureDiagCatalog(proceed);
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
  function countsOver(rows){ const c={}; rows.forEach(r=>{ const d=dispOf(r); c[d]=(c[d]||0)+1; }); return c; }
  function isCollapsed(id){ const key=TAB+":"+id;
    if(Object.prototype.hasOwnProperty.call(COLLAPSED,key)) return !!COLLAPSED[key];
    return CONFIG.defaultCollapsedActions.indexOf(id)>-1; }
  // ---- facet model ----
  const FACTOR_FACET = [["DTC","Engine faults"],["T","Temperature"],["P","Pressure"],["U","Usage"],["M","Maintenance"],["B","Battery"]];
  const BAND_FACET   = [["high","High risk"],["prio","Priority maint."],["sched","Schedule inspection"],["monitor","Monitor"],["normal","Normal"]];
  const FUEL_FACET   = [["gas","Gas"],["diesel","Diesel"]];
  function bandKeyOf(score){ if(score==null)return null; return score>=90?"high":score>=75?"prio":score>=60?"sched":score>=40?"monitor":"normal"; }
  // factor/band describe the breakdown-risk model only; on the emissions tab they don't apply.
  const facetApplies = name => (name==="factor"||name==="band") ? TAB==="breakdown" : true;
  function anyFacetActive(){ return (facetApplies("factor")&&FACETS.factor.size) || (facetApplies("band")&&FACETS.band.size) || FACETS.fuel.size || FACETS.group.size; }
  function activeFacetChips(){ let n=0; if(facetApplies("factor"))n+=FACETS.factor.size; if(facetApplies("band"))n+=FACETS.band.size; n+=FACETS.fuel.size+FACETS.group.size; return n; }
  function searchMatch(r,q){ return r.name.toLowerCase().indexOf(q)>-1 || r.groupNames.join(" ").toLowerCase().indexOf(q)>-1; }
  function matchFacetsExcept(r, exclude){
    if(exclude!=="factor" && facetApplies("factor") && FACETS.factor.size){ const t=r.terms||{}; if(![...FACETS.factor].some(k=>t[k]!=null && t[k]>=40)) return false; }
    if(exclude!=="band" && facetApplies("band") && FACETS.band.size){ const bk=bandKeyOf(r.score); if(!bk || !FACETS.band.has(bk)) return false; }
    if(exclude!=="fuel" && FACETS.fuel.size){ const k=r.em&&r.em.kind; if(!k || !FACETS.fuel.has(k)) return false; }
    if(exclude!=="group" && FACETS.group.size){ const names=(r.groupNames&&r.groupNames.length)?r.groupNames:["(No group)"]; if(!names.some(n=>FACETS.group.has(n))) return false; }
    return true;
  }
  const matchFacets = r => matchFacetsExcept(r, null);
  // COMPUTED filtered by search + every active filter EXCEPT `dim` (disposition/factor/band/fuel/group, or null for
  // all). Counts for each control are taken over scopeExcept(thatControl) so chips/pills cross-reflect the OTHER
  // active filters instead of showing stale fleet totals.
  function scopeExcept(dim){
    const q=SEARCH?SEARCH.toLowerCase():null;
    return COMPUTED.filter(r=>{
      if(q && !searchMatch(r,q)) return false;
      if(dim!=="disposition" && FILTER && !FILTER.has(dispOf(r))) return false;
      return matchFacetsExcept(r, dim);
    });
  }
  function filteredRows(){ return scopeExcept(null); }
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
    renderPills();
    renderFilters();
    renderCompareBar();
    if(VIEW==="group") renderGroupView(); else renderList();
    saveState();
  }

  function renderSummary(){
    const wrap=el("vh-summary"); if(!wrap)return;
    if(LOADING){ wrap.innerHTML=""; return; }
    const base=scopeExcept("disposition"); const total=base.length, c=countsOver(base), kpis=kpisFor(), need=base.filter(r=>NEED.has(dispOf(r))).length, upd=lastUpdatedText();
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

  // Quick disposition filter pills: All + each action present in the current tab, with live counts. These share
  // the single FILTER slot with the KPI cards - a finer, per-disposition shortcut. Shown in list and group views.
  function renderPills(){
    const box=el("vh-pills"); if(!box)return;
    if(LOADING || !COMPUTED.length){ box.innerHTML=""; box.classList.remove("on"); return; }
    const base=scopeExcept("disposition"), c=countsOver(base);
    const present=actionsFor().filter(a=>a.id!=="Unknown" && (c[a.id]||0)>0);
    if(!present.length){ box.innerHTML=""; box.classList.remove("on"); return; }
    const allSel=!FILTER_ID || FILTER_ID==="all";
    let html='<button class="vh-fpill'+(allSel?" on":"")+'" type="button" data-pill="all" aria-pressed="'+(allSel?"true":"false")+'">All <b>'+base.length+'</b></button>';
    html+=present.map(a=>{ const id="act:"+a.id, sel=FILTER_ID===id;
      return '<button class="vh-fpill p-'+a.cls+(sel?" on":"")+'" type="button" data-pill="'+esc(id)+'" aria-pressed="'+(sel?"true":"false")+'" title="'+esc(a.desc)+'">'
        +'<span class="fp-dot" aria-hidden="true"></span>'+esc(a.short)+' <b>'+(c[a.id]||0)+'</b></button>'; }).join("");
    box.innerHTML=html; box.classList.add("on");
    box.querySelectorAll("[data-pill]").forEach(b=>b.addEventListener("click",()=>{
      const id=b.getAttribute("data-pill");
      if(id==="all" || FILTER_ID===id){ setFilter("all",null); return; }
      setFilter(id, filterSetFromId(id));
    }));
  }

  // Advanced facet filters (collapsible panel): Risk factor / Score band (breakdown only) + Fuel + Vehicle group.
  // Multi-select; AND-combine across facets and with the disposition pills. Counts are fleet totals per chip.
  function factorCount(k,rows){ let n=0; rows.forEach(r=>{ const v=r.terms&&r.terms[k]; if(v!=null&&v>=40)n++; }); return n; }
  function bandCount(k,rows){ let n=0; rows.forEach(r=>{ if(bandKeyOf(r.score)===k)n++; }); return n; }
  function fuelCount(k,rows){ let n=0; rows.forEach(r=>{ if(r.em&&r.em.kind===k)n++; }); return n; }
  function groupChips(rows){ const m={}; rows.forEach(r=>{ const names=(r.groupNames&&r.groupNames.length)?r.groupNames:["(No group)"]; names.forEach(n=>{ m[n]=(m[n]||0)+1; }); });
    return Object.keys(m).map(n=>({key:n,label:n,n:m[n]})).sort((a,b)=> b.n-a.n || (a.label<b.label?-1:1)); }
  function facetGroup(title, facet, chips, hint){
    if(!chips.length) return "";
    return '<div class="vh-fgrp"><div class="vh-fgrp-h">'+esc(title)+'</div>'
      + (hint?'<div class="vh-fgrp-hint">'+esc(hint)+'</div>':'')
      + '<div class="vh-fchips">'
      + chips.map(c=>{ const on=FACETS[facet].has(c.key);
        return '<button class="vh-fchip'+(on?" on":"")+'" type="button" data-facet="'+esc(facet)+'" data-key="'+esc(c.key)+'" aria-pressed="'+(on?"true":"false")+'">'+esc(c.label)+(c.n!=null?' <b>'+c.n+'</b>':'')+'</button>'; }).join("")
      + '</div></div>';
  }
  function renderFilters(){
    const panel=el("vh-filters"), btn=el("vh-filters-btn"); if(!panel)return;
    const n=activeFacetChips(), badge=el("vh-fbadge");
    if(badge){ badge.textContent=n>0?String(n):""; badge.hidden=!(n>0); }
    if(btn) btn.classList.toggle("hasfilters", n>0);
    if(LOADING || !COMPUTED.length){ panel.innerHTML=""; panel.classList.remove("open"); if(btn)btn.setAttribute("aria-expanded","false"); FILTERS_OPEN=false; return; }
    let groups="";
    if(TAB==="breakdown"){
      const rf=scopeExcept("factor"); groups += facetGroup("Risk factor","factor", FACTOR_FACET.map(o=>({key:o[0],label:o[1],n:factorCount(o[0],rf)})).filter(c=>c.n>0));
      const rb=scopeExcept("band"); groups += facetGroup("Score band","band", BAND_FACET.map(o=>({key:o[0],label:o[1],n:bandCount(o[0],rb)})).filter(c=>c.n>0), "The 0\u2013100 risk index. Separate from the action filters above \u2014 a vehicle with a low score can still be flagged for service.");
    }
    const ru=scopeExcept("fuel"); groups += facetGroup("Fuel","fuel", FUEL_FACET.map(o=>({key:o[0],label:o[1],n:fuelCount(o[0],ru)})).filter(c=>c.n>0));
    const rg=scopeExcept("group"); groups += facetGroup("Vehicle group","group", groupChips(rg));
    panel.innerHTML='<div class="vh-fpanel-in">'+(groups||'<div class="vh-fgrp-h">No filterable attributes in the current data.</div>')
      +'<div class="vh-fpanel-foot"><button class="vh-btn vh-btn-ghost vh-fclear" type="button"'+(anyFacetActive()?"":" disabled")+'>Clear filters</button>'
      +'<span class="vh-fpanel-msg">'+filteredRows().length+' of '+COMPUTED.length+' vehicles</span></div></div>';
    panel.classList.toggle("open", FILTERS_OPEN);
    if(btn)btn.setAttribute("aria-expanded", FILTERS_OPEN?"true":"false");
    panel.querySelectorAll("[data-facet]").forEach(b=>b.addEventListener("click",()=>toggleFacet(b.getAttribute("data-facet"), b.getAttribute("data-key"))));
    const clr=panel.querySelector(".vh-fclear"); if(clr)clr.addEventListener("click",clearFacets);
  }
  function toggleFacet(facet,key){ const set=FACETS[facet]; if(!set)return; if(set.has(key))set.delete(key); else set.add(key);
    SECTION_LIMIT={}; renderAll(); announce("Showing "+filteredRows().length+" vehicles"); }
  function clearFacets(){ FACETS.factor.clear(); FACETS.band.clear(); FACETS.fuel.clear(); FACETS.group.clear();
    SECTION_LIMIT={}; renderAll(); announce("Filters cleared"); }
  function toggleFiltersPanel(){ FILTERS_OPEN=!FILTERS_OPEN; renderFilters(); }

  // ---- side-by-side compare ----
  function setCompareMode(on){
    COMPARE_MODE=!!on; if(!COMPARE_MODE)COMPARE_SET=[];
    if(COMPARE_MODE && VIEW!=="list")VIEW="list";
    closeDrawer();
    const b=el("vh-compare-btn"); if(b){ b.classList.toggle("on",COMPARE_MODE); b.setAttribute("aria-pressed",COMPARE_MODE?"true":"false"); }
    renderAll();
    announce(COMPARE_MODE?"Compare mode on. Select up to "+COMPARE_MAX+" vehicles.":"Compare mode off.");
  }
  function toggleCompare(id){
    const i=COMPARE_SET.indexOf(id);
    if(i>-1) COMPARE_SET.splice(i,1);
    else { if(COMPARE_SET.length>=COMPARE_MAX){ announce("You can compare up to "+COMPARE_MAX+" vehicles."); return; } COMPARE_SET.push(id); }
    renderAll();
  }
  function clearCompare(){ COMPARE_SET=[]; renderAll(); }
  function renderCompareBar(){
    const bar=el("vh-comparebar"); if(!bar)return;
    if(!COMPARE_MODE || LOADING){ bar.innerHTML=""; bar.classList.remove("on"); return; }
    const chips=COMPARE_SET.map(id=>{ const r=COMPUTED.find(x=>x.id===id); const nm=r?r.name:id;
      return '<span class="vh-cchip">'+esc(nm)+'<button type="button" class="vh-cx" data-cclear="'+esc(id)+'" aria-label="Remove '+esc(nm)+'">'+svg("close",12)+'</button></span>'; }).join("");
    bar.innerHTML='<span class="vh-cbar-lab">Compare \u00b7 '+COMPARE_SET.length+'/'+COMPARE_MAX+' selected</span>'
      +'<span class="vh-cbar-chips">'+(chips||'<span class="vh-muted">Tap vehicles in the list to add them.</span>')+'</span>'
      +'<span class="sp" style="flex:1"></span>'
      +'<button class="vh-btn vh-btn-ghost vh-cbar-clear" type="button"'+(COMPARE_SET.length?"":" disabled")+'>Clear</button>'
      +'<button class="vh-btn vh-cbar-go" type="button"'+(COMPARE_SET.length>=2?"":" disabled")+'>Compare '+(COMPARE_SET.length>=2?"("+COMPARE_SET.length+")":"")+'</button>';
    bar.classList.add("on");
    bar.querySelectorAll("[data-cclear]").forEach(b=>b.addEventListener("click",e=>{ e.stopPropagation(); toggleCompare(b.getAttribute("data-cclear")); }));
    const cl=bar.querySelector(".vh-cbar-clear"); if(cl)cl.addEventListener("click",clearCompare);
    const go=bar.querySelector(".vh-cbar-go"); if(go)go.addEventListener("click",openCompare);
  }
  function cmpScoreCell(v){ if(v==null)return '<span class="vh-muted">\u2014</span>'; const c=bandColor(v); return '<b style="color:'+c+'">'+Math.round(v)+'</b>'; }
  function cmpSig(raw,cfg,disp){ if(raw==null)return '<span class="vh-muted">\u2014</span>'; const sev=signalBadness(raw,cfg.normal,cfg.critical,cfg.dir);
    const c = sev==null?"#344054" : sev>=100?"#B42318" : sev>=60?"#B54708" : sev>0?"#854A0E" : "#067647"; return '<span style="color:'+c+';font-weight:700">'+esc(disp)+'</span>'; }
  function compareRows(list){
    const cell=(html)=>'<td>'+html+'</td>';
    const row=(label,fn)=>'<tr><th scope="row">'+esc(label)+'</th>'+list.map(r=>cell(fn(r))).join("")+'</tr>';
    const term=(r,k)=>{ const v=r.terms&&r.terms[k]; return v==null?'<span class="vh-muted">\u2014</span>':cmpScoreCell(v); };
    const dr=r=>{ const d=drivability(r); const c={attention:"#B42318",recheck:"#B54708",ok:"#067647",none:"#667085"}[d.tone]; return '<span style="color:'+c+';font-weight:700">'+esc(d.label.replace(/\u2014/g,"-"))+'</span>'; };
    const sig=r=>r.sig||{};
    let h="";
    h+=row("Recommended action", r=>esc(r.disp||"\u2014"));
    h+=row("Drivability", dr);
    h+=row("Risk score", r=>cmpScoreCell(r.score));
    h+=row("Risk band", r=>esc(bandLabelOf(r.score)||"\u2014"));
    h+=row("Geotab predicted risk", r=>r.geotabRisk==null?'<span class="vh-muted">\u2014</span>':Math.round(r.geotabRisk)+"%");
    h+=row("Faults", r=>term(r,"DTC")); h+=row("Temp", r=>term(r,"T")); h+=row("Pressure", r=>term(r,"P"));
    h+=row("Usage", r=>term(r,"U")); h+=row("Maintenance", r=>term(r,"M")); h+=row("Battery", r=>term(r,"B"));
    h+=row("Coolant temp", r=>sig(r).coolant!=null?cmpSig(sig(r).coolant,CONFIG.signals.coolant,cToF(sig(r).coolant)+"\u00b0F"):'<span class="vh-muted">\u2014</span>');
    h+=row("Oil pressure", r=>sig(r).oilPressure!=null?cmpSig(sig(r).oilPressure,CONFIG.signals.oilPressure,kpaToPsi(sig(r).oilPressure)+" psi"):'<span class="vh-muted">\u2014</span>');
    h+=row("Battery voltage", r=>sig(r).deviceVoltage!=null?cmpSig(sig(r).deviceVoltage,CONFIG.signals.deviceVoltage,(Math.round(sig(r).deviceVoltage*10)/10).toFixed(1)+" V"):'<span class="vh-muted">\u2014</span>');
    h+=row("DEF level", r=>sig(r).defLevel!=null?cmpSig(sig(r).defLevel,CONFIG.signals.defLevel,Math.round(sig(r).defLevel)+"%"):'<span class="vh-muted">\u2014</span>');
    h+=row("Emissions", r=>esc((r.em&&r.em.disp)||"\u2014"));
    h+=row("CO\u2082 / engine-hr", r=>r.co2&&r.co2.perHour!=null?r.co2.perHour.toFixed(1)+" kg":'<span class="vh-muted">\u2014</span>');
    h+=row("Open defects", r=>String(r.openDefects||0));
    h+=row("Harsh events", r=>String(r.harsh||0));
    h+=row("Last reported", r=>r.lastComm?esc(timeSince(r.lastComm))+" ago":(r.comm===false?"Offline":'<span class="vh-muted">\u2014</span>'));
    return h;
  }
  function renderCompare(){
    const md=el("vh-compare"); if(!md)return;
    const list=COMPARE_SET.map(id=>COMPUTED.find(x=>x.id===id)).filter(Boolean);
    const cols=list.map(r=>{ const st=vehicleSubtitle(r); return '<th scope="col"><span class="vh-cc-nm">'+esc(r.name)+'</span>'+(st?'<span class="vh-cc-sub">'+esc(st)+'</span>':'')+'</th>'; }).join("");
    md.innerHTML='<div class="vh-mhead"><div><h3 id="vh-compare-title">Compare vehicles</h3>'
        +'<p>Side-by-side \u00b7 '+list.length+' vehicles. Coloured cells flag the more concerning values.</p></div>'
        +'<button class="vh-x" type="button" aria-label="Close compare">'+svg("close",16)+'</button></div>'
      +'<div class="vh-mbody"><div class="vh-ctable-wrap"><table class="vh-ctable"><thead><tr><th scope="col" class="vh-cc-corner">Metric</th>'+cols+'</tr></thead>'
        +'<tbody>'+compareRows(list)+'</tbody></table></div></div>';
    const x=md.querySelector(".vh-x"); if(x)x.addEventListener("click",closeCompare);
  }
  function showCompare(on){
    const sc=el("vh-cscrim"), md=el("vh-compare");
    if(sc)sc.classList.toggle("on",!!on);
    if(md){ md.classList.toggle("on",!!on); md.setAttribute("aria-hidden",on?"false":"true"); }
    if(on){ const x=md&&md.querySelector(".vh-x"); if(x&&x.focus)x.focus(); }
    else { const b=el("vh-compare-btn"); if(b&&b.focus)b.focus(); }
  }
  function openCompare(){ if(COMPARE_SET.length<2)return; renderCompare(); showCompare(true); }
  function closeCompare(){ showCompare(false); }
  function compareKeydown(e){
    if(e.key==="Escape"){ e.preventDefault(); closeCompare(); return; }
    if(e.key!=="Tab")return;
    const md=el("vh-compare"); if(!md)return;
    const f=md.querySelectorAll("button:not([disabled])"); if(!f.length)return;
    const first=f[0], last=f[f.length-1];
    if(e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
  }

  function showLoading(){ const w=el("vh-listwrap"); if(w)w.innerHTML='<div class="vh-state"><div class="vh-spin" role="status" aria-label="Loading"></div><div class="t">Loading fleet data\u2026</div><div class="d">Fetching faults, signals and events from Geotab.</div></div>'; const s=el("vh-summary"); if(s)s.innerHTML=""; }
  function showError(){ const w=el("vh-listwrap"); if(w)w.innerHTML='<div class="vh-state"><div class="ico" style="color:'+SWATCH.o+'">'+svg("alert",28)+'</div><div class="t">Could not load data</div><div class="d">See the status line above, then try Refresh.</div></div>'; }
  function stateBox(icon,colour,t,d){ return '<div class="vh-state"><div class="ico" style="color:'+colour+'">'+svg(icon,28)+'</div><div class="t">'+esc(t)+'</div><div class="d">'+esc(d)+'</div></div>'; }

  // ========================= rendering: grouped list + rows =========================
  // Plain-language risk chips: name the problem (and, for live signals, the actual reading) instead of a 0-100 number.
  const chipBandClass = v => v==null?"g" : v>=75?"r" : v>=60?"o" : v>=40?"a" : "g";
  function vchip(main,reading,v,title){
    const rd = reading ? '<span class="vh-chip-rd">'+esc(reading)+'</span>' : '';
    return '<span class="vh-chip chip-'+chipBandClass(v)+'"'+(title?' title="'+esc(title)+'"':'')+'>'
      +'<span class="vh-chip-tx">'+esc(main)+'</span>'+rd+'</span>';
  }
  function worstFault(r){ if(!r.items||!r.items.length)return null;
    let best=null; r.items.forEach(i=>{ if(best==null||(i.contribution||0)>(best.contribution||0))best=i; }); return best; }
  // Short human reading for a factor's dominant signal (US-customary units), or "" if none.
  function readingText(k,d){ if(!d)return ""; const who=d.who, val=d.value;
    if(k==="T")return cToF(val)+"\u00b0F";
    if(k==="P")return kpaToPsi(val)+" psi";
    if(k==="B")return who==="battFault" ? (val+" fault"+(val>1?"s":"")) : (Math.round(val*10)/10).toFixed(1)+" V";
    if(k==="M"){ if(who==="mil")return "check-engine on"; if(who==="oilLife")return Math.round(val)+"% oil life"; if(who==="defects")return val+" open defect"+(val>1?"s":""); }
    return "";
  }
  function factorLabel(r,k){
    if(k==="T")return "Running hot";
    if(k==="P"){ const w=r.detail&&r.detail.P&&r.detail.P.who;
      return w==="boost"?"High boost":w==="fuelPressure"?"Low fuel pressure":w==="oilPressure"?"Low oil pressure":"Low pressure"; }
    if(k==="B")return "Weak battery";
    if(k==="M"){ const w=r.detail&&r.detail.M&&r.detail.M.who; return w==="mil"?"Check-engine on":"Maintenance due"; }
    return TERM_LABEL[k]||k;
  }
  function contribHTML(r){
    const terms=r.terms; if(!terms)return "";
    return topContributors(terms).map(c=>{
      const k=c.k, v=c.v;
      if(k==="DTC"){
        const it=worstFault(r);
        if(it){ const st=it.domState?String(it.domState).toLowerCase():"";
          const rd=it.intermittent?((st?st+" \u00b7 ":"")+"intermittent"):st;
          return vchip(it.name+(it.safety?" \u26a0":""), rd, v, it.name+(it.safety?" (safety system)":"")); }
        return vchip("Engine fault","",v,"");
      }
      const main=factorLabel(r,k), rd=readingText(k, r.detail&&r.detail[k]);
      return vchip(main, rd, v, main+(rd?" \u2014 "+rd:""));
    }).join("");
  }
  function behaviorChip(r){
    const u=r.terms&&r.terms.U;
    if(u==null||u<40) return "";   // only flag clearly elevated behaviour; full detail lives in the drawer
    const label = r.usageKind==="idle" ? "High idle" : "Harsh driving";
    return '<span class="vh-chip chip-behavior" title="Driver behaviour \u2014 not a breakdown fault">'+esc(label)+'</span>';
  }
  function scoreMini(v){ if(v==null) return '<span class="vh-score na" aria-label="no data">\u2014</span>';
    const col=bandColor(v);
    return '<span class="vh-score" aria-label="'+Math.round(v)+' of 100, lower is healthier"><b style="color:'+col+'">'+Math.round(v)+'</b>'
      +'<span class="vh-track"><i style="width:'+Math.max(4,Math.round(v))+'%;background:'+col+'"></i></span></span>'; }

  // Vertical factor bars: a compact at-a-glance read of all six breakdown factors next to the plain-language
  // chips. Recognisable icon per factor, bar height = the factor's 0-100 score, colour by severity band, quiet
  // factors faded. Decorative (aria-hidden) - the chips already convey the same information to screen readers.
  const FB_ORDER = ["DTC","T","P","U","M","B"];
  const FB_ICON  = { DTC:"engine", T:"temp", P:"gauge", U:"wheel", M:"wrench", B:"battery" };
  const FB_NAME  = { DTC:"Engine faults", T:"Temperature", P:"Pressure", U:"Usage", M:"Maintenance", B:"Battery" };
  const FB_COL   = v => v==null ? null : v>=75 ? "#B42318" : v>=60 ? "#D85A30" : v>=40 ? "#BA7517" : null;
  function factorBars(r){
    const t=r.terms||{};
    return '<span class="vh-fbars" aria-hidden="true">'+FB_ORDER.map(k=>{
      const v=t[k], hot=v!=null && v>=40, col=FB_COL(v);
      const h = v==null ? 0 : (hot ? Math.max(22,Math.min(100,Math.round(v))) : Math.max(14,Math.round(v)));
      const sty = hot ? ' style="color:'+col+'"' : '';
      const title = FB_NAME[k] + (v==null ? " \u2014 not reported" : hot ? " \u2014 elevated ("+Math.round(v)+"/100)" : " \u2014 normal");
      return '<span class="vh-fbar'+(hot?"":" q")+'"'+sty+' title="'+esc(title)+'">'
        +'<span class="vh-fbar-t"><i style="height:'+h+'%"></i></span>'
        +'<span class="vh-fbar-ic">'+svg(FB_ICON[k],12)+'</span></span>';
    }).join("")+'</span>';
  }
  function factorLegend(){
    return '<div class="vh-fbleg" aria-hidden="true"><span class="vh-fbleg-h">Risk factors</span>'
      + FB_ORDER.map(k=>'<span class="vh-fbleg-i">'+svg(FB_ICON[k],13)+esc(FB_NAME[k])+'</span>').join("")
      + '</div>';
  }

  function rowHTML(r,a){
    const dev=r.deviceFaultCount?' <span class="vh-tag" title="Telematics device fault recorded \u2014 excluded from score">device</span>':'';
    const grp=r.groupNames.length?'<span class="vh-rowgrp">'+esc(r.groupNames[0])+(r.groupNames.length>1?' +'+(r.groupNames.length-1):'')+'</span>':'';
    const subt=vehicleSubtitle(r);
    const sub=subt?'<span class="vh-rowsub">'+esc(subt)+'</span>':'';
    const csel = COMPARE_MODE && COMPARE_SET.indexOf(r.id)>-1;
    const cmpCls = (COMPARE_MODE?" cmp":"")+(csel?" sel":"");
    const head='<span class="vh-dot" style="background:'+HUE[a.cls]+'" aria-hidden="true"></span>'
      +'<span class="vh-rowname"><span class="vh-rowtop"><span class="vh-nm">'+esc(r.name)+'</span>'+dev+grp+'</span>'+sub+'</span>';
    if(TAB==="breakdown"){
      const mid = r.noData ? '<span class="vh-chip chip-none">'+esc(r.noDataReason||"No data")+'</span>'
        : ((contribHTML(r)+behaviorChip(r)) || '<span class="vh-chip chip-none">No active issues</span>');
      const bars = r.noData ? '' : factorBars(r);
      const aria=esc(r.name+(subt?" ("+subt+")":"")+", action "+a.short+", risk score "+(r.score==null?"no data":Math.round(r.score)+" of 100")+(COMPARE_MODE?(csel?". Selected for compare. Activate to deselect.":". Activate to select for compare."):". Activate for details."));
      return '<div class="vh-row bd'+(r.noData?" nodata":"")+cmpCls+'" role="button" tabindex="0" data-id="'+esc(r.id)+'"'+(COMPARE_MODE?' aria-pressed="'+(csel?"true":"false")+'"':'')+' aria-label="'+aria+'">'
        +head+'<span class="vh-contrib">'+mid+'</span><span class="vh-fbarcell">'+bars+'</span>'
        +'<span class="vh-scorecell">'+scoreMini(r.score)+'</span>'
        +'<span class="vh-chev" aria-hidden="true">'+svg(csel?"check":"chevron",15)+'</span></div>';
    }
    const finding = r.noData ? (r.noDataReason||"No data") : ((r.em.detail&&r.em.detail.length)?r.em.detail[0]:(r.em.score===0?"No issues detected":"\u2014"));
    const co2=r.co2?fmtInt(r.co2.totalKg):"\u2014";
    const ph=r.co2&&r.co2.perHour!=null?('<span class="vh-ph">~'+r.co2.perHour.toFixed(1)+' kg/hr</span>'):'';
    const aria=esc(r.name+(subt?" ("+subt+")":"")+", action "+a.short+". "+finding+(COMPARE_MODE?(csel?". Selected for compare.":". Activate to select for compare."):". Activate for details."));
    return '<div class="vh-row em'+(r.noData?" nodata":"")+cmpCls+'" role="button" tabindex="0" data-id="'+esc(r.id)+'"'+(COMPARE_MODE?' aria-pressed="'+(csel?"true":"false")+'"':'')+' aria-label="'+aria+'">'
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
      ? '<div class="vh-colhead bd"><span></span><span>Vehicle</span><span style="grid-column:span 2">Top risk factors</span><span class="ralign">Risk score <span class="vh-colhint">lower = healthier</span></span><span></span></div>'
      : '<div class="vh-colhead em"><span></span><span>Vehicle</span><span>Finding</span><span class="ralign">CO\u2082 (kg)</span><span></span></div>';

    let html=(TAB==="breakdown"?factorLegend():"")+colhead;
    order.forEach(a=>{ const list=byAction[a.id]; if(!list||!list.length)return;
      sortWithin(list);
      const key=TAB+":"+a.id, collapsed=isCollapsed(a.id), limit=SECTION_LIMIT[key]||CONFIG.sectionPreviewRows;
      const shown=collapsed?[]:list.slice(0,limit);
      const bodyId="sec-"+TAB+"-"+a.id.replace(/[^a-z0-9]+/gi,"-").toLowerCase();
      html+='<div class="vh-sec'+(NEED.has(a.id)?" need":"")+'">'
        +'<button class="vh-sechead s-'+esc(a.cls)+'" data-sec="'+esc(a.id)+'" aria-expanded="'+(collapsed?"false":"true")+'" aria-controls="'+bodyId+'">'
          +'<span class="vh-sechev'+(collapsed?'':' open')+'" aria-hidden="true">'+svg("chevron",13)+'</span>'
          +'<span class="vh-sicon" style="color:'+HUE[a.cls]+'" aria-hidden="true">'+svg(a.icon,16)+'</span>'
          +'<span class="vh-secname">'+esc(a.short)+'</span>'
          +'<span class="vh-seccount">'+list.length+'</span>'
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
      const act=()=>{ const id=rw.getAttribute("data-id"); if(COMPARE_MODE) toggleCompare(id); else openDrawer(id,rw); };
      rw.addEventListener("click",act);
      rw.addEventListener("keydown",e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); act(); } });
    });
  }

  // ========================= rendering: group rollup =========================
  function groupRollup(){
    const map={};
    filteredRows().forEach(r=>{ const names=r.groupNames.length?r.groupNames:["(No group)"]; const need=NEED.has(dispOf(r));
      names.forEach(n=>{ const g=map[n]||(map[n]={name:n,total:0,need:0}); g.total++; if(need)g.need++; }); });
    return Object.keys(map).map(k=>map[k]).sort((a,b)=> (b.need-a.need)||(b.total-a.total)||(a.name<b.name?-1:1));
  }
  function renderGroupView(){
    const wrap=el("vh-listwrap"); if(!wrap)return;
    if(LOADING){ showLoading(); return; }
    if(!COMPUTED.length){ wrap.innerHTML=stateBox("dash",SWATCH.x,"No vehicles to show","Adjust the group filter, then Refresh."); return; }
    const rolls=groupRollup();
    if(!rolls.length){ wrap.innerHTML=stateBox("search",SWATCH.c,"No matches","No vehicles match this filter or search."); return; }
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
  // When the recommended action is more serious than the composite score implies, name what drove it
  // (a fault, a weak battery, a hot/over-pressure reading) so the gauge can explain the mismatch. "" = no mismatch.
  function escalationDriver(r){
    if(r.score==null)return "";
    const v=Math.round(r.score);
    const floor={ "Remove from service":60, "Service now":60, "Schedule diagnostic":40 }[r.disp];
    if(floor==null || v>=floor) return "";   // action matches the score - nothing to reconcile
    const active=(r.items||[]).filter(i=>i.domState==="Active").sort((a,b)=>(b.contribution||0)-(a.contribution||0));
    const af=active[0];
    if(af && (af.worstLamp>=60 || (af.worstSeverity||0)>=60 || (af.maxRisk||0)>=CONFIG.riskServiceNow || af.safety))
      return "a specific active fault \u2014 "+af.name;
    if(r.terms && r.terms.B!=null && r.terms.B>=60) return "a weak battery ("+Math.round(r.terms.B)+"/100)";
    if(r.terms && r.terms.T!=null && r.terms.T>=CONFIG.signalActionBand) return "a high temperature reading";
    if(r.terms && r.terms.P!=null && r.terms.P>=CONFIG.signalActionBand) return "an abnormal pressure reading";
    if(af) return "an active fault";
    const pf=(r.items||[]).filter(i=>i.domState==="Pending")[0];
    if(pf) return "a pending fault \u2014 "+pf.name;
    if((r.items||[]).some(i=>i.intermittent)) return "an intermittent fault";
    if((r.items||[]).length) return "a diagnostic fault";
    return "";
  }
  function riskGauge(r){
    if(r.score==null){
      return '<div class="vh-gauge nodata"><div class="vh-gauge-top"><span class="vh-gauge-num na">\u2014</span>'
        +'<span class="vh-gauge-sub">no engine data to score</span></div></div>';
    }
    const v=Math.round(r.score), pos=clamp(v,0,100), col=bandColor(v);
    const driver=escalationDriver(r);
    const note=driver
      ? '<div class="vh-gauge-note">Overall risk is '+(v<40?"low":"moderate")+' ('+v+'/100). This vehicle is flagged \u201c'+esc(r.disp)+'\u201d because of '+esc(driver)+', not its composite score.</div>'
      : '';
    return '<div class="vh-gauge">'
      +'<div class="vh-gauge-top"><span class="vh-gauge-num" style="color:'+col+'">'+v+'<span class="vh-gauge-max">/100</span></span>'
      +'<span class="vh-gauge-sub">breakdown-risk index \u00b7 lower is healthier</span></div>'
      +'<div class="vh-gauge-track"><span class="vh-gauge-mark" style="left:'+pos+'%"></span></div>'
      +'<div class="vh-gauge-ticks"><span>0</span><span>50</span><span>100</span></div>'
      +note+'</div>';
  }

  // Operating-range indicator: a healthy/warning/critical track (from the configured normal/critical thresholds,
  // not an OEM datasheet) with a marker at the live reading. dir="high" => higher is worse; dir="low" => lower is worse.
  function rangeBar(value, cfg){
    const dir=cfg.dir, nrm=cfg.normal, crit=cfg.critical, band=Math.abs(nrm-crit)||1;
    const G="#5FBF7A", Y="#EBBF49", R="#E0533A"; let lo, hi, grad;
    if(dir==="high"){ lo=nrm-band; hi=crit+band;
      const a=(nrm-lo)/(hi-lo)*100, b=(crit-lo)/(hi-lo)*100;
      grad="linear-gradient(90deg,"+G+" 0%,"+G+" "+a+"%,"+Y+" "+a+"%,"+Y+" "+b+"%,"+R+" "+b+"%,"+R+" 100%)";
    } else { lo=crit-band; if(lo<0)lo=0; hi=nrm+band;
      const a=(crit-lo)/(hi-lo)*100, b=(nrm-lo)/(hi-lo)*100;
      grad="linear-gradient(90deg,"+R+" 0%,"+R+" "+a+"%,"+Y+" "+a+"%,"+Y+" "+b+"%,"+G+" "+b+"%,"+G+" 100%)";
    }
    const pos=clamp((value-lo)/(hi-lo),0,1)*100;
    return '<span class="vh-rng"><span class="vh-rng-bar" style="background:'+grad+'"></span><span class="vh-rng-mark" style="left:'+pos+'%"></span></span>';
  }
  function readingRow(label, raw, cfg, display){
    const sev=signalBadness(raw,cfg.normal,cfg.critical,cfg.dir);
    const col = sev==null?"#475467" : sev>=100?"#B42318" : sev>=60?"#B54708" : sev>0?"#854A0E" : "#067647";
    return '<div class="vh-rdg"><div class="vh-rdg-top"><span class="vh-rdg-lab">'+esc(label)+'</span>'
      +'<span class="vh-rdg-val" style="color:'+col+'">'+esc(display)+'</span></div>'+rangeBar(raw,cfg)+'</div>';
  }
  function liveReadings(r){
    const s=r.sig||{}, out=[];
    if(s.coolant!=null) out.push(readingRow("Coolant temp", s.coolant, CONFIG.signals.coolant, cToF(s.coolant)+"\u00b0F"));
    if(s.oilPressure!=null) out.push(readingRow("Oil pressure", s.oilPressure, CONFIG.signals.oilPressure, kpaToPsi(s.oilPressure)+" psi"));
    if(s.deviceVoltage!=null) out.push(readingRow("Battery voltage", s.deviceVoltage, CONFIG.signals.deviceVoltage, (Math.round(s.deviceVoltage*10)/10).toFixed(1)+" V"));
    if(!out.length) return "";
    return '<div class="vh-dsub">Live readings</div><div class="vh-rng-key">healthy<i class="k g"></i> warning<i class="k y"></i> critical<i class="k r"></i></div><div class="vh-rdgs">'+out.join("")+'</div>';
  }
  // Advisory drivability call from fault severity + critical live readings. NOT a safety certification - it leans on
  // the same signals the disposition uses, plus over-temp / loss-of-oil-pressure / DEF-derate, and is shown with a caveat.
  function drivability(r){
    if(r.noData) return {key:"unknown", label:"No data", tone:"none"};
    const s=r.sig||{};
    const overTemp = s.coolant!=null && signalBadness(s.coolant,CONFIG.signals.coolant.normal,CONFIG.signals.coolant.critical,"high")>=100;
    const lowOil   = s.oilPressure!=null && signalBadness(s.oilPressure,CONFIG.signals.oilPressure.normal,CONFIG.signals.oilPressure.critical,"low")>=100;
    const defDerate= r.em && r.em.kind==="diesel" && s.defLevel!=null && s.defLevel<=CONFIG.signals.defLevel.critical;
    if(r.disp==="Remove from service" || overTemp || lowOil || defDerate){
      const why = overTemp?"engine over-temperature":lowOil?"loss of oil pressure":defDerate?"DEF critically low (derate likely)":"a critical active fault";
      return {key:"tow", label:"Do not drive \u2014 tow", tone:"attention", why};
    }
    if(r.disp==="Service now") return {key:"soon", label:"Driveable \u2014 service promptly", tone:"recheck"};
    return {key:"ok", label:"OK to operate", tone:"ok"};
  }
  function drivabilityBanner(r){
    const d=drivability(r); if(d.key==="unknown")return "";
    const fg={attention:"#B42318",recheck:"#B54708",ok:"#067647"}, bg={attention:"#FEE4E2",recheck:"#FEF0C7",ok:"#ECFDF3"};
    const ic={attention:"alert",recheck:"wrench",ok:"check"};
    const why=d.why?' <span class="vh-muted">\u2014 '+esc(d.why)+'</span>':'';
    return '<div class="vh-drive" style="background:'+bg[d.tone]+';border-color:'+fg[d.tone]+'">'
      +'<span class="vh-drive-ic" style="color:'+fg[d.tone]+'">'+svg(ic[d.tone],16)+'</span>'
      +'<span class="vh-drive-tx"><b style="color:'+fg[d.tone]+'">'+esc(d.label)+'</b>'+why
      +'<span class="vh-drive-note">Advisory only, from reported fault severity and live readings \u2014 not a safety certification. Confirm with a qualified technician.</span></span></div>';
  }

  // Auto-detected vehicle attributes (no manual tagging). Equipment is asserted only from a reported signal -
  // an absent signal means "not reported", not "not equipped". On-board class is shown raw (mapping unverified).
  function profileSection(r){
    const s=r.sig||{}, det=VIN_CACHE[r.vin]||{}, items=[];
    if(r.em && (r.em.kind==="gas"||r.em.kind==="diesel")) items.push(["Fuel", r.em.kind==="diesel"?"Diesel":"Gas", ""]);
    if(det.body) items.push(["Body class", det.body, ""]);
    if(s.gcvw!=null){ const kg=Math.round(s.gcvw); items.push(["Combination weight", kg.toLocaleString()+" kg ("+Math.round(kg*2.20462).toLocaleString()+" lb)", "Reported gross combination weight"]); }
    if(s.vehClass!=null) items.push(["On-board class code", String(Math.round(s.vehClass)), "Raw on-board value \u2014 mapping to light/medium/heavy/bus pending verification"]);
    const eq=[]; if(s.ptoEngaged!=null)eq.push("PTO"); if(s.absEquipped!=null)eq.push("ABS"); if(s.adasEquipped!=null)eq.push("ADAS"); if(s.tpmsEquipped!=null)eq.push("TPMS");
    if(!items.length && !eq.length) return "";
    const rows=items.map(it=>'<div class="vh-prow"'+(it[2]?' title="'+esc(it[2])+'"':'')+'><span class="vh-plab">'+esc(it[0])+'</span><span class="vh-pval">'+esc(it[1])+'</span></div>').join("");
    const eqHTML=eq.length?'<div class="vh-prow"><span class="vh-plab">Equipment</span><span class="vh-pval">'+eq.map(e=>'<span class="vh-eqchip">'+esc(e)+'</span>').join("")+'</span></div>':'';
    return '<section class="vh-dsec"><div class="vh-dsec-h"><h4>Vehicle profile</h4><div class="vh-dsec-meta vh-muted">auto-detected</div></div>'
      +'<div class="vh-prows">'+rows+eqHTML+'</div></section>';
  }

  // Peer benchmarking: compare a vehicle against the median of its fuel-type peers (fallback: whole fleet) to
  // surface "running hotter / weaker / dirtier than the pack". Differences within +/-10% of median read as typical.
  function median(arr){ if(!arr.length)return null; const a=arr.slice().sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }
  function benchRow(label, valTxt, medTxt, val, med, higherWorse){
    const denom=Math.abs(med)>1e-9?Math.abs(med):1, rel=(val-med)/denom; let arrow="\u2248", word="typical", tone="typical";
    if(rel>0.1){ arrow="\u2191"; word="above median"; tone=higherWorse?"bad":"good"; }
    else if(rel<-0.1){ arrow="\u2193"; word="below median"; tone=higherWorse?"good":"bad"; }
    const c={bad:"#B42318",good:"#067647",typical:"#475467"}[tone];
    return '<div class="vh-brow"><span class="vh-blab">'+esc(label)+'</span><span class="vh-bval">'+esc(valTxt)+'</span>'
      +'<span class="vh-bmed">median '+esc(medTxt)+'</span><span class="vh-bind" style="color:'+c+'">'+arrow+' '+word+'</span></div>';
  }
  function benchmarkSection(r){
    if(r.noData) return "";
    const kind=r.em&&r.em.kind;
    let peers=COMPUTED.filter(x=>!x.noData && x.em && x.em.kind===kind), scope=kind==="diesel"?"diesel vehicles":kind==="gas"?"gas vehicles":"vehicles";
    if(peers.length<5){ peers=COMPUTED.filter(x=>!x.noData); scope="vehicles"; }
    if(peers.length<3) return "";
    const s=r.sig||{}, rows=[], col=fn=>peers.map(fn).filter(v=>v!=null);
    const add=(label,val,vals,fmt,hw)=>{ if(val==null)return; const med=median(vals.filter(v=>v!=null)); if(med==null)return; rows.push(benchRow(label,fmt(val),fmt(med),val,med,hw)); };
    add("Risk score", r.score, col(x=>x.score), v=>String(Math.round(v)), true);
    if(s.coolant!=null) add("Coolant temp", s.coolant, col(x=>x.sig&&x.sig.coolant), v=>cToF(v)+"\u00b0F", true);
    if(s.oilPressure!=null) add("Oil pressure", s.oilPressure, col(x=>x.sig&&x.sig.oilPressure), v=>kpaToPsi(v)+" psi", false);
    if(s.deviceVoltage!=null) add("Battery voltage", s.deviceVoltage, col(x=>x.sig&&x.sig.deviceVoltage), v=>(Math.round(v*10)/10).toFixed(1)+" V", false);
    if(kind==="diesel" && s.defLevel!=null) add("DEF level", s.defLevel, col(x=>x.sig&&x.sig.defLevel), v=>Math.round(v)+"%", false);
    if(r.co2&&r.co2.perHour!=null) add("CO\u2082 / engine-hr", r.co2.perHour, col(x=>x.co2&&x.co2.perHour), v=>v.toFixed(1)+" kg", true);
    if(r.harsh!=null) add("Harsh events", r.harsh, col(x=>x.harsh!=null?x.harsh:null), v=>String(Math.round(v)), true);
    if(!rows.length) return "";
    return '<section class="vh-dsec"><div class="vh-dsec-h"><h4>How this compares</h4><div class="vh-dsec-meta vh-muted">vs '+peers.length+' '+esc(scope)+'</div></div>'
      +'<div class="vh-bench">'+rows.join("")+'</div></section>';
  }

  function breakdownSection(r){
    const w=(SETTINGS&&SETTINGS.weights)||CONFIG.weights;
    const factors='<div class="vh-terms">'
      +termRow("Faults \u00b7 "+(w.DTC*100)+"%","DTC",r.terms)+termRow("Temp \u00b7 "+(w.T*100)+"%","T",r.terms)
      +termRow("Pressure \u00b7 "+(w.P*100)+"%","P",r.terms)+termRow("Usage \u00b7 "+(w.U*100)+"%","U",r.terms)
      +termRow("Maint \u00b7 "+(w.M*100)+"%","M",r.terms)+termRow("Battery \u00b7 "+(w.B*100)+"%","B",r.terms)+'</div>';
    const fmiHTML=i=>{ if(i.fmi==null)return ""; const t=fmiText(i.fmi)||(i.fmiName?String(i.fmiName):"");
      return '<div style="font-size:11px;color:#667085;font-weight:400;margin-top:2px">'+(t?esc(t)+' ':'')+'(FMI '+i.fmi+')</div>'; };
    const frows=r.items.length?r.items.map(i=>'<tr><td>'+esc(i.name)+(i.safety?' \u26a0':'')+fmiHTML(i)+'</td><td>'+esc(i.domState)+(i.intermittent?' \u00b7 intermittent':'')
      +'</td><td class="num">'+(i.worstSeverity!=null?Math.round(i.worstSeverity):"\u2014")+'</td><td class="num">'+(i.maxRisk!=null?i.maxRisk.toFixed(1)+"%":"\u2014")
      +'</td><td class="num">'+i.occurrences+'</td><td class="num">'+Math.round(i.contribution)+'</td></tr>').join("")
      :'<tr><td colspan="6" class="vh-muted">No vehicle ECU faults in window.</td></tr>';
    const faults='<table class="vh-dtable"><thead><tr><th>Fault</th><th>State</th><th>Sev</th><th>Risk</th><th>Count</th><th>Score</th></tr></thead><tbody>'+frows+'</tbody></table>';
    const notes=[];
    if(r.battOcc)notes.push(r.battOcc+" battery / low-voltage record(s) \u2192 Battery factor.");
    if(r.harsh)notes.push(r.harsh+" harsh-driving event(s) in window \u2192 Usage factor.");
    if(r.openDefects)notes.push(r.openDefects+" open DVIR defect(s) \u2192 Maintenance factor.");
    if(r.deviceFaultCount)notes.push(r.deviceFaultCount+" telematics device record(s) (excluded from score).");
    if(r.items&&r.items.some(i=>i.codeClass==="proprietary"||i.codeClass==="std")) notes.push("\u201cManufacturer-specific\u201d / \u201cLikely\u2026\u201d codes are identified only by their J1939 SPN \u2014 the meaning is unconfirmed; verify with the OEM diagnosis before acting.");
    const ns=notes.length?'<ul class="vh-notes">'+notes.map(n=>'<li>'+esc(n)+'</li>').join("")+'</ul>':'';
    const gr=r.geotabRisk!=null?'<div class="vh-callout" style="margin-bottom:12px">Geotab predicted breakdown risk: <b>'+Math.round(r.geotabRisk)+'%</b> <span class="vh-muted">(Geotab\u2019s own model, shown for comparison)</span></div>':'';
    return '<section class="vh-dsec"><div class="vh-dsec-h"><h4>Breakdown risk</h4><div class="vh-dsec-meta">'+pill(r.disp)+'</div></div>'
      +riskGauge(r)
      +gr
      +'<div class="vh-dsub">Top risk factors (weight)</div>'+factors
      +liveReadings(r)
      +'<div class="vh-dsub">Diagnostic faults</div>'+faults
      +(ns?'<div class="vh-dsub">Notes</div>'+ns:'')+'</section>';
  }
  function emissionsSection(r){
    const em=r.em||{}; const kind=em.kind, state=em.state||"none";
    const fg={ok:"#067647",recheck:"#B54708",attention:"#B42318",none:"#475467"};
    const bg={ok:"#ECFDF3",recheck:"#FEF0C7",attention:"#FEE4E2",none:"#F2F4F7"};
    const hpill='<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:'+(bg[state]||bg.none)+';color:'+(fg[state]||fg.none)+'">'+esc(em.disp||"No data")+'</span>';
    const head=em.headline?'<div class="vh-callout" style="border-left:3px solid '+(fg[state]||fg.none)+';margin-bottom:12px">'+esc(em.headline)+'</div>':'';
    const rows=(em.rows||[]).slice();
    const dot=st=>'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:'+(fg[st]||"#98A2B3")+';margin-right:8px;vertical-align:middle"></span>';
    const strip=rows.length
      ? '<div style="margin-top:4px">'+rows.map(x=>'<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #F2F4F7"><span style="color:#344054">'+dot(x.state)+esc(x.label)+'</span><span style="color:#475467;font-weight:500">'+esc(x.value)+'</span></div>').join("")+'</div>'
      : '<p class="vh-muted">No emissions signals reported.</p>';
    let carbon='';
    if(r.co2){ const ph=r.co2.perHour!=null?('<br><b>~'+r.co2.perHour.toFixed(1)+' kg CO\u2082 / engine-hour</b> (last '+r.co2.perHourDays+' days)'):'';
      carbon='<div class="vh-callout"><b>'+fmtInt(r.co2.totalKg)+' kg</b> total \u00b7 <b>'+fmtInt(r.co2.idleKg)+' kg</b> from idling'+(r.co2.idleWaste?' \u26a0 high idle waste':'')+ph
        +'<br><span class="vh-muted">Fuel-derived estimate \u2014 use the Geotab Sustainability Center for certified figures.</span></div>'; }
    return '<section class="vh-dsec"><div class="vh-dsec-h"><h4>Emissions health</h4><div class="vh-dsec-meta">'+hpill+'</div></div>'
      +head
      +'<div class="vh-dsub">Status</div>'+strip
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
      +'<div class="vh-dbody">'+drivabilityBanner(r)+profileSection(r)+breakdownSection(r)+benchmarkSection(r)+emissionsSection(r)+'</div>';
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
  function setView(v){ if(VIEW===v)return; if(v==="group" && COMPARE_MODE){ setCompareMode(false); } VIEW=v; SECTION_LIMIT={}; renderAll(); }
  function setSearch(q){ SEARCH=q; SECTION_LIMIT={}; renderAll(); }
  function toggleSection(id){ const key=TAB+":"+id; COLLAPSED[key]=!isCollapsed(id); renderAll(); }

  // One comprehensive report (breakdown + emissions + readings + reason + drivability), reflecting the current
  // filters/search. Plain-English columns so a row tells you what's wrong, how urgent, whether to drive it, and why.
  function reasonText(r){
    if(r.noData) return r.noDataReason||"No data";
    const dr=escalationDriver(r); if(dr) return dr.charAt(0).toUpperCase()+dr.slice(1);
    const wf=worstFault(r); if(wf) return wf.name+(wf.domState?" ("+String(wf.domState).toLowerCase()+")":"");
    const tc=topContributors(r.terms)[0];
    if(tc){ const rd=readingText(tc.k, r.detail&&r.detail[tc.k]); return factorLabel(r,tc.k)+(rd?" \u2014 "+rd:""); }
    return "No active issues";
  }
  function bandLabelOf(score){ const k=bandKeyOf(score); const f=BAND_FACET.find(b=>b[0]===k); return f?f[1]:""; }
  function equipText(s){ const e=[]; if(s){ if(s.ptoEngaged!=null)e.push("PTO"); if(s.absEquipped!=null)e.push("ABS"); if(s.adasEquipped!=null)e.push("ADAS"); if(s.tpmsEquipped!=null)e.push("TPMS"); } return e.join(" "); }
  function exportCSV(){
    const rows=filteredRows(); if(!rows.length)return;
    const order=actionsFor().map(a=>a.id);
    rows.sort((a,b)=>{ const ia=order.indexOf(dispOf(a)),ib=order.indexOf(dispOf(b)); if(ia!==ib)return ia-ib;
      const sa=scoreOf(a),sb=scoreOf(b); return (sb==null?-1:sb)-(sa==null?-1:sa); });
    const q=s=>'"'+String(s==null?"":s).replace(/"/g,'""')+'"';
    const head=["Vehicle","Group(s)","Year","Make","Model","VIN","Plate","Fuel","Body class","Equipment",
      "Recommended action","Drivability","Primary reason",
      "Risk score","Risk band","Geotab predicted risk %",
      "Worst fault","Active faults","Pending faults",
      "Faults score","Temp score","Pressure score","Usage score","Maint score","Battery score",
      "Coolant F","Oil pressure psi","Battery V","DEF %",
      "Open DVIR defects","Harsh events",
      "Emissions status","Emissions finding","CO2 total kg","CO2 idle kg","CO2 per engine-hr",
      "Miles (window)","Last reported","Data status"];
    const line=r=>{
      const s=r.sig||{}, det=VIN_CACHE[r.vin]||{}, dr=drivability(r);
      const items=r.items||[], act=items.filter(i=>i.domState==="Active").length, pend=items.filter(i=>i.domState==="Pending").length;
      const wf=worstFault(r);
      const dataStatus = r.noData ? (r.noDataReason||"No data") : "OK";
      return [r.name, r.groupNames.join(" | "), r.year||"", r.make||"", r.model||"", r.vin||"", r.plate||"",
        r.em&&(r.em.kind==="gas"||r.em.kind==="diesel")?(r.em.kind==="diesel"?"Diesel":"Gas"):"", det.body||"", equipText(s),
        r.disp, dr.label.replace(/\u2014/g,"-"), reasonText(r),
        r.score==null?"":Math.round(r.score), bandLabelOf(r.score), r.geotabRisk==null?"":Math.round(r.geotabRisk),
        wf?wf.name+(wf.domState?" ("+String(wf.domState).toLowerCase()+")":""):"", act, pend,
        r.terms.DTC==null?"":Math.round(r.terms.DTC), r.terms.T==null?"":Math.round(r.terms.T), r.terms.P==null?"":Math.round(r.terms.P),
        r.terms.U==null?"":Math.round(r.terms.U), r.terms.M==null?"":Math.round(r.terms.M), r.terms.B==null?"":Math.round(r.terms.B),
        s.coolant!=null?cToF(s.coolant):"", s.oilPressure!=null?kpaToPsi(s.oilPressure):"", s.deviceVoltage!=null?(Math.round(s.deviceVoltage*10)/10).toFixed(1):"", s.defLevel!=null?Math.round(s.defLevel):"",
        r.openDefects||0, r.harsh||0,
        r.em?r.em.disp:"", (r.em&&r.em.detail||[]).join("; "), r.co2?Math.round(r.co2.totalKg):"", r.co2?Math.round(r.co2.idleKg):"", r.co2&&r.co2.perHour!=null?r.co2.perHour.toFixed(2):"",
        r.distanceMi!=null?Math.round(r.distanceMi):"", r.lastComm?new Date(r.lastComm).toISOString():"", dataStatus];
    };
    const need=rows.filter(r=>NEED.has(dispOf(r))).length;
    const filt=[]; if(SEARCH)filt.push('search="'+SEARCH+'"'); if(FILTER_ID&&FILTER_ID!=="all")filt.push("status="+FILTER_ID); if(anyFacetActive())filt.push(activeFacetChips()+" facet filter(s)");
    const meta=[["Lytx Vehicle Health report"],["Generated", new Date().toISOString()],["Window", WINDOW_DAYS+" days"],
      ["Scope", filt.length?filt.join("; "):"all loaded vehicles"],["Vehicles in report", rows.length],["Needing attention", need],[]];
    const body=[head.map(q).join(",")].concat(rows.map(r=>line(r).map(q).join(",")));
    const csv=meta.map(m=>m.map(q).join(",")).concat(body).join("\r\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"});
    const url=URL.createObjectURL(blob), a=document.createElement("a");
    const d=new Date(), ymd=d.getFullYear()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0");
    a.href=url; a.download="lytx-vehicle-health-report-"+ymd+".csv"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }

  // ========================= settings panel (custom in-app modal; no browser dialogs) =========================
  function pct(x){ return Math.round(x*100); }
  function openSettings(){ ensureSettings(function(){ SET_FORM=JSON.parse(JSON.stringify(SETTINGS)); renderSettings(); showSettings(true); }); }
  function closeSettings(){ showSettings(false); SET_FORM=null; }
  function showSettings(on){
    const sc=el("vh-mscrim"), md=el("vh-settings");
    if(sc)sc.classList.toggle("on",!!on);
    if(md){ md.classList.toggle("on",!!on); md.setAttribute("aria-hidden",on?"false":"true"); }
    if(on){ const inp=md&&md.querySelector("input:not([disabled])"); const x=md&&md.querySelector(".vh-x"); const f=inp||x; if(f&&f.focus)f.focus(); }
    else { const g=el("vh-settings-btn"); if(g&&g.focus)g.focus(); }
  }
  function presetRow(kind){
    const active=presetName(kind,SET_FORM[kind]), ro=!CAN_EDIT_SETTINGS;
    const order=[["high","High"],["medium","Medium"],["low","Low"]];
    return '<div class="vh-preset" role="group" aria-label="'+kind+' sensitivity preset">'
      + order.map(o=>'<button type="button" class="'+(active===o[0]?"on":"")+'" data-preset="'+kind+'" data-level="'+o[0]+'"'+(ro?" disabled":"")+'>'+o[1]+'</button>').join("")
      + '</div>';
  }
  function numField(kind,which,label,unit,val,step){
    const ro=!CAN_EDIT_SETTINGS;
    return '<div class="vh-numf"><label>'+esc(label)+'</label><span class="row">'
      + '<input type="number" inputmode="decimal" data-num="'+kind+'" data-which="'+which+'" value="'+val+'" step="'+step+'" min="0"'+(ro?" disabled":"")+' />'
      + (unit?'<span class="unit">'+esc(unit)+'</span>':'') + '</span></div>';
  }
  function weightField(k,label,val){
    const ro=!CAN_EDIT_SETTINGS;
    return '<div class="vh-numf"><label>'+esc(label)+'</label><span class="row">'
      + '<input type="number" inputmode="numeric" data-weight="'+k+'" value="'+Math.round(val*100)+'" step="5" min="0" max="100"'+(ro?" disabled":"")+' />'
      + '<span class="unit">%</span></span></div>';
  }
  function renderSettings(){
    const md=el("vh-settings"); if(!md||!SET_FORM)return;
    const ro=!CAN_EDIT_SETTINGS;
    const banner = ro ? '<div class="vh-readonly">These settings are shared across your whole organization. Changing them requires Administrator or Supervisor access, so they\u2019re read-only for you.</div>' : '';
    const harshN=SET_FORM.harsh.normal, harshC=SET_FORM.harsh.critical;
    const idleN=pct(SET_FORM.idle.normal), idleC=pct(SET_FORM.idle.critical);
    const stale=SET_FORM.staleHours;
    const w=SET_FORM.weights||defaultSettings().weights;
    md.innerHTML =
      '<div class="vh-mhead"><div><h3 id="vh-set-title">Settings</h3>'
        +'<p>Tune how sensitive scoring is to driving behavior and data freshness. Shared across your organization.</p></div>'
        +'<button class="vh-x" type="button" aria-label="Close settings">'+svg("close",16)+'</button></div>'
      +'<div class="vh-mbody">'+banner
        +'<div class="vh-mform">'
          +'<div class="vh-fset"><div class="vh-fset-h">Harsh-driving sensitivity</div>'
            +'<div class="vh-fset-d">How many harsh-driving events (over the selected window) make a vehicle concerning, then critical. Lower = more sensitive.</div>'
            + presetRow("harsh")
            +'<div class="vh-nums">'+numField("harsh","normal","Concerning at","events",harshN,"1")
            + numField("harsh","critical","Critical at","events",harshC,"1")+'</div></div>'
          +'<div class="vh-fset"><div class="vh-fset-h">Idle sensitivity</div>'
            +'<div class="vh-fset-d">What share of running time spent idling is too much. Transit fleets idle more than long-haul, so raise this if idle scores look high across the board.</div>'
            + presetRow("idle")
            +'<div class="vh-nums">'+numField("idle","normal","Concerning at","% idle",idleN,"1")
            + numField("idle","critical","Critical at","% idle",idleC,"1")+'</div></div>'
          +'<div class="vh-fset"><div class="vh-fset-h">Data freshness</div>'
            +'<div class="vh-fset-d">Flag a vehicle as offline when it hasn\u2019t reported for longer than this.</div>'
            +'<div class="vh-nums">'+numField("stale","stale","Offline after","hours",stale,"1")+'</div></div>'
          +'<div class="vh-fset"><div class="vh-fset-h">Score weights</div>'
            +'<div class="vh-fset-d">Relative importance of each risk factor in the breakdown score. They don\u2019t need to add up to 100 \u2014 the score is normalized across whichever factors a vehicle reports.</div>'
            +'<div class="vh-nums">'
              + weightField("DTC","Engine faults", w.DTC)
              + weightField("T","Temperature", w.T)
              + weightField("P","Pressure", w.P)
              + weightField("U","Usage", w.U)
              + weightField("M","Maintenance", w.M)
              + weightField("B","Battery", w.B)
            +'</div></div>'
        +'</div></div>'
      +'<div class="vh-mfoot">'
        +'<button class="vh-btn vh-btn-ghost vh-set-reset" type="button"'+(ro?" disabled":"")+'>Reset to defaults</button>'
        +'<span class="vh-msg" id="vh-set-msg" role="status" aria-live="polite"></span>'
        +'<span class="sp"></span>'
        +'<button class="vh-btn vh-btn-ghost vh-set-cancel" type="button">Cancel</button>'
        +'<button class="vh-btn vh-set-save" type="button"'+(ro?" disabled":"")+'>Save</button>'
      +'</div>';
    wireSettings();
  }
  function wireSettings(){
    const md=el("vh-settings"); if(!md)return;
    const x=md.querySelector(".vh-x"); if(x)x.addEventListener("click",closeSettings);
    const cx=md.querySelector(".vh-set-cancel"); if(cx)cx.addEventListener("click",closeSettings);
    md.querySelectorAll("[data-preset]").forEach(b=>b.addEventListener("click",()=>{
      const kind=b.getAttribute("data-preset"), lvl=b.getAttribute("data-level");
      if(!PRESETS[kind]||!PRESETS[kind][lvl])return;
      SET_FORM[kind]={ normal:PRESETS[kind][lvl].normal, critical:PRESETS[kind][lvl].critical };
      renderSettings();
    }));
    md.querySelectorAll("[data-num]").forEach(inp=>inp.addEventListener("input",()=>{
      const kind=inp.getAttribute("data-num"), which=inp.getAttribute("data-which"); const v=Number(inp.value);
      if(!isFinite(v))return;
      if(kind==="stale"){ SET_FORM.staleHours=v; }
      else if(kind==="idle"){ SET_FORM.idle[which]=clamp(v/100,0,1); refreshPresetHighlight("idle"); }
      else { SET_FORM.harsh[which]=v; refreshPresetHighlight("harsh"); }
    }));
    md.querySelectorAll("[data-weight]").forEach(inp=>inp.addEventListener("input",()=>{
      const k=inp.getAttribute("data-weight"); const v=Number(inp.value);
      if(!isFinite(v))return;
      if(!SET_FORM.weights)SET_FORM.weights=Object.assign({},CONFIG.weights);
      SET_FORM.weights[k]=clamp(v/100,0,1);
    }));
    const rs=md.querySelector(".vh-set-reset"); if(rs)rs.addEventListener("click",()=>{ SET_FORM=defaultSettings(); renderSettings(); });
    const sv=md.querySelector(".vh-set-save"); if(sv)sv.addEventListener("click",onSaveSettings);
  }
  // Esc-to-close + Tab focus-trap for the modal. Bound ONCE (in initialize) to #vh-settings, which persists across
  // re-renders - binding it inside wireSettings (run on every render) would stack duplicate listeners.
  function settingsKeydown(e){
    if(e.key==="Escape"){ e.preventDefault(); closeSettings(); return; }
    if(e.key!=="Tab")return;
    const md=el("vh-settings"); if(!md)return;
    const f=md.querySelectorAll("button:not([disabled]),input:not([disabled])"); if(!f.length)return;
    const first=f[0], last=f[f.length-1];
    if(e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
  }
  function refreshPresetHighlight(kind){
    const md=el("vh-settings"); if(!md)return;
    const active=presetName(kind,SET_FORM[kind]);
    md.querySelectorAll('[data-preset="'+kind+'"]').forEach(b=>b.classList.toggle("on", b.getAttribute("data-level")===active));
  }
  function setMsg(text,cls){ const m=el("vh-set-msg"); if(m){ m.textContent=text||""; m.className="vh-msg"+(cls?" "+cls:""); } }
  function onSaveSettings(){
    const md=el("vh-settings"); const sv=md&&md.querySelector(".vh-set-save"); if(sv)sv.disabled=true;
    setMsg("Saving\u2026","");
    saveSettings(SET_FORM, function(ok,msg){
      if(sv)sv.disabled=false;
      if(ok){ setMsg("Saved \u2014 scores updated.","ok"); run(); setTimeout(closeSettings,650); }
      else { setMsg(msg||"Save failed.","err"); }
    });
  }

  // ========================= lifecycle =========================
  return {
    initialize(api,state,callback){ API=api; STATE=state;
      try{ loadState(); }catch(e){}
      const on=(id,ev,fn)=>{ const e=el(id); if(e)e.addEventListener(ev,fn); };
      const w=el("vh-window"); if(w)w.value=String(WINDOW_DAYS);
      on("vh-refresh","click",()=>{ clearDiagCatalog(); run(); });
      on("vh-window","change",()=>{ const w2=el("vh-window"); WINDOW_DAYS=Number(w2&&w2.value)||WINDOW_DAYS; run(); });
      on("vh-tab-bd","click",()=>setTab("breakdown"));
      on("vh-tab-em","click",()=>setTab("emissions"));
      on("vh-view-list","click",()=>setView("list"));
      on("vh-view-group","click",()=>setView("group"));
      on("vh-export","click",exportCSV);
      on("vh-filters-btn","click",toggleFiltersPanel);
      on("vh-compare-btn","click",()=>setCompareMode(!COMPARE_MODE));
      on("vh-cscrim","click",closeCompare);
      on("vh-compare","keydown",compareKeydown);
      on("vh-scrim","click",closeDrawer);
      on("vh-settings-btn","click",openSettings);
      on("vh-mscrim","click",closeSettings);
      on("vh-settings","keydown",settingsKeydown);
      document.addEventListener("keydown",e=>{ if(e.key==="Escape"){ closeDrawer(); closeSettings(); } });
      const si=el("vh-search"); let t=null;
      if(si){ si.value=SEARCH; si.addEventListener("input",()=>{ const v=si.value.trim(); clearTimeout(t); t=setTimeout(()=>setSearch(v),130); }); }
      if(callback)callback();
    },
    focus(api,state){ API=api; STATE=state; ensureSettings(run); },
    blur(){ closeDrawer(); }
  };
};
