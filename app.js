const SIMPLY_WEATHER_BUILD='v8';
console.info('Simply Weather',SIMPLY_WEATHER_BUILD);

async function reverseGeocodeCity(latitude, longitude){
  try{
    const url=`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&localityLanguage=en`;
    const data=await fetchJson(url);
    return (data.city || data.locality || data.principalSubdivision || 'Current location').split(',')[0];
  }catch(e){
    return 'Current location';
  }
}

const state = {
  location: JSON.parse(localStorage.getItem('weather-location') || 'null') || { name:'Genova', latitude:44.4056, longitude:8.9463 },
  units: localStorage.getItem('weather-units') || 'celsius',
  wind: localStorage.getItem('weather-wind') || 'kmh',
  models: [], probabilityModels: [], consensus: null, probabilityConsensus: null, best: null,
  map: null, radarLayer: null, radarFrames: [], radarTimer: null,
  lastRefreshAt: 0,
  favorites: JSON.parse(localStorage.getItem('weather-favorites') || '[]'),
};

const $ = id => document.getElementById(id);
const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
const sd = arr => { if(arr.length < 2) return 0; const m=avg(arr); return Math.sqrt(avg(arr.map(x=>(x-m)**2))); };
const round = (v,d=0) => v == null || Number.isNaN(v) ? null : Number(v.toFixed(d));
const fmtTemp = v => v == null ? '--' : `${Math.round(v)}°`;
const degreeToCardinal = deg => ['N','NE','E','SE','S','SW','W','NW'][Math.round((deg%360)/45)%8];
const weatherText = code => ({0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',80:'Rain showers',81:'Rain showers',82:'Heavy showers',95:'Thunderstorm',96:'Thunderstorm',99:'Severe thunderstorm'})[code] || 'Variable weather';

function isNightTime(ts){
  try{
    const d = new Date(ts);
    const h = d.getHours();
    return h < 7 || h >= 20;
  }catch(e){ return false; }
}

function weatherGlyph(code, isNight=false){
  const c = Number(code);
  const cloud = `<path d="M13 34h27c7 0 12-5 12-11 0-6-4-10-10-11C40 7 35 4 29 4c-7 0-13 5-15 12-7 0-12 5-12 11 0 4 4 7 11 7Z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const sun = `<circle cx="19" cy="18" r="7" fill="none" stroke="currentColor" stroke-width="2.6"/>
    <g stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
      <path d="M19 3v5"/><path d="M19 28v5"/><path d="M4 18h5"/><path d="M29 18h5"/>
      <path d="m8.5 7.5 3.5 3.5"/><path d="m26 25 3.5 3.5"/><path d="m29.5 7.5-3.5 3.5"/><path d="m12 25-3.5 3.5"/>
    </g>`;
  const moon = `<path d="M30 5c-7 2-12 8-12 15 0 8 6 14 14 14 5 0 9-2 12-6-2 .6-4 .9-6 .9-8 0-14-6-14-14 0-4 2-7 6-9.9Z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  const rain = n => Array.from({length:n},(_,i)=>`<path d="M${17+i*8} 38l-3 8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`).join('');
  const snow = `<g stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
    <path d="M19 38v10"/><path d="m15 40 8 6"/><path d="m23 40-8 6"/>
    <path d="M37 38v10"/><path d="m33 40 8 6"/><path d="m41 40-8 6"/>
  </g>`;
  const bolt = `<path d="m29 34-7 11h6l-4 9 12-14h-7l5-6Z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/>`;
  const fog = `<g stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M8 17h34"/><path d="M4 25h42"/><path d="M10 33h30"/></g>`;

  let body = cloud;
  if(c===0) body = isNight ? moon : sun;
  else if(c===1) body = isNight
      ? `${moon}<g transform="translate(18 17) scale(.62)">${cloud}</g>`
      : `${sun}<g transform="translate(17 14) scale(.66)">${cloud}</g>`;
  else if(c===2) body = isNight
      ? `${moon}<g transform="translate(14 14) scale(.78)">${cloud}</g>`
      : `${sun}<g transform="translate(14 13) scale(.78)">${cloud}</g>`;
  else if(c===3) body = cloud;
  else if([45,48].includes(c)) body = fog;
  else if([51,53,55,56,57].includes(c)) body = `${cloud}${rain(2)}`;
  else if([61,63,66,80,81].includes(c)) body = `${cloud}${rain(3)}`;
  else if([65,67,82].includes(c)) body = `${cloud}${rain(4)}`;
  else if([71,73,75,77,85,86].includes(c)) body = `${cloud}${snow}`;
  else if([95,96,99].includes(c)) body = `${cloud}${bolt}${[96,99].includes(c)?rain(2):''}`;

  return `<svg class="wx-svg" viewBox="0 0 56 56" aria-hidden="true" focusable="false">${body}</svg>`;
}

function modelEndpoints(){
  const p = new URLSearchParams({latitude:state.location.latitude,longitude:state.location.longitude,timezone:'auto',forecast_days:'7',temperature_unit:state.units,wind_speed_unit:state.wind,hourly:'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset,uv_index_max'});
  return [
    {name:'ECMWF', url:`https://api.open-meteo.com/v1/ecmwf?${p}`},
    {name:'DWD ICON', url:`https://api.open-meteo.com/v1/dwd-icon?${p}`},
    {name:'GFS', url:`https://api.open-meteo.com/v1/gfs?${p}`},
    {name:'ItaliaMeteo', url:`https://api.open-meteo.com/v1/forecast?${p}&models=italia_meteo_arpae_icon_2i`},
    {name:'UKMO', url:`https://api.open-meteo.com/v1/ukmo?${p}`},
    {name:'Météo-France', url:`https://api.open-meteo.com/v1/meteofrance?${p}`},
  ];
}

async function fetchJson(url){ const r = await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(`${r.status}`); return r.json(); }

function probabilityEndpoints(){
  const p = new URLSearchParams({
    latitude:state.location.latitude,
    longitude:state.location.longitude,
    timezone:'auto',
    forecast_days:'7',
    hourly:'precipitation_probability'
  });
  return [
    {name:'DWD ICON-EPS', url:`https://api.open-meteo.com/v1/dwd-icon?${p}`},
    {name:'NOAA GEFS', url:`https://api.open-meteo.com/v1/gfs?${p}`},
    {name:'CMC GEPS', url:`https://api.open-meteo.com/v1/gem?${p}`},
    {name:'BOM ACCESS-GE', url:`https://api.open-meteo.com/v1/bom?${p}`},
  ];
}

function buildProbabilityConsensus(results, targetTimes){
  const available = results.filter(x=>x.ok && x.data?.hourly?.time?.length && x.data?.hourly?.precipitation_probability);
  const maps = available.map(m=>({
    name:m.name,
    values:new Map(m.data.hourly.time.map((t,i)=>[t,m.data.hourly.precipitation_probability[i]]))
  }));
  const probability=[], probability_min=[], probability_max=[], probability_spread=[], source_count=[];
  for(const t of targetTimes){
    const vals=maps.map(m=>m.values.get(t)).filter(Number.isFinite);
    probability.push(avg(vals));
    probability_min.push(vals.length?Math.min(...vals):null);
    probability_max.push(vals.length?Math.max(...vals):null);
    probability_spread.push(sd(vals));
    source_count.push(vals.length);
  }
  return {time:targetTimes, probability, probability_min, probability_max, probability_spread, source_count};
}

async function loadWeather(){
  document.body.classList.add('loading');
  $('locationName').textContent = state.location.isCurrent ? `CURRENT LOCATION (${state.location.name.split(',')[0].toUpperCase()})` : state.location.name.split(',')[0].toUpperCase();
  const endpointList = modelEndpoints();
  const probabilityList = probabilityEndpoints();
  const [results, probabilityResults] = await Promise.all([
    Promise.all(endpointList.map(async m=>{
      try { const data = await fetchJson(m.url); return {...m, ok:true, data}; }
      catch(e){ return {...m, ok:false, error:e.message}; }
    })),
    Promise.all(probabilityList.map(async m=>{
      try { const data = await fetchJson(m.url); return {...m, ok:true, data}; }
      catch(e){ return {...m, ok:false, error:e.message}; }
    }))
  ]);
  state.models = results;
  state.probabilityModels = probabilityResults;
  const valid = results.filter(x=>x.ok && x.data?.hourly?.time?.length);
  if(!valid.length){ renderOffline(results); document.body.classList.remove('loading'); return; }
  state.best = valid[0].data;
  state.consensus = buildConsensus(valid.map(x=>x.data));
  state.probabilityConsensus = buildProbabilityConsensus(probabilityResults, state.consensus.hourly.time);
  renderWeather();
  document.body.classList.remove('loading');
}

function buildConsensus(datas){
  const times = datas[0].hourly.time;
  const hourly = { time:times, temperature_2m:[], apparent_temperature:[], relative_humidity_2m:[], precipitation:[], weather_code:[], wind_speed_10m:[], wind_direction_10m:[], temp_spread:[], precip_agreement:[], precip_spread:[], precip_min:[], precip_max:[], precip_model_count:[] };
  for(let i=0;i<times.length;i++){
    const vals = key => datas.map(d=>d.hourly[key]?.[i]).filter(Number.isFinite);
    const temps=vals('temperature_2m'), rains=vals('precipitation');
    hourly.temperature_2m.push(avg(temps));
    hourly.apparent_temperature.push(avg(vals('apparent_temperature')));
    hourly.relative_humidity_2m.push(avg(vals('relative_humidity_2m')));
    hourly.precipitation.push(avg(rains));
    hourly.weather_code.push(Math.round(avg(vals('weather_code')) || 0));
    hourly.wind_speed_10m.push(avg(vals('wind_speed_10m')));
    const dirs = vals('wind_direction_10m');
    if(dirs.length){ const s=avg(dirs.map(d=>Math.sin(d*Math.PI/180))), c=avg(dirs.map(d=>Math.cos(d*Math.PI/180))); hourly.wind_direction_10m.push((Math.atan2(s,c)*180/Math.PI+360)%360); } else hourly.wind_direction_10m.push(null);
    hourly.temp_spread.push(sd(temps));
    hourly.precip_agreement.push(rains.length ? rains.filter(v=>v>=0.1).length/rains.length : 0);
    hourly.precip_spread.push(sd(rains));
    hourly.precip_min.push(rains.length ? Math.min(...rains) : null);
    hourly.precip_max.push(rains.length ? Math.max(...rains) : null);
    hourly.precip_model_count.push(rains.length);
  }
  const daily = datas[0].daily;
  return {hourly,daily};
}

function currentIndex(times){ const now=Date.now(); let best=0, dist=Infinity; times.forEach((t,i)=>{const d=Math.abs(new Date(t).getTime()-now);if(d<dist){dist=d;best=i;}}); return best; }
function confidenceLabel(spread){ if(spread == null) return 'Unavailable'; if(spread < .7) return 'High confidence'; if(spread < 1.5) return 'Moderate confidence'; return 'Low confidence'; }

function renderWeather(){
  const c=state.consensus, i=currentIndex(c.hourly.time), b=state.best;
  const code=b.hourly.weather_code?.[i] ?? c.hourly.weather_code[i];
  $('currentTemp').textContent=fmtTemp(c.hourly.temperature_2m[i]);
  $('conditionText').textContent=weatherText(code);
  $('feelsLike').textContent=`Feels like ${fmtTemp(c.hourly.apparent_temperature[i])}`;
  $('weatherGlyph').innerHTML=weatherGlyph(code,isNightTime(c.hourly.time[i]));
  $('confidenceText').textContent=`${confidenceLabel(c.hourly.temp_spread[i])} · ±${round(c.hourly.temp_spread[i],1)}°`;
  const rainMean=round(c.hourly.precipitation[i],1);
  const pop=state.probabilityConsensus?.probability?.[i];
  const popSources=state.probabilityConsensus?.source_count?.[i]||0;
  $('rainMetric').textContent=Number.isFinite(pop)?`${Math.round(pop)}%`:'--';
  $('rainSubtext').textContent=popSources ? `${popSources} ensemble systems · ${rainMean ?? 0} mm mean` : 'ensemble probability';
  $('humidityMetric').textContent=`${Math.round(c.hourly.relative_humidity_2m[i] ?? 0)}%`;
  $('windMetric').textContent=`${Math.round(c.hourly.wind_speed_10m[i] ?? 0)} ${state.wind==='kmh'?'km/h':state.wind}`;
  $('windDirection').textContent=degreeToCardinal(c.hourly.wind_direction_10m[i] ?? 0);
  $('uvMetric').textContent=round(b.daily.uv_index_max?.[0],1) ?? '--';
  $('sunriseText').textContent=(b.daily.sunrise?.[0]||'').slice(11,16)||'--:--';
  $('sunsetText').textContent=(b.daily.sunset?.[0]||'').slice(11,16)||'--:--';
  const popHeadline=state.probabilityConsensus?.probability?.[i];
  $('rainHeadline').textContent=Number.isFinite(popHeadline)?`${Math.round(popHeadline)}% chance of precipitation`:'Probability unavailable';
  $('updatedText').textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
  renderHourly(c,b,i); renderDaily(b); renderModels(i); renderRainModels(i); renderMapForecast(i);
  state.lastRefreshAt=Date.now();
}


function renderMapForecast(start){
  const el=$('mapForecastStrip'); if(!el || !state.consensus) return;
  const c=state.consensus; el.innerHTML='';
  for(let n=0;n<6 && start+n<c.hourly.time.length;n++){
    const i=start+n, chip=document.createElement('div'); chip.className='forecast-chip';
    const dt=new Date(c.hourly.time[i]);
    const pop=state.probabilityConsensus?.probability?.[i];
    const min=round(c.hourly.precip_min[i],1), max=round(c.hourly.precip_max[i],1);
    chip.innerHTML=`<span>${n===0?'NOW':dt.toLocaleTimeString([], {hour:'2-digit'})}</span><strong>${Number.isFinite(pop)?Math.round(pop)+'%':'--'}</strong><small>${round(c.hourly.precipitation[i],1) ?? 0} mm · ${min ?? 0}–${max ?? 0} mm</small>`;
    chip.onclick=()=>renderRainModels(i,true);
    el.appendChild(chip);
  }
}

function renderHourly(c,b,start){
  $('hourlyScroller').innerHTML='';
  for(let n=0;n<24 && start+n<c.hourly.time.length;n++){
    const i=start+n, card=document.createElement('div'); card.className='hour-card'+(n===0?' now':'');
    const dt=new Date(c.hourly.time[i]); const code=b.hourly.weather_code?.[i] ?? c.hourly.weather_code[i];
    card.innerHTML=`<div class="hour-time">${n===0?'NOW':dt.toLocaleTimeString([], {hour:'2-digit'})}</div><div class="hour-icon">${weatherGlyph(code,isNightTime(c.hourly.time[i]))}</div><div class="hour-temp">${fmtTemp(c.hourly.temperature_2m[i])}</div><div class="hour-rain">${Number.isFinite(state.probabilityConsensus?.probability?.[i])?Math.round(state.probabilityConsensus.probability[i])+'% rain':'--'}</div>`;
    $('hourlyScroller').appendChild(card);
  }
}
function conditionFamily(code){
  if([95,96,99].includes(code)) return 'storm';
  if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return 'rain';
  if([71,73,75,77,85,86].includes(code)) return 'snow';
  if([45,48].includes(code)) return 'fog';
  if([0,1].includes(code)) return 'clear';
  return 'cloud';
}
function familyCode(f){ return ({clear:0,cloud:2,fog:45,rain:63,snow:73,storm:95})[f] ?? 2; }
function dailyConsensusAt(date){
  const valid=state.models.filter(m=>m.ok && m.data?.daily?.time);
  const entries=valid.map(m=>{const i=m.data.daily.time.indexOf(date); return i<0?null:{
    name:m.name, code:m.data.daily.weather_code?.[i], max:m.data.daily.temperature_2m_max?.[i],
    min:m.data.daily.temperature_2m_min?.[i], rain:m.data.daily.precipitation_sum?.[i]
  }}).filter(Boolean);
  const fams=entries.map(e=>conditionFamily(e.code));
  const counts=fams.reduce((a,f)=>(a[f]=(a[f]||0)+1,a),{});
  const dominant=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0] || ['cloud',0];
  const maxs=entries.map(e=>e.max).filter(Number.isFinite), mins=entries.map(e=>e.min).filter(Number.isFinite);
  const tempRange=[...maxs,...mins];
  const tempSpread=tempRange.length>1 ? Math.max(...maxs)-Math.min(...maxs) : 0;

  // For each ensemble system, use that system's maximum hourly PoP for the calendar day.
  // Then combine systems equally; raw ensemble member counts never appear in the UI.
  const pops=state.probabilityModels.filter(m=>m.ok && m.data?.hourly?.time).map(m=>{
    const vals=m.data.hourly.time.map((t,i)=>t.startsWith(date)?m.data.hourly.precipitation_probability?.[i]:null).filter(Number.isFinite);
    return vals.length?Math.max(...vals):null;
  }).filter(Number.isFinite);
  const pop=pops.length?avg(pops):null;
  const popSpread=pops.length>1?Math.max(...pops)-Math.min(...pops):0;
  const conditionAgreement=entries.length?dominant[1]/entries.length:.5;
  const rainAgreement=pops.length>1?Math.max(.25,1-popSpread/100):.55;
  const tempAgreement=Math.max(.25,1-Math.min(tempSpread,8)/8);
  const score=.50*conditionAgreement+.30*rainAgreement+.20*tempAgreement;
  const label=score>=.82?'Very high':score>=.68?'High':score>=.48?'Mixed':'Low';
  return {entries, dominant:dominant[0], code:familyCode(dominant[0]), max:avg(maxs), min:avg(mins),
          pop, label, score, systemsAgree:dominant[1], systemsTotal:entries.length, tempSpread};
}

function rollingDailyDates(){
  const dates=state.best?.daily?.time || [];
  if(!dates.length) return [];
  // Open-Meteo daily arrays begin at "today" in the selected location's timezone.
  return dates.slice(0,7);
}
function todayConsensusSummary(date){
  const d=dailyConsensusAt(date);
  const models=state.models.filter(m=>m.ok && m.data?.hourly?.time);
  const rows=[];
  models.forEach(m=>m.data.hourly.time.forEach((t,i)=>{
    if(t.startsWith(date)) rows.push({
      time:t, code:m.data.hourly.weather_code?.[i],
      rain:Number(m.data.hourly.precipitation?.[i]||0)
    });
  }));
  const fams=rows.map(r=>conditionFamily(r.code));
  const counts=fams.reduce((a,f)=>(a[f]=(a[f]||0)+1,a),{});
  const dominant=Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0] || d.dominant || 'cloud';
  const rainy=rows.filter(r=>r.rain>=0.1);
  const parts=[...new Set(rainy.map(r=>{
    const h=Number(r.time.slice(11,13));
    return h<12?'morning':h<17?'afternoon':h<21?'evening':'night';
  }))];
  let headline='Variable conditions';
  if(dominant==='clear' && (!Number.isFinite(d.pop)||d.pop<20)) headline='Sunny and dry';
  else if(dominant==='clear') headline='Mostly sunny';
  else if(dominant==='cloud' && (!Number.isFinite(d.pop)||d.pop<25)) headline='Mostly cloudy and dry';
  else if(dominant==='cloud') headline='Mostly cloudy';
  else if(dominant==='rain') headline=(Number.isFinite(d.pop)&&d.pop>=70)?'Rain likely':(parts.length===1?`Showers possible in the ${parts[0]}`:'Showers possible');
  else if(dominant==='storm') headline='Thunderstorms possible';
  else if(dominant==='snow') headline='Snow possible';
  else if(dominant==='fog') headline='Foggy at times';

  let detail=(d.label==='Very high'||d.label==='High')
    ? `Forecast systems ${d.label==='Very high'?'strongly ':''}agree on ${headline.toLowerCase()} today.`
    : `Forecast systems show some disagreement about today's conditions.`;
  if(Number.isFinite(d.pop)){
    detail += d.pop<10?' Little to no rain is expected.'
      : d.pop<30?' Rain is unlikely.'
      : d.pop<60?' There is a meaningful chance of rain.'
      : ' Rain is a significant possibility.';
  }
  return {...d,headline,detail};
}
function renderTodayConsensus(){
  const date=rollingDailyDates()[0];
  const box=document.getElementById('todayConsensus');
  if(!date || !box) return;
  const x=todayConsensusSummary(date);
  box.innerHTML=`<div class="eyebrow">TODAY'S CONSENSUS</div>
    <div class="today-consensus-main">
      <span class="today-consensus-icon">${weatherGlyph(x.code)}</span>
      <div><strong>${x.headline}</strong><span>${x.label} confidence</span></div>
    </div>
    <p>${x.detail}</p>
    <div class="today-consensus-meta">
      <span>High ${fmtTemp(x.max)}</span><span>Low ${fmtTemp(x.min)}</span>
      <span>${Number.isFinite(x.pop)?Math.round(x.pop)+'% rain':'Rain --'}</span>
    </div>`;
}

function renderDaily(b){
  $('dailyList').innerHTML='';
  rollingDailyDates().forEach((t,i)=>{
    const x=dailyConsensusAt(t), row=document.createElement('button'); row.className='daily-row';
    const d=new Date(`${t}T12:00:00`);
    const agreement=x.systemsTotal ? `${x.systemsAgree}/${x.systemsTotal} systems agree` : 'Consensus unavailable';
    row.innerHTML=`<span class="daily-day">${i===0?'Today':i===1?'Tomorrow':d.toLocaleDateString([], {weekday:'short'})}</span>
      <span class="daily-icon">${weatherGlyph(x.code)}</span>
      <span class="daily-rain">${Number.isFinite(x.pop)?Math.round(x.pop)+'% rain':'--'}</span>
      <strong class="daily-temp">${fmtTemp(x.max)} / ${fmtTemp(x.min)}</strong>
      <span class="daily-confidence"><b>${x.label} consensus</b><small>${agreement}</small></span>`;
    row.onclick=()=>showDailyConsensus(t,x);
    $('dailyList').appendChild(row);
  });
  renderTodayConsensus();
}
function showDailyConsensus(date,x){
  const dlg=$('dailyDialog'), d=new Date(`${date}T12:00:00`);
  $('dailyDialogTitle').textContent=d.toLocaleDateString([], {weekday:'long',month:'short',day:'numeric'});
  $('dailyDialogSummary').innerHTML=`<strong>${x.label} consensus</strong><span>${Number.isFinite(x.pop)?Math.round(x.pop)+'% rain probability':'Rain probability unavailable'} · temperature spread ${round(x.tempSpread,1)}°</span>`;
  $('dailyModelRows').innerHTML='';
  x.entries.forEach(e=>{const r=document.createElement('div');r.className='model-row';r.innerHTML=`<span><strong>${e.name}</strong><small class="model-status">${weatherText(e.code)}</small></span><strong>${fmtTemp(e.max)} / ${fmtTemp(e.min)}</strong>`;$('dailyModelRows').appendChild(r);});
  dlg.showModal();
}
function renderRainModels(i, open=false){
  const c=state.consensus; if(!c) return;
  const dt=new Date(c.hourly.time[i]);
  const amountVals=state.models.filter(m=>m.ok).map(m=>({name:m.name,value:m.data.hourly.precipitation?.[i]})).filter(x=>Number.isFinite(x.value));
  const p=state.probabilityConsensus;
  const pop=p?.probability?.[i];
  const popMin=p?.probability_min?.[i];
  const popMax=p?.probability_max?.[i];
  const popCount=p?.source_count?.[i]||0;
  const meanAmount=round(c.hourly.precipitation[i],1);
  const amountMin=round(c.hourly.precip_min[i],1);
  const amountMax=round(c.hourly.precip_max[i],1);
  $('rainDialogTitle').textContent=`${dt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} forecast`;
  $('rainConsensusSummary').innerHTML=`<div><span class="eyebrow">PROBABILITY</span><strong>${Number.isFinite(pop)?Math.round(pop)+'%':'--'}</strong></div><div><span class="eyebrow">ENSEMBLE RANGE</span><strong>${Number.isFinite(popMin)?Math.round(popMin):'--'}–${Number.isFinite(popMax)?Math.round(popMax):'--'}%</strong></div><div><span class="eyebrow">AMOUNT</span><strong>${meanAmount ?? '--'} mm</strong></div>`;
  $('rainModelRows').innerHTML='';

  const probHead=document.createElement('div'); probHead.className='dialog-section-label eyebrow'; probHead.textContent='ENSEMBLE PROBABILITY SOURCES'; $('rainModelRows').appendChild(probHead);
  state.probabilityModels.forEach(m=>{
    const r=document.createElement('div'); r.className='model-row';
    let v=null;
    if(m.ok){ const ti=m.data.hourly.time.indexOf(c.hourly.time[i]); if(ti>=0) v=m.data.hourly.precipitation_probability?.[ti]; }
    r.innerHTML=`<div><strong>${m.name}</strong><div class="model-wet">${m.ok?'ENSEMBLE PoP · >0.1 mm/h':'UNAVAILABLE'}</div></div><div class="rain-model-amount">${Number.isFinite(v)?`${Math.round(v)}%`:'—'}</div>`;
    $('rainModelRows').appendChild(r);
  });

  const amountHead=document.createElement('div'); amountHead.className='dialog-section-label eyebrow'; amountHead.textContent='DETERMINISTIC AMOUNT FORECASTS'; $('rainModelRows').appendChild(amountHead);
  state.models.forEach(m=>{
    const r=document.createElement('div'); r.className='model-row';
    const v=m.ok?m.data.hourly.precipitation?.[i]:null;
    r.innerHTML=`<div><strong>${m.name}</strong><div class="model-wet">${Number.isFinite(v)&&v>=0.1?'WET SIGNAL':Number.isFinite(v)?'DRY SIGNAL':'UNAVAILABLE'}</div></div><div class="rain-model-amount">${Number.isFinite(v)?`${round(v,1)} mm`:'—'}</div>`;
    $('rainModelRows').appendChild(r);
  });
  const foot=document.createElement('div'); foot.className='probability-foot micro'; foot.textContent=`Probability consensus averages ${popCount} independent ensemble systems. Deterministic amount range: ${amountMin ?? '--'}–${amountMax ?? '--'} mm.`; $('rainModelRows').appendChild(foot);
  if(open && !$('rainDialog').open) $('rainDialog').showModal();
}

function renderModels(i){
  $('modelRows').innerHTML=''; state.models.forEach(m=>{const r=document.createElement('div');r.className='model-row';const v=m.ok?m.data.hourly.temperature_2m?.[i]:null;r.innerHTML=`<div><strong>${m.name}</strong><div class="model-status">${m.ok?'Available':'Unavailable this refresh'}</div></div><div>${m.ok?fmtTemp(v):'—'}</div>`;$('modelRows').appendChild(r);});
}
function renderOffline(results){$('conditionText').textContent='Weather data unavailable';$('updatedText').textContent='Check your connection';$('modelRows').innerHTML=results.map(m=>`<div class="model-row"><strong>${m.name}</strong><span>Unavailable</span></div>`).join('');}

async function useCurrentLocation(){
  if(!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async pos=>{
    const {latitude,longitude}=pos.coords; let name='Current location';
    try{const g=await fetchJson(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${latitude}&longitude=${longitude}&count=1&language=en&format=json`);name=g.results?.[0]?.name||name;}catch{}
    const city=await reverseGeocodeCity(latitude,longitude); state.location={name:city,latitude,longitude,isCurrent:true}; localStorage.setItem('weather-location',JSON.stringify(state.location)); loadWeather(); if(state.map) state.map.setView([latitude,longitude],8);
  },()=>{}, {enableHighAccuracy:true,timeout:8000});
}

function isFavorite(p){
  return state.favorites.some(x=>Math.abs(x.latitude-p.latitude)<.001 && Math.abs(x.longitude-p.longitude)<.001);
}
function toggleFavorite(p){
  const i=state.favorites.findIndex(x=>Math.abs(x.latitude-p.latitude)<.001 && Math.abs(x.longitude-p.longitude)<.001);
  if(i>=0) state.favorites.splice(i,1);
  else state.favorites.push({name:p.name.split(',')[0],latitude:p.latitude,longitude:p.longitude});
  localStorage.setItem('weather-favorites',JSON.stringify(state.favorites));
  renderFavorites();
  refreshSearchStars();
}
function refreshSearchStars(){
  document.querySelectorAll('.favorite-star').forEach(btn=>{
    const p=JSON.parse(btn.dataset.place||'{}');
    const saved=isFavorite(p);
    btn.textContent=saved?'★':'☆';
    btn.classList.toggle('is-saved',saved);
    btn.setAttribute('aria-label',`${saved?'Remove':'Favorite'} ${p.name||'city'}`);
  });
}
function removeFavorite(i){state.favorites.splice(i,1);localStorage.setItem('weather-favorites',JSON.stringify(state.favorites));renderFavorites();}
function loadPlace(p){
  state.location={name:p.name.split(',')[0],latitude:p.latitude,longitude:p.longitude,isCurrent:false};
  localStorage.setItem('weather-location',JSON.stringify(state.location)); switchView('weatherView'); loadWeather();
}
function renderFavorites(){
  const el=$('savedLocations'); el.innerHTML='';
  if(!state.favorites.length){el.innerHTML='<div class="favorites-title eyebrow">FAVORITES</div><div class="micro">Tap ☆ beside a search result to save a city.</div>';return;}
  const title=document.createElement('div');title.className='favorites-title eyebrow';title.textContent='FAVORITES';el.appendChild(title);
  state.favorites.forEach((p,i)=>{const row=document.createElement('div');row.className='favorite-row';
    const b=document.createElement('button');b.className='favorite-load';b.innerHTML=`<strong>★ ${p.name}</strong>`;b.onclick=()=>loadPlace(p);
    const x=document.createElement('button');x.className='favorite-remove';x.textContent='×';x.setAttribute('aria-label',`Remove ${p.name}`);x.onclick=()=>removeFavorite(i);
    row.append(b,x);el.appendChild(row);
  });
}
async function searchLocations(q){
  if(q.length<2){$('searchResults').innerHTML='';return;}
  try{
    const data=await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`);
    $('searchResults').innerHTML='';
    (data.results||[]).forEach(p=>{const row=document.createElement('div');row.className='place-row-wrap';
      const b=document.createElement('button');b.className='place-row';b.innerHTML=`<strong>${p.name}</strong><span class="micro">${[p.admin1,p.country].filter(Boolean).join(', ')}</span>`;b.onclick=()=>loadPlace(p);
      const star=document.createElement('button');star.className='favorite-star';star.dataset.place=JSON.stringify({name:p.name,latitude:p.latitude,longitude:p.longitude}); const saved=isFavorite(p); star.textContent=saved?'★':'☆'; star.classList.toggle('is-saved',saved); star.setAttribute('aria-label',`${saved?'Remove':'Favorite'} ${p.name}`); star.onclick=()=>toggleFavorite(p);
      row.append(b,star);$('searchResults').appendChild(row);
    });
  }catch(e){$('searchResults').innerHTML='<div class="micro">Location search unavailable.</div>';}
}

function switchView(id){ document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===id));if(id==='mapView') initMap(); }

async function initMap(){
  if(!state.map){ state.map=L.map('map',{zoomControl:false,preferCanvas:true}).setView([state.location.latitude,state.location.longitude],7);
    const base=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap',crossOrigin:true,updateWhenIdle:false,keepBuffer:4});
    base.addTo(state.map);L.circleMarker([state.location.latitude,state.location.longitude],{radius:6,weight:2,fillOpacity:.8}).addTo(state.map);setTimeout(()=>state.map.invalidateSize(),100); }
  else { state.map.setView([state.location.latitude,state.location.longitude],7); setTimeout(()=>state.map.invalidateSize(true),120); }
  setTimeout(()=>state.map && state.map.invalidateSize(true),350);
  await loadRadar();
}
async function loadRadar(){
  try{const rv=await fetchJson('https://api.rainviewer.com/public/weather-maps.json');state.radarFrames=rv.radar?.past||[];state.radarHost=rv.host;if(!state.radarFrames.length)return;$('radarSlider').max=state.radarFrames.length-1;$('radarSlider').value=state.radarFrames.length-1;setRadarFrame(state.radarFrames.length-1);}catch(e){$('radarTimeLabel').textContent='Radar unavailable';}
}
function setRadarFrame(idx){
  const f=state.radarFrames[idx];if(!f||!state.map)return;if(state.radarLayer)state.map.removeLayer(state.radarLayer);
  state.radarLayer=L.tileLayer(`${state.radarHost}${f.path}/256/{z}/{x}/{y}/2/1_0.png`,{opacity:.62,maxZoom:7,zIndex:5});state.radarLayer.addTo(state.map);
  $('radarTimeLabel').textContent=new Date(f.time*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}
function toggleRadarPlay(){
  if(state.radarTimer){clearInterval(state.radarTimer);state.radarTimer=null;$('radarPlayButton').textContent='Play';return;}
  $('radarPlayButton').textContent='Pause';state.radarTimer=setInterval(()=>{let i=Number($('radarSlider').value);i=(i+1)%state.radarFrames.length;$('radarSlider').value=i;setRadarFrame(i);},650);
}

$('refreshButton').onclick=loadWeather;$('locationButton').onclick=useCurrentLocation;$('mapLocateButton').onclick=useCurrentLocation;
$('rainDetailsButton').onclick=()=>{if(state.consensus)renderRainModels(currentIndex(state.consensus.hourly.time),true);};
$('closeRainDialog').onclick=()=>$('rainDialog').close();
$('closeDailyDialog').onclick=()=>$('dailyDialog').close();
$('modelDetailsButton').onclick=()=>$('modelDialog').showModal();$('closeModelDialog').onclick=()=>$('modelDialog').close();
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchView(t.dataset.view));
$('radarSlider').oninput=e=>setRadarFrame(Number(e.target.value));$('radarPlayButton').onclick=toggleRadarPlay;
$('locationSearchForm').onsubmit=e=>{e.preventDefault();const q=$('locationSearchInput').value.trim();if(q)searchLocations(q);};
let searchTimer=null;
$('locationSearchInput').addEventListener('input',e=>{clearTimeout(searchTimer);const q=e.target.value.trim();searchTimer=setTimeout(()=>searchLocations(q),275);});
renderFavorites();
$('unitSelect').value=state.units;$('windSelect').value=state.wind;
$('unitSelect').onchange=e=>{state.units=e.target.value;localStorage.setItem('weather-units',state.units);loadWeather();};
$('windSelect').onchange=e=>{state.wind=e.target.value;localStorage.setItem('weather-wind',state.wind);loadWeather();};

function refreshOnOpen(){
  if(Date.now()-state.lastRefreshAt<2000) return;
  loadWeather();
  if(state.map && document.getElementById('mapView').classList.contains('active')) loadRadar();
}
window.addEventListener('pageshow',refreshOnOpen);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshOnOpen();});
window.addEventListener('focus',refreshOnOpen);
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js?v=8',{updateViaCache:'none'}).catch(()=>{}));
loadWeather();
