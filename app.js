const state = {
  location: JSON.parse(localStorage.getItem('weather-location') || 'null') || { name:'Genova', latitude:44.4056, longitude:8.9463 },
  units: localStorage.getItem('weather-units') || 'celsius',
  wind: localStorage.getItem('weather-wind') || 'kmh',
  models: [], probabilityModels: [], consensus: null, probabilityConsensus: null, best: null,
  map: null, radarLayer: null, radarFrames: [], radarTimer: null,
  lastRefreshAt: 0,
};

const $ = id => document.getElementById(id);
const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
const sd = arr => { if(arr.length < 2) return 0; const m=avg(arr); return Math.sqrt(avg(arr.map(x=>(x-m)**2))); };
const round = (v,d=0) => v == null || Number.isNaN(v) ? null : Number(v.toFixed(d));
const fmtTemp = v => v == null ? '--' : `${Math.round(v)}°`;
const degreeToCardinal = deg => ['N','NE','E','SE','S','SW','W','NW'][Math.round((deg%360)/45)%8];
const weatherText = code => ({0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',80:'Rain showers',81:'Rain showers',82:'Heavy showers',95:'Thunderstorm',96:'Thunderstorm',99:'Severe thunderstorm'})[code] || 'Variable weather';
const weatherGlyph = code => code===0?'☀︎':[1,2].includes(code)?'◔':[3,45,48].includes(code)?'☁︎':[51,53,55,61,63,65,80,81,82].includes(code)?'☂︎':[71,73,75].includes(code)?'❄︎':[95,96,99].includes(code)?'ϟ':'◯';

function modelEndpoints(){
  const p = new URLSearchParams({latitude:state.location.latitude,longitude:state.location.longitude,timezone:'auto',forecast_days:'7',temperature_unit:state.units,wind_speed_unit:state.wind,hourly:'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset,uv_index_max'});
  return [
    {name:'ECMWF', url:`https://api.open-meteo.com/v1/ecmwf?${p}`},
    {name:'DWD ICON', url:`https://api.open-meteo.com/v1/dwd-icon?${p}`},
    {name:'GFS', url:`https://api.open-meteo.com/v1/gfs?${p}`},
    {name:'ItaliaMeteo', url:`https://api.open-meteo.com/v1/forecast?${p}&models=italia_meteo_arpae_icon_2i`},
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
  $('locationName').textContent = state.location.name.toUpperCase();
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
  $('weatherGlyph').textContent=weatherGlyph(code);
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
    card.innerHTML=`<div class="hour-time">${n===0?'NOW':dt.toLocaleTimeString([], {hour:'2-digit'})}</div><div class="hour-icon">${weatherGlyph(code)}</div><div class="hour-temp">${fmtTemp(c.hourly.temperature_2m[i])}</div><div class="hour-rain">${Number.isFinite(state.probabilityConsensus?.probability?.[i])?Math.round(state.probabilityConsensus.probability[i])+'% rain':'--'}</div>`;
    $('hourlyScroller').appendChild(card);
  }
}
function renderDaily(b){
  $('dailyList').innerHTML='';
  b.daily.time.slice(0,7).forEach((t,i)=>{const row=document.createElement('div');row.className='daily-row';const d=new Date(`${t}T12:00:00`);row.innerHTML=`<span>${i===0?'Today':d.toLocaleDateString([], {weekday:'short'})}</span><span class="daily-icon">${weatherGlyph(b.daily.weather_code[i])}</span><span>${round(b.daily.precipitation_sum?.[i],1) ?? 0} mm</span><strong>${fmtTemp(b.daily.temperature_2m_max[i])} / ${fmtTemp(b.daily.temperature_2m_min[i])}</strong>`;$('dailyList').appendChild(row);});
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
    state.location={name,latitude,longitude}; localStorage.setItem('weather-location',JSON.stringify(state.location)); loadWeather(); if(state.map) state.map.setView([latitude,longitude],8);
  },()=>{}, {enableHighAccuracy:true,timeout:8000});
}

async function searchLocations(q){
  const data=await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`);
  $('searchResults').innerHTML=''; (data.results||[]).forEach(p=>{const b=document.createElement('button');b.className='place-row';b.innerHTML=`<strong>${p.name}</strong><span class="micro">${[p.admin1,p.country].filter(Boolean).join(', ')}</span>`;b.onclick=()=>{state.location={name:p.name,latitude:p.latitude,longitude:p.longitude};localStorage.setItem('weather-location',JSON.stringify(state.location));switchView('weatherView');loadWeather();};$('searchResults').appendChild(b);});
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
$('modelDetailsButton').onclick=()=>$('modelDialog').showModal();$('closeModelDialog').onclick=()=>$('modelDialog').close();
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchView(t.dataset.view));
$('radarSlider').oninput=e=>setRadarFrame(Number(e.target.value));$('radarPlayButton').onclick=toggleRadarPlay;
$('locationSearchForm').onsubmit=e=>{e.preventDefault();const q=$('locationSearchInput').value.trim();if(q)searchLocations(q);};
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
if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
loadWeather();
