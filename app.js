const state = {
  location: JSON.parse(localStorage.getItem('weather-location') || 'null') || { name:'Genova', latitude:44.4056, longitude:8.9463 },
  units: localStorage.getItem('weather-units') || 'celsius',
  wind: localStorage.getItem('weather-wind') || 'kmh',
  models: [], consensus: null, best: null,
  map: null, radarLayer: null, radarFrames: [], radarTimer: null,
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

async function fetchJson(url){ const r = await fetch(url); if(!r.ok) throw new Error(`${r.status}`); return r.json(); }

async function loadWeather(){
  document.body.classList.add('loading');
  $('locationName').textContent = state.location.name.toUpperCase();
  const endpointList = modelEndpoints();
  const results = await Promise.all(endpointList.map(async m=>{
    try { const data = await fetchJson(m.url); return {...m, ok:true, data}; }
    catch(e){ return {...m, ok:false, error:e.message}; }
  }));
  state.models = results;
  const valid = results.filter(x=>x.ok && x.data?.hourly?.time?.length);
  if(!valid.length){ renderOffline(results); document.body.classList.remove('loading'); return; }
  state.best = valid[0].data;
  state.consensus = buildConsensus(valid.map(x=>x.data));
  renderWeather();
  document.body.classList.remove('loading');
}

function buildConsensus(datas){
  const times = datas[0].hourly.time;
  const hourly = { time:times, temperature_2m:[], apparent_temperature:[], relative_humidity_2m:[], precipitation:[], weather_code:[], wind_speed_10m:[], wind_direction_10m:[], temp_spread:[], precip_agreement:[] };
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
  $('rainMetric').textContent=`${round(c.hourly.precipitation[i],1) ?? '--'} mm`;
  $('humidityMetric').textContent=`${Math.round(c.hourly.relative_humidity_2m[i] ?? 0)}%`;
  $('windMetric').textContent=`${Math.round(c.hourly.wind_speed_10m[i] ?? 0)} ${state.wind==='kmh'?'km/h':state.wind}`;
  $('windDirection').textContent=degreeToCardinal(c.hourly.wind_direction_10m[i] ?? 0);
  $('uvMetric').textContent=round(b.daily.uv_index_max?.[0],1) ?? '--';
  $('sunriseText').textContent=(b.daily.sunrise?.[0]||'').slice(11,16)||'--:--';
  $('sunsetText').textContent=(b.daily.sunset?.[0]||'').slice(11,16)||'--:--';
  const rainAgree=Math.round((c.hourly.precip_agreement[i]||0)*100);
  $('rainHeadline').textContent=rainAgree ? `${rainAgree}% of models signal rain` : 'Models mostly dry';
  $('updatedText').textContent=`Updated ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
  renderHourly(c,b,i); renderDaily(b); renderModels(i); renderMapForecast(i);
}


function renderMapForecast(start){
  const el=$('mapForecastStrip'); if(!el || !state.consensus) return;
  const c=state.consensus; el.innerHTML='';
  for(let n=0;n<6 && start+n<c.hourly.time.length;n++){
    const i=start+n, chip=document.createElement('div'); chip.className='forecast-chip';
    const dt=new Date(c.hourly.time[i]); const agreement=Math.round((c.hourly.precip_agreement[i]||0)*100);
    chip.innerHTML=`<span>${n===0?'NOW':dt.toLocaleTimeString([], {hour:'2-digit'})}</span><strong>${round(c.hourly.precipitation[i],1) ?? 0} mm</strong><small>${agreement}% models</small>`;
    el.appendChild(chip);
  }
}

function renderHourly(c,b,start){
  $('hourlyScroller').innerHTML='';
  for(let n=0;n<24 && start+n<c.hourly.time.length;n++){
    const i=start+n, card=document.createElement('div'); card.className='hour-card'+(n===0?' now':'');
    const dt=new Date(c.hourly.time[i]); const code=b.hourly.weather_code?.[i] ?? c.hourly.weather_code[i];
    card.innerHTML=`<div class="hour-time">${n===0?'NOW':dt.toLocaleTimeString([], {hour:'2-digit'})}</div><div class="hour-icon">${weatherGlyph(code)}</div><div class="hour-temp">${fmtTemp(c.hourly.temperature_2m[i])}</div><div class="hour-rain">${Math.round((c.hourly.precip_agreement[i]||0)*100)}% rain</div>`;
    $('hourlyScroller').appendChild(card);
  }
}
function renderDaily(b){
  $('dailyList').innerHTML='';
  b.daily.time.slice(0,7).forEach((t,i)=>{const row=document.createElement('div');row.className='daily-row';const d=new Date(`${t}T12:00:00`);row.innerHTML=`<span>${i===0?'Today':d.toLocaleDateString([], {weekday:'short'})}</span><span class="daily-icon">${weatherGlyph(b.daily.weather_code[i])}</span><span>${round(b.daily.precipitation_sum?.[i],1) ?? 0} mm</span><strong>${fmtTemp(b.daily.temperature_2m_max[i])} / ${fmtTemp(b.daily.temperature_2m_min[i])}</strong>`;$('dailyList').appendChild(row);});
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
  if(!state.map){ state.map=L.map('map',{zoomControl:false}).setView([state.location.latitude,state.location.longitude],7);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(state.map);L.circleMarker([state.location.latitude,state.location.longitude],{radius:6,weight:2,fillOpacity:.8}).addTo(state.map);setTimeout(()=>state.map.invalidateSize(),100); }
  else { state.map.setView([state.location.latitude,state.location.longitude],7); setTimeout(()=>state.map.invalidateSize(),100); }
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
$('modelDetailsButton').onclick=()=>$('modelDialog').showModal();$('closeModelDialog').onclick=()=>$('modelDialog').close();
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchView(t.dataset.view));
$('radarSlider').oninput=e=>setRadarFrame(Number(e.target.value));$('radarPlayButton').onclick=toggleRadarPlay;
$('locationSearchForm').onsubmit=e=>{e.preventDefault();const q=$('locationSearchInput').value.trim();if(q)searchLocations(q);};
$('unitSelect').value=state.units;$('windSelect').value=state.wind;
$('unitSelect').onchange=e=>{state.units=e.target.value;localStorage.setItem('weather-units',state.units);loadWeather();};
$('windSelect').onchange=e=>{state.wind=e.target.value;localStorage.setItem('weather-wind',state.wind);loadWeather();};

if('serviceWorker' in navigator) window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
loadWeather();
